#!/usr/bin/env python3
"""Startdatei des BWK-Update-Werkzeugs (Launcher).

Diese Datei ändert sich möglichst nie und wird vom Update-Werkzeug nie ersetzt.
Der Aufgabenplaner ruft immer sie auf – mit denselben Argumenten wie bisher bwk_pull.py:

    launcher.py --work <deploy-work> run

Aufbau des Ordners:
    launcher.py              diese Datei
    state.json               welche Fassung aktiv ist (current), Rückfallfassung (previous),
                             freigegebene neue Fassung (pending)
    versions/<x.y.z>/        bwk_pull.py, bwk_deploy.py, make_release_manifest.py

Ablauf bei `run` (nur dort wird umgeschaltet, immer unter einer eigenen Sperre):
  1. Liegt eine freigegebene neue Fassung vor (pending), wird ihr Selbsttest ausgeführt.
     Besteht sie, wird umgeschaltet; sonst bleibt die bisherige Fassung aktiv.
  2. Der erste Lauf nach dem Umschalten ist ein Probelauf: Bricht er ab (Absturz, Signal),
     wird auf die vorherige Fassung zurückgeschaltet und die neue als fehlerhaft vermerkt.
Alle anderen Befehle (status, approve, reject, init …) werden unverändert an die aktive
Fassung durchgereicht.

Vereinbarung mit dem Werkzeug: Globale Optionen stehen vor dem Befehl und haben immer einen
Wert (--work PFAD); `bwk_pull.py selftest` gibt als letzte Zeile JSON {"ok": true,
"version": "x.y.z"} aus; ein unerwarteter Abbruch endet mit Code 70.

Python 3.9+, nur Standardbibliothek.
"""
import contextlib
import datetime as dt
import fcntl
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

LAUNCHER_VERSION = "1"
ROOT = Path(__file__).resolve().parent
VERSIONS = ROOT / "versions"
STATE = ROOT / "state.json"
LOCK = ROOT / ".launcher.lock"
NAME_RE = re.compile(r"^\d+\.\d+\.\d+$")
TOOL_FILES = ("bwk_pull.py", "bwk_deploy.py", "make_release_manifest.py")
SELFTEST_TIMEOUT = 120
CRASH_CODE = 70
MAX_FAILED = 20
MAX_STATE = 64 * 1024


class LauncherError(Exception):
    pass


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def clean(value, limit=300):
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(value))[:limit]


def tool_dir(version):
    """Ordner einer Fassung – nur gültiger Name, kein Symlink, alle Dateien regulär."""
    if not isinstance(version, str) or not NAME_RE.fullmatch(version):
        raise LauncherError("Ungültiger Fassungsname: " + clean(version, 40))
    if VERSIONS.is_symlink():
        raise LauncherError("versions ist ein Symlink")
    d = VERSIONS / version
    if d.is_symlink() or not d.is_dir():
        raise LauncherError("Fassung %s fehlt" % version)
    for name in TOOL_FILES:
        st = os.lstat(d / name) if (d / name).exists() or (d / name).is_symlink() else None
        if st is None or not stat.S_ISREG(st.st_mode):
            raise LauncherError("Fassung %s unvollständig: %s" % (version, name))
    return d


def installed_versions():
    try:
        names = sorted(os.listdir(VERSIONS))
    except OSError:
        return []
    out = []
    for name in names:
        if NAME_RE.fullmatch(name):
            with contextlib.suppress(LauncherError, OSError):
                tool_dir(name)
                out.append(name)
    return out


