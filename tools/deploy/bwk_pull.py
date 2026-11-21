#!/usr/bin/env python3
"""BWK Pull-Deployment (Host-Task), Version 1.9.0.

Python 3.9+, nur Standardbibliothek. Läuft auf der NAS (Aufgabenplaner, als root).

Ablauf pro Aufruf `run`:
  1. Freigaben verarbeiten (approvals/granted, approvals/rejected).
  2. GitHub nur ausgehend abfragen, neues Release laden und prüfen, Hinweis schreiben.

Installiert wird NIE ohne Freigabe: Die eigentliche Installation führt ausschließlich
das bestehende bwk_deploy.py (Backup, pg_dump, Austausch, Start, Rollback bei Fehler) aus.

1.7.0 – Selbstupdate über die Startdatei (launcher.py): Ein Release kann eine neuere Fassung
dieses Werkzeugs mitbringen (Anhang bwk-tools-vX.Y.Z.zip, Eintrag "tools" im Manifest). Das Paket
wird beim Prüfen nur geladen und geprüft, nie ausgeführt. Erst nach der Freigabe des Releases wird
es neben die aktive Fassung gelegt; die Startdatei schaltet im nächsten Lauf nach bestandenem
Selbsttest um, und die neue Fassung installiert dann das Release. Ohne Startdatei bleibt alles wie
bisher (das Werkzeug wird dann von Hand getauscht).

1.8.0 – Arbeitsordner im Projektordner: Unter der Startdatei ist --work nicht mehr nötig (Standard
<Ordner der Startdatei>/work); project und compose haben dort ebenfalls einen Standard (der Ordner
über der Startdatei), und token_file darf relativ zum Ordner pull/ angegeben werden. Neuer erlaubter
Ordner im Update-ZIP: mcp-app/.

1.9.0 – Betrieb ohne Token (öffentliches Repository, Stufe 3): init trägt token_file nur noch ein, wenn
es angegeben ist, legt unter der Startdatei den Arbeitsordner selbst an und liest Dienstnamen und
Datenbank-Werte aus der compose.yaml. Verständliche Meldungen bei Abfragelimit (403/429) und 404;
status nennt die Quelle (mit/ohne Token).
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
import re
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import traceback
import urllib.parse
import zipfile
from pathlib import Path, PurePosixPath

TOOL_VERSION = "1.9.0"
HERE = Path(__file__).resolve().parent


def _load_deploy(path=None):
    spec = importlib.util.spec_from_file_location("bwk_deploy_for_pull", str(path or HERE / "bwk_deploy.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


deploy = _load_deploy()

MAX_ZIP = deploy.MAX_ZIP
VERSION_RE = deploy.VERSION_RE
SHA_RE = re.compile(r"^[a-f0-9]{64}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-]{20,255}$")
TAG_RE = re.compile(r"^v(\d+\.\d+\.\d+)$")
MAX_MANIFEST = 64 * 1024
MAX_JSON = 16 * 1024
APPROVAL_TTL = dt.timedelta(hours=24)
CLOCK_SKEW = dt.timedelta(minutes=5)
DEPLOY_TIMEOUT = 1800
VIA_ALLOWED = ("discord", "control-center", "cli")
NOTICE_FILES_MAX = 300
CRASH_CODE = 70  # Vereinbarung mit launcher.py: unerwarteter Abbruch
UPDATER_FAILED_MAX = 10


class PullError(Exception):
    def __init__(self, message, transient=False):
        super().__init__(message)
        self.transient = transient


def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.replace(microsecond=0).isoformat()


_LOG = {"path": None}
LOG_MAX = 1024 * 1024


def log(msg):
    line = f"[{iso(now())}] {msg}"
    print(line, flush=True)
    if _LOG["path"]:
        with contextlib.suppress(OSError):
            fd = os.open(_LOG["path"], os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "a", encoding="utf8") as f:
                f.write(line + "\n")


def setup_logfile(path):
    """Eigene Protokolldatei mit einfacher Rotation (1 MiB, eine Sicherung)."""
    path = Path(path)
    with contextlib.suppress(OSError):
        if path.is_file() and not path.is_symlink() and path.stat().st_size > LOG_MAX:
            os.replace(path, path.with_name(path.name + ".1"))
    _LOG["path"] = str(path)


def clean(value, limit):
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value))
    return text[:limit]


def parse_ts(value):
    """ISO-8601 inkl. 'Z' und Millisekunden (JavaScript toISOString), auch unter Python 3.9."""
    text = str(value).strip().replace("Z", "+00:00")
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(.*)", text)
    if not m:
        raise ValueError("kein Zeitstempel")
    frac = ("." + m.group(2)[:6].ljust(6, "0")) if m.group(2) else ""
    return dt.datetime.fromisoformat(m.group(1) + frac + m.group(3))


def vtuple(version):
    return tuple(int(x) for x in version.split("."))


# ---------------------------------------------------------------- Dateien

def write_json_file(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp-" + str(os.getpid()))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_json_safe(path, limit):
    """Liest eine kleine JSON-Datei: keine Symlinks, nur reguläre Dateien, Größenlimit."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise PullError("Keine reguläre Datei")
        if st.st_size > limit:
            raise PullError("Datei zu groß")
        data = os.read(fd, limit + 1)
    finally:
        os.close(fd)
    try:
        obj = json.loads(data.decode("utf8"))
    except (UnicodeDecodeError, ValueError):
        raise PullError("Kein gültiges JSON")
    if not isinstance(obj, dict):
        raise PullError("JSON-Objekt erwartet")
    return obj


def json_or_none(path, limit=MAX_JSON * 4):
    try:
        return read_json_safe(path, limit)
    except (FileNotFoundError, PullError, OSError):
        return None


def list_versions(directory):
    out = []
    try:
        names = sorted(os.listdir(directory))
    except FileNotFoundError:
        return out
    for name in names:
        m = re.fullmatch(r"(\d+\.\d+\.\d+)\.json", name)
        if m:
            out.append((m.group(1), Path(directory) / name))
    return out


@contextlib.contextmanager
def pull_lock(work):
    d = work / "pull"
    d.mkdir(parents=True, exist_ok=True)
    lock_path = d / ".pull.lock"
    if lock_path.is_symlink():
        raise PullError("Unsichere Lock-Datei")
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
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


# ---------------------------------------------------------------- Startdatei (launcher.py)

def launcher_root():
    """Ordner der Startdatei, wenn dieses Werkzeug von ihr aus versions/<Fassung>/ gestartet wurde; sonst None."""
    if not os.environ.get("BWK_LAUNCHER"):
        return None
    if HERE.parent.name != "versions" or HERE.name != TOOL_VERSION:
        return None
    root = HERE.parent.parent
    if root.is_symlink() or not (root / "launcher.py").is_file():
        return None
    return root


def launcher_state(root):
    obj = json_or_none(root / "state.json", 64 * 1024)
    if not obj or obj.get("schema") != 1 or not isinstance(obj.get("current"), str):
        return None
    if not isinstance(obj.get("failed"), list):
        obj["failed"] = []
    return obj


def failed_tool_versions(lstate):
    return {e.get("version") for e in (lstate or {}).get("failed", []) if isinstance(e, dict)}


def tools_update_possible(target):
    """(True, None) wenn die Startdatei die Fassung `target` einspielen kann, sonst (False, Grund)."""
    root = launcher_root()
    if root is None:
        return False, "ohne Startdatei (launcher.py) wird das Werkzeug nicht automatisch aktualisiert"
    lstate = launcher_state(root)
    if lstate is None:
        return False, "Zustand der Startdatei ist nicht lesbar"
    if target in failed_tool_versions(lstate):
        return False, f"Werkzeug-Fassung {target} ist bereits einmal fehlgeschlagen"
    return True, None