def write_state(state):
    tmp = STATE.with_name(STATE.name + ".tmp-%d" % os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, STATE)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_state():
    """Liest state.json. Fehlt sie und gibt es genau eine Fassung, wird sie angelegt."""
    if not STATE.exists() and not STATE.is_symlink():
        found = installed_versions()
        if len(found) != 1:
            raise LauncherError("state.json fehlt und es gibt nicht genau eine Fassung unter versions/")
        state = {"schema": 1, "current": found[0], "previous": None, "pending": None, "trial": None, "failed": []}
        write_state(state)
        return state
    fd = os.open(STATE, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_STATE:
            raise LauncherError("state.json ist keine reguläre Datei oder zu groß")
        raw = os.read(fd, MAX_STATE + 1)
    finally:
        os.close(fd)
    try:
        state = json.loads(raw.decode("utf8"))
    except (UnicodeDecodeError, ValueError):
        raise LauncherError("state.json ist kein gültiges JSON")
    if not isinstance(state, dict) or state.get("schema") != 1 or not isinstance(state.get("current"), str):
        raise LauncherError("state.json hat nicht den erwarteten Aufbau")
    for key in ("previous", "pending", "trial"):
        if state.get(key) is not None and not (isinstance(state[key], str) and NAME_RE.fullmatch(state[key])):
            state[key] = None
    if not isinstance(state.get("failed"), list):
        state["failed"] = []
    return state


def subcommand(args):
    """Erster Befehl hinter den globalen Optionen (jede globale Option hat einen Wert)."""
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--"):
            i += 1 if "=" in a else 2
            continue
        return a
    return None


def tool_env():
    env = dict(os.environ)
    env["BWK_LAUNCHER"] = LAUNCHER_VERSION
    return env


def selftest(version):
    """(True, "") oder (False, Grund). Führt nur den Selbsttest der Fassung aus."""
    try:
        d = tool_dir(version)
    except (LauncherError, OSError) as exc:
        return False, clean(exc)
    try:
        proc = subprocess.run([sys.executable, str(d / "bwk_pull.py"), "selftest"], capture_output=True,
                              text=True, timeout=SELFTEST_TIMEOUT, env=tool_env(), cwd=str(d))
    except subprocess.TimeoutExpired:
        return False, "Selbsttest: Zeitüberschreitung nach %d s" % SELFTEST_TIMEOUT
    except OSError as exc:
        return False, "Selbsttest nicht startbar: " + clean(exc)
    lines = [x for x in (proc.stdout or "").splitlines() if x.strip()]
    try:
        report = json.loads(lines[-1]) if lines else None
    except ValueError:
        report = None
    if proc.returncode != 0 or not isinstance(report, dict) or report.get("ok") is not True:
        detail = ""
        if isinstance(report, dict) and isinstance(report.get("problems"), list):
            detail = "; ".join(str(p) for p in report["problems"][:5])
        return False, clean("Selbsttest fehlgeschlagen (Code %s) %s %s" % (
            proc.returncode, detail, (proc.stderr or "")[-300:]), 600).strip()
    if report.get("version") != version:
        return False, "Selbsttest meldet Fassung %s statt %s" % (clean(report.get("version"), 20), version)
    return True, ""


def run_tool(version, args):
    d = tool_dir(version)
    return subprocess.call([sys.executable, str(d / "bwk_pull.py")] + list(args), env=tool_env())


def record_failed(state, version, reason, stage):
    entry = {"version": version, "at": now_iso(), "reason": clean(reason, 600), "stage": stage}
    state["failed"] = ([e for e in state.get("failed", []) if isinstance(e, dict) and e.get("version") != version]
                       + [entry])[-MAX_FAILED:]
    state["last_fallback"] = dict(entry, active=state.get("current"))


def revert(state, reason, stage):
    """Schaltet auf die vorherige Fassung zurück und vermerkt die neue als fehlerhaft."""
    bad, back = state.get("current"), state.get("previous")
    state["trial"] = None
    if back and back != bad:
        with contextlib.suppress(LauncherError, OSError):
            tool_dir(back)
            state["current"], state["previous"] = back, None
    record_failed(state, bad, reason, stage)
    write_state(state)
    print("[Startdatei] Fassung %s zurückgenommen (%s); aktiv ist %s" % (bad, reason, state["current"]), flush=True)


@contextlib.contextmanager
def run_lock():
    if LOCK.is_symlink():
        raise LauncherError("Unsichere Sperrdatei")
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def scheduled_run(args):
    with run_lock() as got:
        if not got:
            print("[Startdatei] Ein anderer Lauf ist aktiv; beendet", flush=True)
            return 0
        state = read_state()
        # Ein Probelauf, der nie regulär endete (Abbruch, Neustart der NAS): zurücknehmen.
        if state.get("trial"):
            if state["trial"] == state.get("current"):
                revert(state, "Der erste Lauf der neuen Fassung wurde nicht beendet", "first-run")
            else:
                state["trial"] = None
                write_state(state)
        trial = None
        pending = state.get("pending")
        if pending:
            state["pending"] = None
            state.pop("pending_for", None)
            if pending == state.get("current"):
                write_state(state)
            else:
                ok, reason = selftest(pending)
                if ok:
                    state["previous"], state["current"], state["trial"] = state["current"], pending, pending
                    state["last_switch"] = {"from": state["previous"], "to": pending, "at": now_iso()}
                    write_state(state)
                    trial = pending
                    print("[Startdatei] Umgeschaltet auf Fassung %s (vorher %s)" % (pending, state["previous"]), flush=True)
                else:
                    record_failed(state, pending, reason, "selftest")
                    write_state(state)
                    print("[Startdatei] Fassung %s nicht aktiviert: %s" % (pending, reason), flush=True)
        try:
            rc = run_tool(state["current"], args)
        except (LauncherError, OSError) as exc:
            if not trial:
                raise
            rc = CRASH_CODE
            print("[Startdatei] Neue Fassung nicht startbar: %s" % clean(exc), flush=True)
        if trial:
            state = read_state()  # das Werkzeug darf state.json selbst geändert haben
            if rc == CRASH_CODE or rc < 0 or rc >= 126:
                if state.get("current") == trial:
                    revert(state, "Der erste Lauf der neuen Fassung ist abgebrochen (Code %s)" % rc, "first-run")
            elif state.get("trial") == trial:
                state["trial"] = None
                write_state(state)
        return rc


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["--launcher-info"]:
        state = read_state()
        print(json.dumps({"launcher_version": LAUNCHER_VERSION, "root": str(ROOT), "state": state,
                          "installed": installed_versions()}, indent=2, ensure_ascii=False))
        return 0
    if subcommand(args) == "run":
        return scheduled_run(args)
    return run_tool(read_state()["current"], args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except LauncherError as exc:
        print("FEHLER (Startdatei):", exc, file=sys.stderr)
        sys.exit(2)