def stage_tools(ctx, release_version, tools):
    """Legt die freigegebene Werkzeug-Fassung neben die aktive und meldet sie der Startdatei (pending)."""
    root = launcher_root()
    lstate = launcher_state(root) if root else None
    if root is None or lstate is None:
        raise PullError("Startdatei nicht verfügbar")
    target = tools["version"]
    part = ctx.work / "staging" / release_version / "tools.part"
    try:
        if part.is_symlink() or not part.is_file() or deploy.digest_file(part) != tools["sha256"]:
            raise PullError("Geladenes Werkzeug-Paket stimmt nicht mehr mit dem geprüften überein")
        files = deploy.check_tools_zip(part, target)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise PullError("Werkzeug-Paket ungültig: " + str(exc))
    versions = root / "versions"
    if versions.is_symlink() or not versions.is_dir():
        raise PullError("Ordner versions der Startdatei fehlt")
    dest = versions / target
    if dest.is_symlink():
        raise PullError("Werkzeug-Ordner ist ein Symlink")
    if dest.exists():
        for name, data in files.items():
            f = dest / name
            if f.is_symlink() or not f.is_file() or f.read_bytes() != data:
                raise PullError(f"Werkzeug-Ordner {target} existiert bereits mit anderem Inhalt")
    else:
        tmp = versions / (".tmp-%s-%d" % (target, os.getpid()))
        os.mkdir(tmp, 0o755)
        try:
            for name, data in files.items():
                fd = os.open(tmp / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
            os.chmod(tmp, 0o755)
            os.rename(tmp, dest)
        finally:
            if tmp.exists():
                for child in tmp.iterdir():
                    with contextlib.suppress(OSError):
                        os.unlink(child)
                with contextlib.suppress(OSError):
                    os.rmdir(tmp)
    lstate = launcher_state(root) or lstate
    lstate["pending"] = target
    lstate["pending_for"] = release_version
    write_json_file(root / "state.json", lstate, 0o600)


def updater_warnings(root):
    out = []
    try:
        for p in [root, root / "launcher.py", root / "versions", HERE] + [HERE / n for n in deploy.TOOLS_FILES]:
            st = os.lstat(p)
            if st.st_mode & 0o022:
                out.append("Der Ordner des Update-Werkzeugs ist für andere Benutzer beschreibbar (chmod -R go-w empfohlen).")
                break
        for p in [root / "launcher.py", HERE / "bwk_pull.py"]:
            st = os.lstat(p)
            if st.st_uid not in (0, os.geteuid()):
                out.append("Dateien des Update-Werkzeugs gehören einem anderen Benutzer (chown root empfohlen).")
                break
    except OSError:
        out.append("Rechte des Update-Werkzeugs konnten nicht geprüft werden.")
    return out


def publish_updater_status(ctx):
    """Schreibt approvals/updater.json: Fassung des Werkzeugs und Stand der Startdatei (für die Oberfläche)."""
    data = {"schema": 1, "tool_version": TOOL_VERSION, "launcher": False, "updated_at": iso(now())}
    root = launcher_root()
    lstate = launcher_state(root) if root else None
    if root is not None and lstate is not None:
        def entry(e, keys):
            return {k: clean(e.get(k), 600) for k in keys if e.get(k) is not None} if isinstance(e, dict) else None
        data.update(
            launcher=True, launcher_version=clean(os.environ.get("BWK_LAUNCHER", ""), 20),
            current=clean(lstate.get("current"), 20),
            previous=clean(lstate["previous"], 20) if lstate.get("previous") else None,
            pending=clean(lstate["pending"], 20) if lstate.get("pending") else None,
            failed=[x for x in (entry(e, ("version", "at", "reason", "stage")) for e in lstate["failed"][-UPDATER_FAILED_MAX:]) if x],
            last_switch=entry(lstate.get("last_switch"), ("from", "to", "at")),
            last_fallback=entry(lstate.get("last_fallback"), ("version", "at", "reason", "stage", "active")),
            warnings=updater_warnings(root))
    with contextlib.suppress(OSError):
        write_json_file(ctx.approvals / "updater.json", data)


# ---------------------------------------------------------------- Konfiguration

class Ctx:
    def __init__(self, work, project, compose, repo, token, api_base,
                 db_container, db_user, db_name, deploy_script, services=None):
        self.work = work
        self.project = project
        self.compose = compose
        self.repo = repo
        self.token = token
        self.api_base = api_base
        self.db_container = db_container
        self.db_user = db_user
        self.db_name = db_name
        self.deploy_script = deploy_script
        self.services = tuple(services or deploy.DEFAULT_SERVICES)
        self.approvals = work / "approvals"
        self.pull_dir = work / "pull"
        self.has_token_file = bool(token)

    def sub(self, name):
        return self.approvals / name


DEFAULT_REPO = "MJ-Pictures/bot-control-center"


def http_error_text(status, host, remaining=None, with_token=False):
    """1.9.0: verständliche Meldung, vor allem für den Betrieb ohne Token (öffentliches Repository)."""
    base = f"HTTP {status} von {clean(host, 80)}"
    if status in (403, 429) and str(remaining or "").strip() == "0":
        if with_token:
            return base + ": GitHub-Abfragelimit erreicht; nächster Versuch automatisch"
        return (base + ": GitHub-Abfragelimit ohne Token erreicht (60 Abfragen pro Stunde je Internetanschluss); "
                "nächster Versuch automatisch")
    if status == 404 and not with_token:
        return base + ": Repository oder Release nicht gefunden (Repository-Name prüfen; ein privates Repository braucht token_file)"
    if status == 401:
        return base + ": Token ungültig oder abgelaufen"
    return base


def compose_defaults(compose_path):
    """1.9.0: Dienstnamen, Datenbank-Container, -Benutzer und -Name aus einer compose.yaml lesen.

    Bewusst einfache Zeilenauswertung (keine YAML-Bibliothek nötig). Gibt nur gefundene Werte zurück;
    alles Fehlende bleibt beim bisherigen Standard. Erkannt werden die Programmdienste der Vorlage
    (web, twitch, discord, mcp) und die bisherigen Namen (twitchbot, discordbot)."""
    try:
        text = Path(compose_path).read_text(encoding="utf8")
    except (OSError, UnicodeDecodeError):
        return {}
    services, current, in_services = {}, None, False
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 0:
            in_services = line.strip() == "services:"
            current = None
            continue
        if not in_services:
            continue
        m = re.fullmatch(r"  ([A-Za-z0-9][A-Za-z0-9_.-]{0,62}):", line)
        if m:
            current = m.group(1)
            services[current] = {}
            continue
        if current is None:
            continue
        m = re.fullmatch(r"\s+(container_name|POSTGRES_USER|POSTGRES_DB):\s*[\"']?([A-Za-z0-9_.-]{1,63})[\"']?", line)
        if m:
            services[current][m.group(1)] = m.group(2)
    out = {}
    app = [n for n in ("web", "twitch", "discord", "mcp", "twitchbot", "discordbot") if n in services]
    if app:
        out["services"] = app
    for info in services.values():
        if "POSTGRES_USER" in info or "POSTGRES_DB" in info:
            if info.get("container_name"):
                out["db_container"] = info["container_name"]
            if info.get("POSTGRES_USER"):
                out["db_user"] = info["POSTGRES_USER"]
            if info.get("POSTGRES_DB"):
                out["db_name"] = info["POSTGRES_DB"]
            break
    return out


def read_token(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise PullError("Token-Datei nicht lesbar (%s): %s" % (clean(path, 200), exc.strerror or exc))
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > 1024:
            raise PullError("Token-Datei ungültig (keine reguläre Datei oder zu groß)")
        if st.st_mode & 0o077:
            raise PullError("Token-Datei ist für Gruppe/Andere lesbar; bitte chmod 600")
        if st.st_uid not in (0, os.geteuid()):
            raise PullError("Token-Datei gehört weder root noch dem ausführenden Benutzer")
        raw = os.read(fd, 1025).decode("utf8", "replace").strip()
    finally:
        os.close(fd)
    if not TOKEN_RE.fullmatch(raw):
        raise PullError("Token hat kein erwartetes Format")
    return raw


def default_work():
    """Arbeitsordner unter der Startdatei (<Ordner der Startdatei>/work), falls vorhanden; sonst None."""
    root = launcher_root()
    if root is None:
        return None
    work = root / "work"
    return work if work.is_dir() and not work.is_symlink() else None


def resolve_work(args):
    if getattr(args, "work", None):
        return Path(args.work).resolve(strict=True)
    work = default_work()
    if work is None:
        raise PullError("--work fehlt (ohne Angabe wird nur <Ordner der Startdatei>/work verwendet, den es hier nicht gibt)")
    return work.resolve(strict=True)


def load_ctx(args, need_project=True, need_token=True):
    work = resolve_work(args)
    cfg = {}
    cfg_path = Path(args.config) if getattr(args, "config", None) else work / "pull" / "config.json"
    if cfg_path.exists():
        cfg = read_json_safe(cfg_path, MAX_JSON)

    def pick(name, default=None):
        value = getattr(args, name, None)
        if value is None:
            value = cfg.get(name, default)
        return value

    repo = pick("repo")
    if not repo or not REPO_RE.fullmatch(str(repo)):
        raise PullError("repo fehlt oder ist ungültig (Format: besitzer/name)")
    api_base = str(pick("api_base", "https://api.github.com")).rstrip("/")
    token = None
    token_file = pick("token_file")
    if token_file and not Path(token_file).is_absolute():
        token_file = str(work / "pull" / token_file)  # 1.8.0: relativ zum Ordner pull/
    if token_file and need_token:
        token = read_token(Path(token_file))
    project = pick("project")
    compose = pick("compose")
    # 1.8.0: Unter der Startdatei ist der Projektordner der Ordner über ihr (…/deploy/launcher.py).
    root = launcher_root()
    if root is not None and not project and (root.parent / "VERSION").is_file():
        project = str(root.parent)
    if project and not compose and (Path(project) / "compose.yaml").is_file():
        compose = str(Path(project) / "compose.yaml")
    if need_project:
        if not project or not compose:
            raise PullError("project und compose müssen angegeben oder in config.json gesetzt sein")
        project = Path(project).resolve(strict=True)
        compose = Path(compose).resolve(strict=True)
        if project.is_symlink() or not project.is_dir() or not (project / "VERSION").is_file():
            raise PullError("project ist kein Control-Center-Ordner mit VERSION")
        if compose.name not in ("compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"):
            raise PullError("Unerwarteter Compose-Dateiname")
        if project == work or work in project.parents:
            raise PullError("Produktionspfade ungültig")
    script = Path(pick("deploy_script", str(HERE / "bwk_deploy.py"))).resolve(strict=True)
    # 1.5.0: Dienstliste und Datenbank-Container aus config.json (Standard = bisherige Werte).
    try:
        services = deploy.parse_services(pick("services"))
        db_container = deploy.check_container_name(pick("db_container", "bcc-db"))
    except ValueError as exc:
        raise PullError("config.json: " + str(exc))
    ctx = Ctx(work, project, compose, repo, token, api_base,
              db_container, str(pick("db_user", "bwk")),
              str(pick("db_name", "bwk")), script, services)
    ctx.has_token_file = bool(token_file)
    return ctx


def production_version(ctx):
    text = (ctx.project / "VERSION").read_text(encoding="utf8").strip().lstrip("vV")
    if not VERSION_RE.fullmatch(text):
        raise PullError("VERSION des Produktivsystems ist ungültig: " + clean(text, 40))
    return text


# ---------------------------------------------------------------- Zustand

def load_state(ctx):
    obj = json_or_none(ctx.pull_dir / "state.json")
    if not obj or obj.get("schema") != 1 or not isinstance(obj.get("handled"), dict):
        return {"schema": 1, "etag": None, "handled": {}}
    return obj


def save_state(ctx, state):
    write_json_file(ctx.pull_dir / "state.json", state, 0o600)


def mark_handled(state, version, status, sha=None):
    state["handled"][version] = {"status": status, "sha256": sha, "at": iso(now())}


def write_result(ctx, version, status, message="", sha=None, by=None, via=None, extra=None):
    data = {"schema": 1, "version": version, "sha256": sha, "status": status,
            "message": clean(message, 1000), "by": by, "via": via, "at": iso(now())}
    if extra:
        data.update(extra)
    write_json_file(ctx.sub("results") / f"{version}.json", data)


def archive_file(ctx, path, version, kind):
    stamp = now().strftime("%Y%m%dT%H%M%SZ")
    dest = ctx.sub("used")
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / f"{version}-{stamp}-{kind}.json"
    n = 1
    while target.exists():
        target = dest / f"{version}-{stamp}-{kind}-{n}.json"
        n += 1
    try:
        os.replace(path, target)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(path)


# ---------------------------------------------------------------- HTTP

def _loopback(host):
    return host in ("localhost", "127.0.0.1", "::1")


def redirect_host_allowed(host):
    host = (host or "").lower()
    return (_loopback(host) or host in ("api.github.com", "github.com")
            or host.endswith(".githubusercontent.com"))


class Fetcher:
    """Minimaler HTTPS-Client: Weiterleitungen manuell, Token nur an den API-Host."""

    def __init__(self, api_base, token, timeout=30):
        u = urllib.parse.urlsplit(api_base)
        if u.scheme not in ("https", "http") or not u.hostname or u.username or u.password:
            raise PullError("api_base ungültig")
        if u.scheme == "http" and not _loopback(u.hostname):
            raise PullError("HTTP ist nur für Loopback (Tests) erlaubt")
        self.api_base = api_base.rstrip("/")
        self.origin = (u.hostname, u.port)
        self.token = token
        self.timeout = timeout

    def _connect(self, u):
        if u.scheme == "https":
            return http.client.HTTPSConnection(u.hostname, u.port, timeout=self.timeout,
                                               context=ssl.create_default_context())
        if u.scheme == "http" and _loopback(u.hostname):
            return http.client.HTTPConnection(u.hostname, u.port, timeout=self.timeout)
        raise PullError("Unzulässiges URL-Schema", transient=False)

    def get(self, url, accept="application/vnd.github+json", max_bytes=MAX_MANIFEST,
            etag=None, dest=None):
        """Gibt (status, header, body) zurück. Bei dest wird gestreamt: body = (sha256, size)."""
        for hop in range(6):
            u = urllib.parse.urlsplit(url)
            if hop > 0 and not redirect_host_allowed(u.hostname):
                raise PullError("Weiterleitung auf nicht erlaubten Host: " + clean(u.hostname, 80))
            headers = {"Accept": accept, "User-Agent": "bwk-pull/" + TOOL_VERSION,
                       "X-GitHub-Api-Version": "2022-11-28"}
            if self.token and (u.hostname, u.port) == self.origin:
                headers["Authorization"] = "Bearer " + self.token
            if etag and hop == 0:
                headers["If-None-Match"] = etag
            conn = self._connect(u)
            try:
                path = u.path + ("?" + u.query if u.query else "")
                conn.request("GET", path, headers=headers)
                resp = conn.getresponse()
                if resp.status in (301, 302, 303, 307, 308):
                    loc = resp.getheader("Location")
                    if not loc:
                        raise PullError("Weiterleitung ohne Ziel", transient=True)
                    url = urllib.parse.urljoin(url, loc)
                    continue
                if resp.status == 304:
                    return 304, dict(resp.getheaders()), None
                if resp.status != 200:
                    transient = resp.status in (403, 429) or resp.status >= 500
                    raise PullError(http_error_text(resp.status, u.hostname, resp.getheader("X-RateLimit-Remaining"),
                                                    bool(self.token)), transient=transient)
                length = resp.getheader("Content-Length")
                if length and length.isdigit() and int(length) > max_bytes:
                    raise PullError("Antwort größer als erlaubt")
                return 200, dict(resp.getheaders()), self._read(resp, max_bytes, dest)
            except (OSError, http.client.HTTPException, ssl.SSLError) as exc:
                raise PullError("Netzwerkfehler: " + clean(exc, 200), transient=True)
            finally:
                conn.close()
        raise PullError("Zu viele Weiterleitungen")

    @staticmethod
    def _read(resp, max_bytes, dest):
        total = 0
        if dest is None:
            chunks = []
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise PullError("Antwort größer als erlaubt")
                chunks.append(chunk)
            return b"".join(chunks)
        h = hashlib.sha256()
        fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb") as out:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise PullError("Download größer als erlaubt")
                    h.update(chunk)
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(dest)
            raise
        return h.hexdigest(), total


# ---------------------------------------------------------------- Manifest

def validate_manifest(m, version):
    def need(cond, text):
        if not cond:
            raise PullError("Manifest ungültig: " + text)

    need(isinstance(m, dict), "kein Objekt")
    need(m.get("schema") == 1, "schema")
    need(m.get("version") == version, "version passt nicht zum Release-Tag")
    need(m.get("zip") == f"bwk-control-center-v{version}.zip", "zip-Name")
    need(isinstance(m.get("sha256"), str) and SHA_RE.fullmatch(m["sha256"]), "sha256")
    need(isinstance(m.get("size"), int) and not isinstance(m["size"], bool) and 0 < m["size"] <= MAX_ZIP, "size")
    fc = m.get("files_count")
    need(isinstance(fc, int) and not isinstance(fc, bool) and 0 < fc <= deploy.MAX_FILES, "files_count")
    tests = m.get("tests")
    need(tests is None or (isinstance(tests, int) and not isinstance(tests, bool) and 0 <= tests <= 100000), "tests")
    need(isinstance(m.get("auto_deploy"), bool), "auto_deploy")
    reasons = m.get("manual_reasons", [])
    need(isinstance(reasons, list) and len(reasons) <= 20 and all(isinstance(r, str) and len(r) <= 300 for r in reasons),
         "manual_reasons")
    summary = m.get("summary", "")
    need(isinstance(summary, str) and len(summary) <= 500, "summary")
    tools = m.get("tools")
    if tools is not None:
        need(isinstance(tools, dict), "tools")
        tv = tools.get("version")
        need(isinstance(tv, str) and VERSION_RE.fullmatch(tv), "tools.version")
        need(tools.get("zip") == deploy.tools_zip_name(tv), "tools.zip")
        need(isinstance(tools.get("sha256"), str) and SHA_RE.fullmatch(tools["sha256"]), "tools.sha256")
        need(isinstance(tools.get("size"), int) and not isinstance(tools["size"], bool)
             and 0 < tools["size"] <= deploy.MAX_TOOLS_ZIP, "tools.size")
        tools = {"version": tv, "zip": tools["zip"], "sha256": tools["sha256"], "size": tools["size"]}
    return {
        "tools": tools,
        "sha256": m["sha256"], "size": m["size"], "files_count": fc, "tests": tests,
        "auto_deploy": m["auto_deploy"] and not reasons,
        "manual_reasons": [clean(r, 300) for r in reasons],
        "summary": clean(summary, 500),
        "declared_auto_deploy": m["auto_deploy"],
    }


# ---------------------------------------------------------------- Freigaben

def validate_grant(obj, version):
    if obj.get("version") != version:
        raise PullError("Version in der Freigabe passt nicht zum Dateinamen")
    sha = obj.get("sha256")
    if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
        raise PullError("sha256 in der Freigabe ungültig")
    by = obj.get("approved_by")
    if not isinstance(by, str) or not 1 <= len(by) <= 100 or re.search(r"[\x00-\x1f\x7f]", by):
        raise PullError("approved_by ungültig")
    if obj.get("via") not in VIA_ALLOWED:
        raise PullError("via ungültig")
    try:
        at = parse_ts(obj.get("approved_at"))
    except ValueError:
        raise PullError("approved_at ungültig")
    if at.tzinfo is None:
        raise PullError("approved_at ohne Zeitzone")
    return {"version": version, "sha256": sha, "by": by, "via": obj["via"], "at": at}


def remove_pending(ctx, version):
    with contextlib.suppress(FileNotFoundError):
        os.unlink(ctx.sub("pending") / f"{version}.json")


def demote_notice(ctx, version, reason):
    """Macht einen Hinweis nicht mehr freigabefähig (z. B. wenn das nötige Werkzeug-Update fehlschlug)."""
    path = ctx.sub("pending") / f"{version}.json"
    notice = json_or_none(path, MAX_JSON * 16)
    if notice is None:
        return
    notice["status"], notice["approvable"] = "manual-required", False
    reasons = notice.get("manual_reasons") if isinstance(notice.get("manual_reasons"), list) else []
    notice["manual_reasons"] = (reasons + [clean(reason, 300)])[:20]
    write_json_file(path, notice)


def run_deploy(ctx, state, version, notice, grant, note=""):
    folder = ctx.work / "staging" / version
    sha = notice["sha256"]
    req_path = folder / "deployment-request.json"
    if req_path.exists() or (folder / "deployment-result.json").exists() or (folder / "deployment-state.json").exists():
        write_result(ctx, version, "approval-invalid", "Für diese Version existiert bereits eine Anfrage oder ein Ergebnis", sha)
        return
    deploy.write_json(req_path, {"version": version, "sha256": sha, "status": "pending-local-approval",
                                 "requested_via": "pull", "approved_by": grant["by"],
                                 "approved_via": grant["via"], "approved_at": iso(grant["at"])})
    write_result(ctx, version, "deploying", "Installation läuft", sha, grant["by"], grant["via"])
    cmd = [sys.executable, str(ctx.deploy_script), "deploy", version,
           "--work", str(ctx.work), "--project", str(ctx.project), "--compose", str(ctx.compose),
           "--confirm", version, "--expected-sha256", sha,
           "--db-container", ctx.db_container, "--db-user", ctx.db_user, "--db-name", ctx.db_name,
           "--services", ",".join(ctx.services)]
    log(f"Starte Installation von {version} mit Werkzeug {TOOL_VERSION} (freigegeben von {grant['by']} über {grant['via']})")
    timed_out = False
    try:
        proc = subprocess.run(cmd, cwd=str(ctx.work), capture_output=True, text=True, timeout=DEPLOY_TIMEOUT)
        rc, tail = proc.returncode, ((proc.stdout or "") + (proc.stderr or ""))[-3000:]
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        rc, tail = -1, "Zeitüberschreitung nach %d s. %s" % (DEPLOY_TIMEOUT, clean(exc.stderr or "", 500))
    result = json_or_none(folder / "deployment-result.json")
    started = json_or_none(folder / "deployment-state.json")
    if result is None and started is None:
        # Es wurde nichts verändert (z. B. Lock belegt, Compose-Prüfung fehlgeschlagen).
        with contextlib.suppress(FileNotFoundError):
            os.unlink(req_path)
        write_result(ctx, version, "not-started", "Installation nicht gestartet: " + clean(tail, 600), sha,
                     grant["by"], grant["via"])
        log(f"Installation von {version} nicht gestartet (rc={rc}); Freigabe verbraucht, bitte erneut freigeben")
        return
    if result is not None:
        status = result.get("status", "failed")
        extra = {"backup_id": result.get("backup_id")}
        message = result.get("error") or ("Installation abgeschlossen" if status == "deployed" else "")
        if note:
            message = (message + " " + note).strip()
    else:
        status = "failed-manual-recovery-required"
        extra = {"backup_id": (started or {}).get("backup_id")}
        message = "Installation unterbrochen" + (" (Zeitüberschreitung)" if timed_out else "") + ": " + clean(tail, 600)
    write_result(ctx, version, status, message, sha, grant["by"], grant["via"], extra)
    remove_pending(ctx, version)
    mark_handled(state, version, status, sha)
    save_state(ctx, state)
    log(f"Installation von {version}: {status}")


def handle_reject(ctx, state, version, path):
    try:
        obj = validate_grant_like(read_json_safe(path, MAX_JSON), version)
    except (PullError, OSError) as exc:
        archive_file(ctx, path, version, "invalid-reject")
        log(f"Ablehnung {version} ungültig: {exc}")
        return
    notice = json_or_none(ctx.sub("pending") / f"{version}.json")
    archive_file(ctx, path, version, "rejected")
    if notice is None:
        return
    sha = notice.get("sha256")
    write_result(ctx, version, "rejected", "Abgelehnt", sha, obj["by"], obj["via"])
    remove_pending(ctx, version)
    mark_handled(state, version, "rejected", sha)
    save_state(ctx, state)
    log(f"Version {version} abgelehnt von {obj['by']}")


def validate_grant_like(obj, version):
    """Ablehnung: gleiche Felder wie Freigabe, sha256 darf fehlen."""
    patched = dict(obj)
    patched.setdefault("sha256", "0" * 64)
    return validate_grant(patched, version)


def handle_grant(ctx, state, version, path):
    """Gibt True zurück, wenn eine Installation versucht wurde."""
    try:
        grant = validate_grant(read_json_safe(path, MAX_JSON), version)
    except (PullError, OSError) as exc:
        archive_file(ctx, path, version, "invalid")
        write_result(ctx, version, "approval-invalid", str(exc))
        log(f"Freigabe {version} ungültig: {exc}")
        return False
    notice = json_or_none(ctx.sub("pending") / f"{version}.json")
    if notice is None:
        archive_file(ctx, path, version, "orphan")
        log(f"Freigabe {version} ohne offene Anfrage verworfen")
        return False
    sha = notice.get("sha256")
    problem = None
    if notice.get("status") != "awaiting-approval" or notice.get("approvable") is not True:
        problem = "Diese Version ist nicht zur Freigabe vorgesehen"
    elif grant["sha256"] != sha:
        problem = "SHA256 der Freigabe passt nicht zur geprüften Datei"
    elif grant["at"] > now() + CLOCK_SKEW:
        problem = "Zeitpunkt der Freigabe liegt in der Zukunft"
    if problem is None and now() - grant["at"] > APPROVAL_TTL:
        archive_file(ctx, path, version, "expired")
        write_result(ctx, version, "approval-expired", "Freigabe älter als 24 Stunden; bitte erneut freigeben", sha,
                     grant["by"], grant["via"])
        log(f"Freigabe {version} abgelaufen")
        return False
    if problem is None:
        try:
            if vtuple(version) <= vtuple(production_version(ctx)):
                problem = "Version ist nicht neuer als die produktive Version"
        except PullError as exc:
            problem = str(exc)
    if problem is None:
        part = ctx.work / "staging" / version / "update.part"
        try:
            if part.is_symlink() or not part.is_file() or deploy.digest_file(part) != sha:
                problem = "Geladene Datei stimmt nicht mehr mit der geprüften überein"
        except OSError:
            problem = "Geladene Datei fehlt"
    if problem is not None:
        archive_file(ctx, path, version, "invalid")
        write_result(ctx, version, "approval-invalid", problem, sha, grant["by"], grant["via"])
        log(f"Freigabe {version} verworfen: {problem}")
        return False
    # 1.7.0: Bringt das Release eine neuere Werkzeug-Fassung mit, wird zuerst das Werkzeug gewechselt.
    note = ""
    tools = notice.get("tools_update") if isinstance(notice.get("tools_update"), dict) else None
    deferred = notice.get("deep_check_deferred") is True
    if tools and isinstance(tools.get("version"), str) and VERSION_RE.fullmatch(tools["version"]) \
            and vtuple(tools["version"]) > vtuple(TOOL_VERSION):
        target = tools["version"]
        possible, why = tools_update_possible(target)
        if possible:
            lstate = launcher_state(launcher_root()) or {}
            if lstate.get("pending") == target:
                log(f"Werkzeug-Fassung {target} wartet auf das Umschalten durch die Startdatei")
                return True
            try:
                stage_tools(ctx, version, tools)
            except (PullError, OSError) as exc:
                possible, why = False, str(exc)
            else:
                write_result(ctx, version, "tools-pending",
                             f"Werkzeug-Update {target} vorbereitet; die Installation von {version} folgt im nächsten Lauf.",
                             sha, grant["by"], grant["via"], {"tools_version": target})
                log(f"Werkzeug-Fassung {target} bereitgelegt; Installation von {version} folgt im nächsten Lauf")
                return True
        if not possible:
            if deferred:
                reason = f"Diese Version braucht das Werkzeug {target}, das nicht eingespielt werden konnte ({why})."
                archive_file(ctx, path, version, "invalid")
                write_result(ctx, version, "not-started", reason + " Bitte das Werkzeug von Hand aktualisieren.", sha,
                             grant["by"], grant["via"])
                demote_notice(ctx, version, reason)
                mark_handled(state, version, "manual-required", sha)
                save_state(ctx, state)
                log(f"Freigabe {version} verworfen: {reason}")
                return False
            note = f"Hinweis: Das mitgelieferte Werkzeug {target} wurde nicht eingespielt ({why}); installiert mit Werkzeug {TOOL_VERSION}."
    if deferred:
        # Die Dateiprüfung konnte mit der vorherigen Werkzeug-Fassung nicht erfolgen; sie geschieht jetzt, vor jeder Änderung.
        try:
            _, _, files, _ = deploy.verify(ctx.work, version)
            if isinstance(notice.get("files_count"), int) and len(files) != notice["files_count"]:
                raise ValueError(f"Dateizahl weicht ab (Manifest {notice['files_count']}, ZIP {len(files)})")
        except Exception as exc:
            archive_file(ctx, path, version, "invalid")
            write_result(ctx, version, "failed-before-change", "Tiefenprüfung fehlgeschlagen: " + str(exc), sha,
                         grant["by"], grant["via"])
            demote_notice(ctx, version, "Tiefenprüfung mit dem neuen Werkzeug fehlgeschlagen")
            mark_handled(state, version, "check-failed", sha)
            save_state(ctx, state)
            log(f"Release {version} abgelehnt: Tiefenprüfung fehlgeschlagen: {exc}")
            return False
    # Einmalig: Freigabedatei wird verbraucht, bevor installiert wird.
    archive_file(ctx, path, version, "used")
    run_deploy(ctx, state, version, notice, grant, note)
    return True


def apply_approvals(ctx):
    state = load_state(ctx)
    for version, path in list_versions(ctx.sub("rejected")):
        handle_reject(ctx, state, version, path)
    for version, path in sorted(list_versions(ctx.sub("granted")), key=lambda x: vtuple(x[0])):
        if handle_grant(ctx, state, version, path):
            break


# ---------------------------------------------------------------- GitHub-Abfrage

def pick_release(releases):
    best = None
    for rel in releases if isinstance(releases, list) else []:
        if not isinstance(rel, dict) or rel.get("draft") or rel.get("prerelease"):
            continue
        m = TAG_RE.fullmatch(str(rel.get("tag_name", "")))
        if not m:
            continue
        version = m.group(1)
        if best is None or vtuple(version) > vtuple(best[0]):
            best = (version, rel)
    return best


def find_asset(release, name):
    for a in release.get("assets") or []:
        if (isinstance(a, dict) and a.get("name") == name and a.get("state", "uploaded") == "uploaded"
                and isinstance(a.get("id"), int) and not isinstance(a.get("id"), bool)):
            return a
    return None


def write_notice(ctx, version, status, sha=None, manifest=None, files=None, release=None,
                 error=None, approvable=False, prod=None, tools_update=None, deferred=False):
    notice = {
        "schema": 1, "version": version, "status": status, "approvable": approvable,
        "sha256": sha, "sha256_short": sha[:12] if sha else None,
        "production_version": prod, "created_at": iso(now()),
    }
    if manifest:
        notice.update(size=manifest["size"], files_count=manifest["files_count"], tests=manifest["tests"],
                      manual_reasons=manifest["manual_reasons"], summary=manifest["summary"])
    if files is not None:
        notice["files"] = files[:NOTICE_FILES_MAX]
        notice["files_total"] = len(files)
    if release:
        url = str(release.get("html_url", ""))
        notice["release_url"] = url if url.startswith("https://github.com/") else None
        notice["published_at"] = clean(release.get("published_at") or "", 40)
    if error:
        notice["error"] = clean(error, 600)
    if tools_update:
        notice["tools_update"] = tools_update
    if deferred:
        notice["deep_check_deferred"] = True
    write_json_file(ctx.sub("pending") / f"{version}.json", notice)


def cleanup_pending(ctx, prod):
    for version, path in list_versions(ctx.sub("pending")):
        if vtuple(version) <= vtuple(prod):
            with contextlib.suppress(OSError):
                os.unlink(path)


def supersede_older(ctx, state, newer):
    for version, path in list_versions(ctx.sub("pending")):
        if vtuple(version) < vtuple(newer):
            notice = json_or_none(path) or {}
            if notice.get("status") == "awaiting-approval":
                write_result(ctx, version, "superseded", f"Durch {newer} ersetzt", notice.get("sha256"))
                mark_handled(state, version, "superseded", notice.get("sha256"))
            with contextlib.suppress(OSError):
                os.unlink(path)
            with contextlib.suppress(OSError):
                os.unlink(ctx.sub("granted") / f"{version}.json")


def drop_staging(folder):
    for name in ("update.part", "upload.json", "host-review.json", "tools.part"):
        with contextlib.suppress(OSError):
            os.unlink(folder / name)
    with contextlib.suppress(OSError):
        os.rmdir(folder)


def poll(ctx):
    prod = production_version(ctx)
    cleanup_pending(ctx, prod)
    state = load_state(ctx)
    fetch = Fetcher(ctx.api_base, ctx.token)
    status, headers, body = fetch.get(f"{ctx.api_base}/repos/{ctx.repo}/releases?per_page=20",
                                      max_bytes=2 * 1024 * 1024, etag=state.get("etag"))
    if status == 304:
        log("Keine Änderung bei GitHub")
        return
    try:
        releases = json.loads(body.decode("utf8"))
    except (UnicodeDecodeError, ValueError):
        raise PullError("Antwort von GitHub ist kein JSON", transient=True)
    new_etag = {k.lower(): v for k, v in headers.items()}.get("etag")
    picked = pick_release(releases)
    if picked is None or vtuple(picked[0]) <= vtuple(prod):
        log(f"Kein neueres Release (produktiv {prod})")
        state["etag"] = new_etag
        save_state(ctx, state)
        return
    version, release = picked
    if version in state["handled"]:
        log(f"Release {version} bereits behandelt ({state['handled'][version]['status']})")
        state["etag"] = new_etag
        save_state(ctx, state)
        return
    log(f"Neues Release {version} gefunden (produktiv {prod})")
    process_release(ctx, state, fetch, version, release, prod)
    state["etag"] = new_etag
    save_state(ctx, state)


def process_release(ctx, state, fetch, version, release, prod):
    zip_name = f"bwk-control-center-v{version}.zip"
    zip_asset = find_asset(release, zip_name)
    man_asset = find_asset(release, "release-manifest.json")
    if zip_asset is None or man_asset is None:
        fail_check(ctx, state, version, "Release enthält nicht beide Dateien (ZIP und release-manifest.json)", prod, release)
        return
    _, _, raw = fetch.get(f"{ctx.api_base}/repos/{ctx.repo}/releases/assets/{man_asset['id']}",
                          accept="application/octet-stream", max_bytes=MAX_MANIFEST)
    try:
        manifest = validate_manifest(json.loads(raw.decode("utf8")), version)
    except (PullError, UnicodeDecodeError, ValueError) as exc:
        fail_check(ctx, state, version, str(exc), prod, release)
        return
    if zip_asset.get("size") != manifest["size"]:
        fail_check(ctx, state, version, "Größe des ZIP-Assets weicht vom Manifest ab", prod, release, manifest=manifest)
        return
    folder = ctx.work / "staging" / version
    existing = folder.exists()
    if existing:
        done = folder / "deployment-result.json"
        if done.exists() or (folder / "deployment-state.json").exists():
            mark_handled(state, version, deploy.effective_deployment_state(folder))
            return
    created = False
    part = folder / "update.part"
    if existing and part.is_file() and not part.is_symlink() and deploy.digest_file(part) == manifest["sha256"] \
            and (folder / "upload.json").is_file():
        log("Staging bereits vorhanden und identisch; kein erneuter Download")
    elif existing and any(folder.iterdir()):
        fail_check(ctx, state, version, "Staging-Ordner existiert bereits mit anderem Inhalt", prod, release, manifest=manifest)
        return
    else:
        folder.mkdir(parents=True, exist_ok=True)
        created = True
        tmp = folder / ("update.part.tmp-%d" % os.getpid())
        try:
            sha, size = fetch.get(f"{ctx.api_base}/repos/{ctx.repo}/releases/assets/{zip_asset['id']}",
                                  accept="application/octet-stream", max_bytes=MAX_ZIP, dest=tmp)[2]
        except PullError:
            if created:
                drop_staging(folder)
            raise
        if sha != manifest["sha256"] or size != manifest["size"]:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            drop_staging(folder)
            fail_check(ctx, state, version, "SHA256 oder Größe des ZIP stimmt nicht mit dem Manifest überein",
                       prod, release, manifest=manifest)
            return
        os.replace(tmp, part)
        deploy.write_json(folder / "upload.json", {"version": version, "sha256": sha, "created_via": "github-pull",
                                                   "release_tag": "v" + version})
    # 1.7.0: Neuere Werkzeug-Fassung im Release? Paket laden und prüfen (nie ausführen).
    tools_update = None
    tools = manifest.get("tools")
    if tools and vtuple(tools["version"]) > vtuple(TOOL_VERSION):
        try:
            fetch_tools_package(ctx, fetch, release, folder, tools)
        except PullError as exc:
            if exc.transient:
                if created:
                    drop_staging(folder)
                raise
            if created:
                drop_staging(folder)
            fail_check(ctx, state, version, "Werkzeug-Paket: " + str(exc), prod, release, manifest=manifest)
            return
        possible, why = tools_update_possible(tools["version"])
        tools_update = {"version": tools["version"], "from": TOOL_VERSION, "sha256": tools["sha256"],
                        "size": tools["size"], "mode": "auto" if possible else "manual"}
        if not possible:
            tools_update["reason"] = clean(why, 300)
    deferred = False
    try:
        _, _, files, actual = deploy.verify(ctx.work, version)
    except Exception as exc:  # Tiefenprüfung des bestehenden Werkzeugs
        if tools_update and tools_update["mode"] == "auto":
            # Das ZIP braucht vermutlich das neue Werkzeug: Die Tiefenprüfung folgt nach der Freigabe mit der
            # neuen Fassung, vor jeder Änderung. SHA256 und Größe sind bereits gegen das Manifest geprüft.
            deferred, files, actual = True, None, manifest["sha256"]
            log(f"Tiefenprüfung von {version} mit Werkzeug {TOOL_VERSION} nicht möglich ({exc}); "
                f"sie folgt mit Werkzeug {tools_update['version']} nach der Freigabe")
        else:
            if created:
                drop_staging(folder)
            hint = ""
            if tools_update:
                hint = f" (Das Release bringt Werkzeug {tools_update['version']} mit: {tools_update.get('reason', '')}.)"
            fail_check(ctx, state, version, "Tiefenprüfung fehlgeschlagen: " + str(exc) + hint, prod, release, manifest=manifest)
            return
    if files is not None and len(files) != manifest["files_count"]:
        if created:
            drop_staging(folder)
        fail_check(ctx, state, version, f"Dateizahl weicht ab (Manifest {manifest['files_count']}, ZIP {len(files)})",
                   prod, release, manifest=manifest)
        return
    names = sorted(rel for rel, _ in files) if files is not None else None
    if manifest["auto_deploy"]:
        write_notice(ctx, version, "awaiting-approval", actual, manifest, names, release, approvable=True, prod=prod,
                     tools_update=tools_update, deferred=deferred)
        mark_handled(state, version, "awaiting-approval", actual)
        supersede_older(ctx, state, version)
        log(f"Release {version} geprüft, wartet auf Freigabe (SHA256 {actual[:12]}…)")
    else:
        write_notice(ctx, version, "manual-required", actual, manifest, names, release, approvable=False, prod=prod,
                     tools_update=tools_update, deferred=deferred)
        mark_handled(state, version, "manual-required", actual)
        supersede_older(ctx, state, version)
        log(f"Release {version} geprüft, aber manuelle Installation nötig: " + "; ".join(manifest["manual_reasons"] or ["auto_deploy=false"]))


def fetch_tools_package(ctx, fetch, release, folder, tools):
    """Lädt das Werkzeug-Paket nach staging/<Version>/tools.part und prüft es gegen das Manifest."""
    part = folder / "tools.part"
    if part.is_symlink():
        raise PullError("tools.part ist ein Symlink")
    if not (part.is_file() and deploy.digest_file(part) == tools["sha256"]):
        asset = find_asset(release, tools["zip"])
        if asset is None:
            raise PullError("Release enthält das im Manifest genannte Werkzeug-Paket nicht")
        if asset.get("size") != tools["size"]:
            raise PullError("Größe des Werkzeug-Pakets weicht vom Manifest ab")
        tmp = folder / ("tools.part.tmp-%d" % os.getpid())
        try:
            sha, size = fetch.get(f"{ctx.api_base}/repos/{ctx.repo}/releases/assets/{asset['id']}",
                                  accept="application/octet-stream", max_bytes=deploy.MAX_TOOLS_ZIP, dest=tmp)[2]
            if sha != tools["sha256"] or size != tools["size"]:
                raise PullError("SHA256 oder Größe stimmt nicht mit dem Manifest überein")
            os.replace(tmp, part)
        finally:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
    try:
        deploy.check_tools_zip(part, tools["version"])
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        with contextlib.suppress(OSError):
            os.unlink(part)
        raise PullError(str(exc))


def fail_check(ctx, state, version, message, prod, release, manifest=None):
    write_notice(ctx, version, "check-failed", None, manifest, None, release, error=message, approvable=False, prod=prod)
    mark_handled(state, version, "check-failed")
    log(f"Release {version} abgelehnt: {message}")


# ---------------------------------------------------------------- Befehle

def cmd_run(args):
    ctx = load_ctx(args)
    with pull_lock(ctx.work) as got:
        if not got:
            log("Ein anderer Lauf ist aktiv; beendet")
            return 0
        for sub in ("pending", "granted", "rejected", "used", "results"):
            ctx.sub(sub).mkdir(parents=True, exist_ok=True)
        setup_logfile(ctx.pull_dir / "pull.log")
        publish_updater_status(ctx)
        try:
            if args.only in (None, "apply"):
                apply_approvals(ctx)
            if args.only in (None, "poll"):
                try:
                    poll(ctx)
                except PullError as exc:
                    if exc.transient:
                        log("WARNUNG (vorübergehend): " + str(exc))
                        return 0
                    raise
        finally:
            publish_updater_status(ctx)
    return 0


def cmd_approve(args, reject=False):
    ctx = load_ctx(args, need_project=False, need_token=False)
    version = args.version
    if not VERSION_RE.fullmatch(version):
        raise PullError("Version muss x.y.z sein")
    if args.confirm != version:
        raise PullError("--confirm muss exakt der Version entsprechen")
    by = clean(args.by, 100).strip()
    if not by:
        raise PullError("--by (Name) erforderlich")
    notice = json_or_none(ctx.sub("pending") / f"{version}.json")
    if notice is None:
        raise PullError("Keine offene Anfrage für diese Version")
    body = {"version": version, "approved_by": by, "via": "cli", "approved_at": iso(now())}
    if reject:
        target = ctx.sub("rejected") / f"{version}.json"
    else:
        if notice.get("status") != "awaiting-approval" or notice.get("approvable") is not True:
            raise PullError("Diese Version ist nicht zur Freigabe vorgesehen (Status: %s)" % notice.get("status"))
        part = ctx.work / "staging" / version / "update.part"
        if part.is_symlink() or not part.is_file() or deploy.digest_file(part) != notice.get("sha256"):
            raise PullError("Geladene Datei stimmt nicht mit der geprüften überein")
        body["sha256"] = notice["sha256"]
        target = ctx.sub("granted") / f"{version}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "w", encoding="utf8") as f:
        json.dump(body, f, indent=2, ensure_ascii=False)
    print(("Ablehnung" if reject else "Freigabe") + f" für {version} geschrieben; wird beim nächsten Lauf verarbeitet.")
    return 0


def cmd_status(args):
    ctx = load_ctx(args, need_token=False)
    print("Produktive Version:", production_version(ctx))
    print("Quelle:", ctx.repo, "(mit Token)" if ctx.has_token_file else "(ohne Token, öffentliches Repository)")
    root = launcher_root()
    lstate = launcher_state(root) if root else None
    if lstate:
        print(f"Update-Werkzeug: {TOOL_VERSION} (Startdatei aktiv; Rückfall: {lstate.get('previous') or '–'}; "
              f"bereitgelegt: {lstate.get('pending') or '–'})")
        for e in lstate["failed"][-3:]:
            if isinstance(e, dict):
                print(f"  fehlgeschlagen: {clean(e.get('version'), 20)} am {clean(e.get('at'), 40)} – {clean(e.get('reason'), 200)}")
    else:
        print(f"Update-Werkzeug: {TOOL_VERSION} (ohne Startdatei)")
    for title, sub in (("Offene Anfragen", "pending"), ("Ergebnisse", "results")):
        print(f"\n{title}:")
        items = list_versions(ctx.sub(sub))
        if not items:
            print("  (keine)")
        for version, path in items:
            obj = json_or_none(path) or {}
            print(f"  {version}: {obj.get('status')} {obj.get('sha256_short') or (obj.get('sha256') or '')[:12]} "
                  f"{obj.get('message') or obj.get('error') or ''}".rstrip())
    return 0


def cmd_init(args):
    """Legt Verzeichnisse und config.json an. Eine vorhandene config.json wird nie verändert.

    1.9.0: Unter der Startdatei ist --work nicht nötig (Standard <Ordner der Startdatei>/work, wird angelegt).
    token_file wird nur eingetragen, wenn es angegeben ist (öffentliches Repository: kein Token).
    project/compose bleiben unter der Startdatei leer (Standard: der Ordner über ihr); Dienste und
    Datenbank-Werte werden aus der compose.yaml gelesen."""
    root = launcher_root()
    if not getattr(args, "work", None) and root is not None:
        work_dir = root / "work"
        if work_dir.is_symlink():
            raise PullError("Arbeitsordner ist ein Symlink: " + str(work_dir))
        work_dir.mkdir(mode=0o700, exist_ok=True)
    work = resolve_work(args)
    for sub in ("pending", "granted", "rejected", "used", "results"):
        (work / "approvals" / sub).mkdir(parents=True, exist_ok=True)
    (work / "pull").mkdir(parents=True, exist_ok=True)
    cfg = work / "pull" / "config.json"
    if cfg.exists():
        print("config.json existiert bereits; nicht verändert:", cfg)
    else:
        data = {"repo": args.repo or DEFAULT_REPO}
        if args.token_file:
            data["token_file"] = args.token_file
        project = args.project
        if not project and root is not None and (root.parent / "VERSION").is_file():
            project_for_detect = root.parent  # Standard unter der Startdatei, wird nicht eingetragen
        else:
            project_for_detect = Path(project) if project else None
            data["project"] = project or "/PFAD/ZUM/PROJEKTORDNER"
        compose = args.compose
        if compose:
            data["compose"] = compose
        elif "project" in data:
            data["compose"] = (project + "/compose.yaml") if project else "/PFAD/ZUM/PROJEKTORDNER/compose.yaml"
        detect_from = Path(compose) if compose else (project_for_detect / "compose.yaml" if project_for_detect else None)
        found = compose_defaults(detect_from) if detect_from else {}
        data["db_container"] = found.get("db_container", "bcc-db")
        data["db_user"] = found.get("db_user", "bwk")
        data["db_name"] = found.get("db_name", "bwk")
        data["services"] = found.get("services", list(deploy.DEFAULT_SERVICES))
        write_json_file(cfg, data, 0o600)
        print("config.json angelegt (bitte prüfen):", cfg)
        print(json.dumps(data, indent=2, ensure_ascii=False))
        if found:
            print("Aus", detect_from, "übernommen:", ", ".join(sorted(found)))
    if args.token_file:
        try:
            read_token(Path(args.token_file))
            print("Token-Datei ok (Modus, Besitzer, Format).")
        except (PullError, OSError) as exc:
            print("WARNUNG Token-Datei:", exc)
    return 0


def cmd_selftest():
    """Selbsttest ohne Docker, Netz und Konfiguration. Letzte Ausgabezeile: JSON {"ok", "version", "problems"}."""
    problems = []

    def check(cond, text):
        if not cond:
            problems.append(text)

    try:
        check(deploy.TOOL_VERSION == TOOL_VERSION, f"bwk_deploy.py hat Fassung {deploy.TOOL_VERSION}")
        check(HERE.parent.name != "versions" or HERE.name == TOOL_VERSION, f"Ordner {HERE.name} passt nicht zur Fassung")
        for name in deploy.TOOLS_FILES:
            check((HERE / name).is_file() and not (HERE / name).is_symlink(), f"{name} fehlt")
        spec = importlib.util.spec_from_file_location("bwk_manifest_selftest", str(HERE / "make_release_manifest.py"))
        mrm = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mrm)
        check(mrm.TOOL_VERSION == TOOL_VERSION, f"make_release_manifest.py hat Fassung {mrm.TOOL_VERSION}")
        proc = subprocess.run([sys.executable, str(HERE / "bwk_deploy.py"), "--version"], capture_output=True, text=True, timeout=30)
        check(proc.returncode == 0 and proc.stdout.strip() == "bwk_deploy " + TOOL_VERSION, "bwk_deploy.py --version unerwartet")
        # Vertragsprüfung: Schleuse, Namen, Manifest, Tiefenprüfung eines Mini-Archivs.
        allowed = lambda p: deploy.allowed(PurePosixPath(p))
        check(allowed("app/server.js") and allowed("VERSION") and allowed("UPDATE-1.2.3.md") and allowed("mcp-app/server.mjs"),
              "Schleuse lehnt erlaubte Dateien ab")
        for bad in ("compose.yaml", "secrets/x", ".env", "data/x.json", "deploy/launcher.py", "deploy-work/x", "postgres-data/x"):
            check(not allowed(bad), f"Schleuse erlaubt {bad}")
        check(deploy.parse_services("web,twitch,discord") == ("web", "twitch", "discord"), "Dienstliste")
        check(deploy.check_container_name("bcc-db") == "bcc-db", "Containername")
        sha = "a" * 64
        m = validate_manifest({"schema": 1, "version": "1.2.3", "zip": "bwk-control-center-v1.2.3.zip", "sha256": sha,
                               "size": 10, "files_count": 3, "tests": 1, "auto_deploy": True,
                               "tools": {"version": "9.9.9", "zip": "bwk-tools-v9.9.9.zip", "sha256": sha, "size": 10}}, "1.2.3")
        check(m["auto_deploy"] is True and m["tools"]["version"] == "9.9.9", "Manifestprüfung")
        tmp = Path(tempfile.mkdtemp(prefix="bwk-selftest-"))
        try:
            folder = tmp / "staging" / "1.2.3"
            folder.mkdir(parents=True)
            with zipfile.ZipFile(folder / "update.part", "w") as z:
                for name, text in (("VERSION", "1.2.3\n"), ("app/server.js", "//\n"), ("public/index.html", "<html></html>\n")):
                    z.writestr("bwk-control-center-v1.2.3/" + name, text)
            digest = deploy.digest_file(folder / "update.part")
            deploy.write_json(folder / "upload.json", {"version": "1.2.3", "sha256": digest})
            _, _, files, actual = deploy.verify(tmp, "1.2.3")
            check(len(files) == 3 and actual == digest, "Tiefenprüfung")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    except Exception as exc:  # jeder Fehler ist ein nicht bestandener Selbsttest
        problems.append("Ausnahme: %s: %s" % (exc.__class__.__name__, clean(exc, 200)))
    print(json.dumps({"ok": not problems, "version": TOOL_VERSION, "problems": problems}, ensure_ascii=False))
    return 0 if not problems else 1


def build_parser():
    ap = argparse.ArgumentParser(description="BWK Pull-Deployment " + TOOL_VERSION)
    ap.add_argument("--work", help="Arbeitsordner (deploy-work); unter der Startdatei Standard: <ihr Ordner>/work")
    ap.add_argument("--config", help="Alternative Konfigurationsdatei")
    ap.add_argument("--repo")
    ap.add_argument("--token-file", dest="token_file")
    ap.add_argument("--project")
    ap.add_argument("--compose")
    sub = ap.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="Freigaben verarbeiten und GitHub abfragen (für den Aufgabenplaner)")
    r.add_argument("--only", choices=["poll", "apply"])
    for name in ("approve", "reject"):
        p = sub.add_parser(name, help="Version " + ("freigeben" if name == "approve" else "ablehnen"))
        p.add_argument("version")
        p.add_argument("--confirm", required=True, help="Version erneut eintippen")
        p.add_argument("--by", required=True, help="Name des Freigebenden")
    sub.add_parser("status", help="Stand anzeigen")
    sub.add_parser("init", help="Verzeichnisse und config.json anlegen")
    return ap


def main(argv=None):
    if list(sys.argv[1:] if argv is None else argv)[:1] == ["selftest"]:
        return cmd_selftest()
    args = build_parser().parse_args(argv)
    if args.command == "run":
        return cmd_run(args)
    if args.command == "approve":
        return cmd_approve(args)
    if args.command == "reject":
        return cmd_approve(args, reject=True)
    if args.command == "status":
        return cmd_status(args)
    return cmd_init(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (PullError, ValueError, OSError) as exc:
        print("FEHLER:", exc, file=sys.stderr)
        sys.exit(1)
    except Exception:  # unerwarteter Abbruch: eigener Code, damit die Startdatei ihn erkennt
        traceback.print_exc()
        sys.exit(CRASH_CODE)
