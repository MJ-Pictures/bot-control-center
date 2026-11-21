#!/usr/bin/env python3
"""Tests für die Startdatei (launcher.py) und das Selbstupdate des Werkzeugs (1.7.0).

Ausführen:  python3 -m unittest -v test_launcher   (im Ordner tools/deploy/)
Teil A prüft die Startdatei mit kleinen Attrappen, Teil B den ganzen Weg mit dem echten Werkzeug
gegen den simulierten GitHub-Server aus test_bwk_pull. Kein Docker, kein Netz außer Loopback.
"""
import fcntl
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bwk_pull  # noqa: E402
import make_release_manifest as mrm  # noqa: E402
import make_tools_package as mtp  # noqa: E402
import test_bwk_pull as base  # noqa: E402

deploy = bwk_pull.deploy
CUR = bwk_pull.TOOL_VERSION
NEW = "9.9.9"
TOOL_FILES = ("bwk_pull.py", "bwk_deploy.py", "make_release_manifest.py")

FAKE_TOOL = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
VERSION = HERE.name
a = sys.argv[1:]
if a[:1] == ["selftest"]:
    mode = (HERE / "selftest-mode").read_text().strip() if (HERE / "selftest-mode").exists() else "ok"
    if mode == "fail":
        print(json.dumps({"ok": False, "version": VERSION, "problems": ["absichtlich"]})); sys.exit(1)
    if mode == "wrong-version":
        print(json.dumps({"ok": True, "version": "0.0.1"})); sys.exit(0)
    if mode == "garbage":
        print("kein json"); sys.exit(0)
    print(json.dumps({"ok": True, "version": VERSION})); sys.exit(0)
with open(HERE.parent.parent / "calls.jsonl", "a") as f:
    f.write(json.dumps({"version": VERSION, "args": a, "launcher": os.environ.get("BWK_LAUNCHER")}) + "\n")
rc = (HERE / "exit-code").read_text().strip() if (HERE / "exit-code").exists() else "0"
sys.exit(int(rc))
'''


def tool_sources(version=None, mutate=None):
    """Die echten Werkzeug-Dateien, auf Wunsch mit anderer Fassungsnummer und weiteren Änderungen."""
    out = {}
    for name in TOOL_FILES:
        text = (HERE / name).read_text(encoding="utf8")
        if version:
            assert text.count(f'TOOL_VERSION = "{CUR}"') == 1, name
            text = text.replace(f'TOOL_VERSION = "{CUR}"', f'TOOL_VERSION = "{version}"')
        out[name] = text
    if mutate:
        mutate(out)
    return {k: v.encode("utf8") for k, v in out.items()}


def tools_zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            z.writestr(name, files[name])
    return buf.getvalue()


class LauncherDir:
    """Ordner mit launcher.py und Fassungen unter versions/."""

    def __init__(self, root):
        self.root = Path(root)
        (self.root / "versions").mkdir(parents=True)
        shutil.copyfile(HERE / "launcher.py", self.root / "launcher.py")

    def add_fake(self, version, selftest="ok", exit_code=0):
        d = self.root / "versions" / version
        d.mkdir()
        for name in TOOL_FILES:
            (d / name).write_text(FAKE_TOOL if name == "bwk_pull.py" else "# Attrappe\n")
        (d / "selftest-mode").write_text(selftest)
        (d / "exit-code").write_text(str(exit_code))
        return d

    def add_real(self, version=None, mutate=None):
        d = self.root / "versions" / (version or CUR)
        d.mkdir()
        for name, data in tool_sources(version, mutate).items():
            (d / name).write_bytes(data)
        return d

    def set_state(self, **kw):
        state = {"schema": 1, "current": None, "previous": None, "pending": None, "trial": None, "failed": []}
        state.update(kw)
        (self.root / "state.json").write_text(json.dumps(state))

    def state(self):
        return json.loads((self.root / "state.json").read_text())

    def run(self, *args, env=None):
        e = dict(os.environ)
        e.pop("BWK_LAUNCHER", None)
        e.update(env or {})
        return subprocess.run([sys.executable, str(self.root / "launcher.py")] + list(args),
                              capture_output=True, text=True, timeout=120, env=e)

    def calls(self):
        p = self.root / "calls.jsonl"
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []


class StartdateiMitAttrappen(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bwk-launcher-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.ld = LauncherDir(self.tmp / "deploy")

    def test_reicht_befehle_an_aktive_fassung_durch(self):
        self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0")
        self.ld.set_state(current="1.0.0", pending="2.0.0")
        r = self.ld.run("--work", "/irgendwo", "status")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.ld.calls(), [{"version": "1.0.0", "args": ["--work", "/irgendwo", "status"], "launcher": "1"}])
        # Kein Umschalten außerhalb von `run`.
        self.assertEqual(self.ld.state()["pending"], "2.0.0")
        self.assertEqual(self.ld.state()["current"], "1.0.0")

    def test_exitcode_der_fassung_wird_weitergegeben(self):
        self.ld.add_fake("1.0.0", exit_code=1)
        self.ld.set_state(current="1.0.0")
        self.assertEqual(self.ld.run("--work", "/x", "run").returncode, 1)
        self.assertEqual(self.ld.run("--work", "/x", "status").returncode, 1)

    def test_state_wird_bei_genau_einer_fassung_angelegt(self):
        self.ld.add_fake("1.0.0")
        r = self.ld.run("--work", "/x", "run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.ld.state()["current"], "1.0.0")
        self.assertEqual(len(self.ld.calls()), 1)

    def test_state_fehlt_bei_mehreren_fassungen_ist_fehler(self):
        self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0")
        r = self.ld.run("--work", "/x", "run")
        self.assertEqual(r.returncode, 2)
        self.assertIn("state.json fehlt", r.stderr)
        self.assertEqual(self.ld.calls(), [])

    def test_kaputte_state_datei_ist_fehler_ohne_ausfuehrung(self):
        self.ld.add_fake("1.0.0")
        (self.ld.root / "state.json").write_text("{kaputt")
        r = self.ld.run("--work", "/x", "run")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(self.ld.calls(), [])

    def test_umschalten_nach_bestandenem_selbsttest(self):
        self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0")
        self.ld.set_state(current="1.0.0", pending="2.0.0", pending_for="9.0.1")
        r = self.ld.run("--work", "/x", "run")
        self.assertEqual(r.returncode, 0, r.stderr)
        s = self.ld.state()
        self.assertEqual((s["current"], s["previous"], s["pending"], s["trial"]), ("2.0.0", "1.0.0", None, None))
        self.assertEqual((s["last_switch"]["from"], s["last_switch"]["to"]), ("1.0.0", "2.0.0"))
        self.assertNotIn("pending_for", s)
        self.assertEqual([c["version"] for c in self.ld.calls()], ["2.0.0"])
        self.ld.run("--work", "/x", "run")
        self.assertEqual([c["version"] for c in self.ld.calls()], ["2.0.0", "2.0.0"])
        self.assertEqual(self.ld.state()["failed"], [])

    def test_selbsttest_fehlgeschlagen_alte_fassung_laeuft_weiter(self):
        for mode in ("fail", "wrong-version", "garbage"):
            with self.subTest(mode=mode):
                shutil.rmtree(self.ld.root)
                self.ld = LauncherDir(self.ld.root)
                self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0", selftest=mode)
                self.ld.set_state(current="1.0.0", pending="2.0.0")
                r = self.ld.run("--work", "/x", "run")
                self.assertEqual(r.returncode, 0, r.stderr)
                s = self.ld.state()
                self.assertEqual((s["current"], s["pending"], s["trial"]), ("1.0.0", None, None))
                self.assertEqual([(e["version"], e["stage"]) for e in s["failed"]], [("2.0.0", "selftest")])
                self.assertEqual(s["last_fallback"]["version"], "2.0.0")
                self.assertEqual(s["last_fallback"]["active"], "1.0.0")
                self.assertEqual([c["version"] for c in self.ld.calls()], ["1.0.0"])

    def test_fehlende_oder_unvollstaendige_neue_fassung(self):
        self.ld.add_fake("1.0.0")
        d = self.ld.add_fake("2.0.0"); os.unlink(d / "bwk_deploy.py")
        self.ld.set_state(current="1.0.0", pending="2.0.0")
        self.assertEqual(self.ld.run("--work", "/x", "run").returncode, 0)
        s = self.ld.state()
        self.assertEqual(s["current"], "1.0.0")
        self.assertIn("unvollständig", s["failed"][0]["reason"])

    def test_symlink_als_fassung_wird_abgelehnt(self):
        self.ld.add_fake("1.0.0")
        outside = self.tmp / "fremd"; outside.mkdir()
        for name in TOOL_FILES:
            (outside / name).write_text(FAKE_TOOL)
        os.symlink(outside, self.ld.root / "versions" / "2.0.0")
        self.ld.set_state(current="1.0.0", pending="2.0.0")
        self.assertEqual(self.ld.run("--work", "/x", "run").returncode, 0)
        self.assertEqual(self.ld.state()["current"], "1.0.0")
        self.assertEqual([c["version"] for c in self.ld.calls()], ["1.0.0"])

    def test_ungueltiger_name_in_pending_wird_verworfen(self):
        self.ld.add_fake("1.0.0")
        self.ld.set_state(current="1.0.0", pending="../../etc")
        self.assertEqual(self.ld.run("--work", "/x", "run").returncode, 0)
        s = self.ld.state() if (self.ld.root / "state.json").exists() else {}
        self.assertEqual(s.get("current"), "1.0.0")
        self.assertEqual([c["version"] for c in self.ld.calls()], ["1.0.0"])

    def test_abbruch_im_ersten_lauf_schaltet_zurueck(self):
        for code in (70, 137):
            with self.subTest(code=code):
                shutil.rmtree(self.ld.root)
                self.ld = LauncherDir(self.ld.root)
                self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0", exit_code=code)
                self.ld.set_state(current="1.0.0", pending="2.0.0")
                r = self.ld.run("--work", "/x", "run")
                self.assertEqual(r.returncode, code)
                s = self.ld.state()
                self.assertEqual((s["current"], s["previous"], s["trial"]), ("1.0.0", None, None))
                self.assertEqual([(e["version"], e["stage"]) for e in s["failed"]], [("2.0.0", "first-run")])
                # Der abgebrochene Lauf wird nicht mit der alten Fassung wiederholt; der nächste nutzt sie.
                self.assertEqual([c["version"] for c in self.ld.calls()], ["2.0.0"])
                self.ld.run("--work", "/x", "run")
                self.assertEqual([c["version"] for c in self.ld.calls()], ["2.0.0", "1.0.0"])

    def test_gewoehnlicher_fehler_im_ersten_lauf_ist_kein_rueckfall(self):
        self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0", exit_code=1)
        self.ld.set_state(current="1.0.0", pending="2.0.0")
        self.assertEqual(self.ld.run("--work", "/x", "run").returncode, 1)
        s = self.ld.state()
        self.assertEqual((s["current"], s["trial"], s["failed"]), ("2.0.0", None, []))

    def test_nie_beendeter_probelauf_wird_zurueckgenommen(self):
        self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0")
        self.ld.set_state(current="2.0.0", previous="1.0.0", trial="2.0.0")
        self.assertEqual(self.ld.run("--work", "/x", "run").returncode, 0)
        s = self.ld.state()
        self.assertEqual((s["current"], s["trial"]), ("1.0.0", None))
        self.assertEqual(s["failed"][0]["version"], "2.0.0")
        self.assertEqual([c["version"] for c in self.ld.calls()], ["1.0.0"])

    def test_fehlgeschlagene_fassung_bleibt_vermerkt_und_liste_begrenzt(self):
        self.ld.add_fake("1.0.0")
        failed = [{"version": f"0.0.{i}", "at": "x", "reason": "alt", "stage": "selftest"} for i in range(25)]
        self.ld.add_fake("2.0.0", selftest="fail")
        self.ld.set_state(current="1.0.0", pending="2.0.0", failed=failed)
        self.ld.run("--work", "/x", "run")
        f = self.ld.state()["failed"]
        self.assertEqual(len(f), 20)
        self.assertEqual(f[-1]["version"], "2.0.0")

    def test_sperre_verhindert_parallelen_lauf_und_umschalten(self):
        self.ld.add_fake("1.0.0"); self.ld.add_fake("2.0.0")
        self.ld.set_state(current="1.0.0", pending="2.0.0")
        fd = os.open(self.ld.root / ".launcher.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            r = self.ld.run("--work", "/x", "run")
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)
        self.assertEqual(r.returncode, 0)
        self.assertIn("anderer Lauf", r.stdout)
        self.assertEqual(self.ld.calls(), [])
        self.assertEqual(self.ld.state()["pending"], "2.0.0")

    def test_befehlserkennung(self):
        sys.path.insert(0, str(HERE))
        import launcher
        self.assertEqual(launcher.subcommand(["--work", "/x/run", "status"]), "status")
        self.assertEqual(launcher.subcommand(["--work", "run", "approve", "9.0.1", "--confirm", "9.0.1", "--by", "run"]), "approve")
        self.assertEqual(launcher.subcommand(["--work=/x", "--config", "c.json", "run", "--only", "poll"]), "run")
        self.assertEqual(launcher.subcommand(["--work", "/x"]), None)
        self.assertEqual(launcher.subcommand(["selftest"]), "selftest")

    def test_launcher_info(self):
        self.ld.add_fake("1.0.0")
        self.ld.set_state(current="1.0.0")
        r = self.ld.run("--launcher-info")
        info = json.loads(r.stdout)
        self.assertEqual((info["launcher_version"], info["installed"], info["state"]["current"]), ("1", ["1.0.0"], "1.0.0"))
        self.assertEqual(self.ld.calls(), [])


class Selbsttest(unittest.TestCase):
    def test_selbsttest_des_echten_werkzeugs(self):
        r = subprocess.run([sys.executable, str(HERE / "bwk_pull.py"), "selftest"], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(json.loads(r.stdout.strip().splitlines()[-1]), {"ok": True, "version": CUR, "problems": []})

    def test_selbsttest_erkennt_falschen_ordnernamen_und_abweichende_fassung(self):
        tmp = Path(tempfile.mkdtemp(prefix="bwk-selftest-")); self.addCleanup(shutil.rmtree, tmp, True)
        ld = LauncherDir(tmp / "deploy")
        d = ld.add_real()
        os.rename(d, d.with_name("3.3.3"))
        r = subprocess.run([sys.executable, str(d.with_name("3.3.3") / "bwk_pull.py"), "selftest"], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 1)
        self.assertFalse(json.loads(r.stdout.strip().splitlines()[-1])["ok"])

        def mismatch(src):
            src["bwk_deploy.py"] = src["bwk_deploy.py"].replace(f'TOOL_VERSION = "{NEW}"', 'TOOL_VERSION = "8.8.8"')
        d2 = ld.add_real(NEW, mismatch)
        r = subprocess.run([sys.executable, str(d2 / "bwk_pull.py"), "selftest"], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 1)
        self.assertIn("8.8.8", r.stdout)

    def test_fassungen_der_drei_dateien_stimmen_ueberein(self):
        self.assertEqual(deploy.TOOL_VERSION, CUR)
        self.assertEqual(mrm.TOOL_VERSION, CUR)


class WerkzeugPaket(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bwk-tools-test-")); self.addCleanup(shutil.rmtree, self.tmp, True)

    def write(self, blob, name="t.zip"):
        p = self.tmp / name; p.write_bytes(blob); return p

    def test_gueltiges_paket(self):
        files = tool_sources(NEW)
        out = deploy.check_tools_zip(self.write(tools_zip(files)), NEW)
        self.assertEqual(sorted(out), sorted(TOOL_FILES))
        self.assertEqual(out["bwk_pull.py"], files["bwk_pull.py"])

    def test_abgelehnte_pakete(self):
        good = tool_sources(NEW)
        cases = {}
        extra = dict(good); extra["launcher.py"] = b"print(1)\n"; cases["zusätzliche Datei"] = tools_zip(extra)
        missing = dict(good); del missing["bwk_deploy.py"]; cases["fehlende Datei"] = tools_zip(missing)
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, "w") as z:
            for n, d in good.items():
                z.writestr("deploy/" + n, d)
        cases["Unterordner"] = nested.getvalue()
        wrong = dict(good); wrong["bwk_pull.py"] = tool_sources("9.9.8")["bwk_pull.py"]; cases["andere Fassung"] = tools_zip(wrong)
        syntax = dict(good); syntax["bwk_deploy.py"] = good["bwk_deploy.py"] + b"\ndef kaputt(:\n"; cases["Syntaxfehler"] = tools_zip(syntax)
        double = dict(good); double["bwk_pull.py"] = good["bwk_pull.py"] + f'\nTOOL_VERSION = "{NEW}"\n'.encode(); cases["Fassung doppelt"] = tools_zip(double)
        cases["kein ZIP"] = b"das ist kein zip"
        big = dict(good); big["bwk_pull.py"] = good["bwk_pull.py"] + b"#" * (deploy.MAX_TOOLS_FILE + 1); cases["zu große Datei"] = tools_zip(big)
        link = io.BytesIO()
        with zipfile.ZipFile(link, "w") as z:
            for n, d in good.items():
                zi = zipfile.ZipInfo(n)
                zi.external_attr = (0o120777 << 16) if n == "bwk_pull.py" else (0o100644 << 16)
                z.writestr(zi, d)
        cases["Symlink-Eintrag"] = link.getvalue()
        for label, blob in cases.items():
            with self.subTest(label=label):
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    deploy.check_tools_zip(self.write(blob), NEW)

    def test_symlink_als_paketdatei_und_ungueltige_fassung(self):
        p = self.write(tools_zip(tool_sources(NEW)))
        os.symlink(p, self.tmp / "link.zip")
        with self.assertRaises(ValueError):
            deploy.check_tools_zip(self.tmp / "link.zip", NEW)
        with self.assertRaises(ValueError):
            deploy.check_tools_zip(p, "9.9")

    def test_paketbau_ist_deterministisch_und_besteht_die_pruefung(self):
        a = mtp.build(self.tmp)
        first = Path(a["path"]).read_bytes()
        b = mtp.build(self.tmp)
        self.assertEqual(first, Path(b["path"]).read_bytes())
        self.assertEqual(a["zip"], f"bwk-tools-v{CUR}.zip")
        self.assertEqual(a["sha256"], hashlib.sha256(first).hexdigest())
        with zipfile.ZipFile(a["path"]) as z:
            self.assertEqual(sorted(z.namelist()), sorted(TOOL_FILES))
            for name in TOOL_FILES:
                self.assertEqual(z.read(name), (HERE / name).read_bytes())

    def test_manifest_nennt_das_werkzeug_paket(self):
        new = self.tmp / "bwk-control-center-v9.0.1.zip"; new.write_bytes(base.make_zip("9.0.1"))
        old = self.tmp / "bwk-control-center-v9.0.0.zip"; old.write_bytes(base.make_zip("9.0.0"))
        pkg = mtp.build(self.tmp)
        m = mrm.build_manifest(new, "9.0.1", old, tests=5, tools_zip=pkg["path"])
        self.assertEqual(m["tools"], {"version": CUR, "zip": pkg["zip"], "sha256": pkg["sha256"], "size": pkg["size"]})
        self.assertTrue(m["auto_deploy"])
        self.assertEqual(bwk_pull.validate_manifest(m, "9.0.1")["tools"]["version"], CUR)
        self.assertNotIn("tools", mrm.build_manifest(new, "9.0.1", old))
        bad = self.tmp / "werkzeug.zip"; shutil.copyfile(pkg["path"], bad)
        with self.assertRaises(ValueError):
            mrm.build_manifest(new, "9.0.1", old, tools_zip=bad)

    def test_manifestpruefung_tools(self):
        blob = base.make_zip("9.0.1")
        ok = {"version": NEW, "zip": f"bwk-tools-v{NEW}.zip", "sha256": "a" * 64, "size": 100}
        self.assertEqual(bwk_pull.validate_manifest(base.manifest_for("9.0.1", blob, tools=ok), "9.0.1")["tools"], ok)
        self.assertIsNone(bwk_pull.validate_manifest(base.manifest_for("9.0.1", blob), "9.0.1")["tools"])
        for bad in ({**ok, "zip": "anderes.zip"}, {**ok, "version": "9.9"}, {**ok, "sha256": "x"}, {**ok, "size": 0},
                    {**ok, "size": deploy.MAX_TOOLS_ZIP + 1}, {**ok, "size": True}, "text", []):
            with self.subTest(bad=bad):
                with self.assertRaises(bwk_pull.PullError):
                    bwk_pull.validate_manifest(base.manifest_for("9.0.1", blob, tools=bad), "9.0.1")


def allow_mcp(src):
    """Die „neue“ Fassung erlaubt einen Ordner, den die aktive noch nicht kennt (hier: neu-app)."""
    assert src["bwk_deploy.py"].count("ALLOWED_DIRS = {'app',") == 1
    src["bwk_deploy.py"] = src["bwk_deploy.py"].replace("ALLOWED_DIRS = {'app',", "ALLOWED_DIRS = {'neu-app', 'app',")


def break_import(src):
    src["bwk_pull.py"] = src["bwk_pull.py"].replace("deploy = _load_deploy()", "deploy = _load_deploy()\nraise RuntimeError('absichtlich kaputt')", 1)


def crash_in_run(src):
    assert src["bwk_pull.py"].count("def cmd_run(args):\n") == 1
    src["bwk_pull.py"] = src["bwk_pull.py"].replace("def cmd_run(args):\n", "def cmd_run(args):\n    raise RuntimeError('absichtlich kaputt')\n")


class SelbstupdateEndeZuEnde(base.Base):
    """Echtes Werkzeug unter der Startdatei, simuliertes GitHub, Attrappe nur für die eigentliche Installation."""

    def setUp(self):
        super().setUp()
        self.ld = LauncherDir(self.tmp / "cc" / "deploy")
        self.ld.add_real()
        self.ld.set_state(current=CUR)

    def launch(self, *args):
        return self.ld.run("--work", str(self.work), *args)

    def run_ok(self):
        r = self.launch("run")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r

    def publish(self, version="9.0.1", tools_version=NEW, mutate=None, zip_extra=None, tools_blob=None,
                manifest_tools=None, with_asset=True):
        blob = base.make_zip(version, extra=zip_extra)
        tblob = tools_blob if tools_blob is not None else tools_zip(tool_sources(tools_version, mutate))
        entry = {"version": tools_version, "zip": f"bwk-tools-v{tools_version}.zip",
                 "sha256": hashlib.sha256(tblob).hexdigest(), "size": len(tblob)}
        entry.update(manifest_tools or {})
        manifest = base.manifest_for(version, blob, tools=entry, files_count=4 + len(zip_extra or {}))
        self.fake.publish(version, blob, manifest)
        if with_asset:
            aid = self.fake._next; self.fake._next += 1
            self.fake.assets[aid] = tblob
            self.fake.releases[0]["assets"].append({"id": aid, "name": entry["zip"], "size": len(tblob), "state": "uploaded"})
        return blob, tblob

    def updater(self):
        return json.loads((self.work / "approvals" / "updater.json").read_text())

    def granted(self, v="9.0.1"):
        return (self.work / "approvals" / "granted" / f"{v}.json").exists()

    def test_status_zeigt_startdatei(self):
        r = self.launch("status")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"Update-Werkzeug: {CUR} (Startdatei aktiv", r.stdout)

    def test_ohne_neues_werkzeug_alles_wie_bisher_und_status_datei(self):
        self.fake.publish("9.0.1")
        self.run_ok()
        n = self.pending("9.0.1")
        self.assertEqual(n["status"], "awaiting-approval")
        self.assertNotIn("tools_update", n)
        self.assertEqual(self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario").returncode, 0)
        self.run_ok()
        self.assertEqual(self.result("9.0.1")["status"], "deployed")
        u = self.updater()
        self.assertEqual((u["tool_version"], u["launcher"], u["current"], u["pending"], u["failed"]), (CUR, True, CUR, None, []))

    def test_gleiche_oder_aeltere_fassung_im_release_wird_ignoriert(self):
        self.publish(tools_version=CUR)
        self.run_ok()
        n = self.pending("9.0.1")
        self.assertNotIn("tools_update", n)
        self.assertFalse((self.work / "staging" / "9.0.1" / "tools.part").exists())
        self.assertEqual(len([r for r in self.fake.requests if r[0] == "cdn"]), 2)  # Manifest und ZIP, kein Werkzeug-Paket

    def test_neues_werkzeug_wird_vor_freigabe_nur_geladen_nie_ausgefuehrt(self):
        _, tblob = self.publish(mutate=break_import)
        self.run_ok()
        n = self.pending("9.0.1")
        self.assertEqual(n["status"], "awaiting-approval")
        self.assertEqual(n["tools_update"], {"version": NEW, "from": CUR, "sha256": hashlib.sha256(tblob).hexdigest(),
                                             "size": len(tblob), "mode": "auto"})
        self.assertNotIn("deep_check_deferred", n)
        self.assertEqual(n["files_total"], 4)
        self.assertEqual((self.work / "staging" / "9.0.1" / "tools.part").read_bytes(), tblob)
        self.assertFalse((self.ld.root / "versions" / NEW).exists())
        self.assertIsNone(self.ld.state()["pending"])
        # Weitere Läufe ohne Freigabe ändern nichts.
        self.run_ok()
        self.assertFalse((self.ld.root / "versions" / NEW).exists())
        self.assertEqual(self.calls(), [])

    def test_freigabe_wechselt_erst_das_werkzeug_dann_installiert_die_neue_fassung(self):
        self.publish()
        self.run_ok()
        self.assertEqual(self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario").returncode, 0)
        self.run_ok()
        # Lauf 1 nach der Freigabe: Werkzeug bereitgelegt, noch nichts installiert, Freigabe bleibt liegen.
        res = self.result("9.0.1")
        self.assertEqual((res["status"], res["tools_version"], res["by"]), ("tools-pending", NEW, "Mario"))
        self.assertEqual(self.calls(), [])
        self.assertTrue(self.granted())
        self.assertEqual(self.prod_version(), "9.0.0")
        s = self.ld.state()
        self.assertEqual((s["current"], s["pending"], s["pending_for"]), (CUR, NEW, "9.0.1"))
        for name, data in tool_sources(NEW).items():
            self.assertEqual((self.ld.root / "versions" / NEW / name).read_bytes(), data)
        self.assertEqual(self.updater()["pending"], NEW)
        # Lauf 2: Startdatei schaltet um, die neue Fassung installiert.
        r = self.run_ok()
        self.assertIn(f"Umgeschaltet auf Fassung {NEW}", r.stdout)
        s = self.ld.state()
        self.assertEqual((s["current"], s["previous"], s["pending"], s["trial"], s["failed"]), (NEW, CUR, None, None, []))
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.result("9.0.1")["status"], "deployed")
        self.assertEqual(self.prod_version(), "9.0.1")
        self.assertFalse(self.granted())
        u = self.updater()
        self.assertEqual((u["tool_version"], u["current"], u["previous"], u["last_switch"]["to"]), (NEW, NEW, CUR, NEW))
        # Lauf 3: nichts mehr zu tun, keine zweite Installation.
        self.run_ok()
        self.assertEqual(len(self.calls()), 1)

    def test_zip_das_das_neue_werkzeug_braucht_pruefung_wird_nachgeholt(self):
        self.publish(mutate=allow_mcp, zip_extra={"neu-app/server.mjs": "//\n"})
        self.run_ok()
        n = self.pending("9.0.1")
        self.assertEqual((n["status"], n["approvable"], n["deep_check_deferred"], n["tools_update"]["mode"]),
                         ("awaiting-approval", True, True, "auto"))
        self.assertNotIn("files", n)
        self.assertEqual(self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario").returncode, 0)
        self.run_ok()
        self.assertEqual(self.result("9.0.1")["status"], "tools-pending")
        self.run_ok()
        self.assertEqual(self.result("9.0.1")["status"], "deployed")
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.ld.state()["current"], NEW)

    def test_nachgeholte_pruefung_schlaegt_fehl_nichts_wird_installiert(self):
        # Neues Werkzeug erlaubt den Ordner ebenfalls nicht: nach dem Wechsel scheitert die Tiefenprüfung.
        self.publish(zip_extra={"neu-app/server.mjs": "//\n"})
        self.run_ok()
        self.assertTrue(self.pending("9.0.1")["deep_check_deferred"])
        self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok(); self.run_ok()
        res = self.result("9.0.1")
        self.assertEqual(res["status"], "failed-before-change")
        self.assertIn("Tiefenprüfung", res["message"])
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.prod_version(), "9.0.0")
        n = self.pending("9.0.1")
        self.assertEqual((n["status"], n["approvable"]), ("manual-required", False))
        self.assertFalse(self.granted())
        self.run_ok()
        self.assertEqual(self.calls(), [])

    def test_kaputtes_werkzeug_besteht_selbsttest_nicht_control_center_wird_trotzdem_installiert(self):
        self.publish(mutate=break_import)
        self.run_ok()
        self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok()
        self.assertEqual(self.result("9.0.1")["status"], "tools-pending")
        r = self.run_ok()
        self.assertIn(f"Fassung {NEW} nicht aktiviert", r.stdout)
        s = self.ld.state()
        self.assertEqual((s["current"], s["pending"]), (CUR, None))
        self.assertEqual([(e["version"], e["stage"]) for e in s["failed"]], [(NEW, "selftest")])
        res = self.result("9.0.1")
        self.assertEqual(res["status"], "deployed")
        self.assertIn(f"Werkzeug {NEW} wurde nicht eingespielt", res["message"])
        self.assertEqual(len(self.calls()), 1)
        u = self.updater()
        self.assertEqual((u["current"], u["last_fallback"]["version"], u["last_fallback"]["stage"], u["last_fallback"]["active"]),
                         (CUR, NEW, "selftest", CUR))
        self.assertEqual(u["failed"][0]["version"], NEW)

    def test_fehlgeschlagene_fassung_wird_bei_spaeterem_release_nicht_erneut_versucht(self):
        self.publish(mutate=break_import)
        self.run_ok()
        self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok(); self.run_ok()
        self.assertEqual(self.prod_version(), "9.0.1")
        self.publish(version="9.0.2", mutate=break_import)
        self.run_ok()
        n = self.pending("9.0.2")
        self.assertEqual((n["tools_update"]["mode"], n["approvable"]), ("manual", True))
        self.assertIn("fehlgeschlagen", n["tools_update"]["reason"])
        self.launch("approve", "9.0.2", "--confirm", "9.0.2", "--by", "Mario")
        self.run_ok()
        self.assertEqual(self.result("9.0.2")["status"], "deployed")
        self.assertIsNone(self.ld.state()["pending"])

    def test_kaputtes_werkzeug_und_zip_braucht_es_nichts_wird_installiert(self):
        self.publish(mutate=lambda s: (allow_mcp(s), break_import(s)), zip_extra={"neu-app/server.mjs": "//\n"})
        self.run_ok()
        self.assertTrue(self.pending("9.0.1")["deep_check_deferred"])
        self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok(); self.run_ok()
        res = self.result("9.0.1")
        self.assertEqual(res["status"], "not-started")
        self.assertIn(f"braucht das Werkzeug {NEW}", res["message"])
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.prod_version(), "9.0.0")
        n = self.pending("9.0.1")
        self.assertEqual((n["status"], n["approvable"]), ("manual-required", False))
        self.assertFalse(self.granted())
        self.assertEqual(self.ld.state()["current"], CUR)

    def test_absturz_der_neuen_fassung_im_ersten_lauf_rueckfall_und_installation_mit_alter(self):
        self.publish(mutate=crash_in_run)
        self.run_ok()
        self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok()
        r = self.launch("run")
        self.assertEqual(r.returncode, 70)
        self.assertIn("absichtlich kaputt", r.stderr)
        s = self.ld.state()
        self.assertEqual((s["current"], s["previous"], s["trial"]), (CUR, None, None))
        self.assertEqual([(e["version"], e["stage"]) for e in s["failed"]], [(NEW, "first-run")])
        self.assertEqual(self.calls(), [])
        self.assertTrue(self.granted())
        self.run_ok()
        res = self.result("9.0.1")
        self.assertEqual(res["status"], "deployed")
        self.assertIn("nicht eingespielt", res["message"])
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.updater()["last_fallback"]["stage"], "first-run")

    def test_manipulierte_pakete_fuehren_zu_abgelehntem_release(self):
        good = tools_zip(tool_sources(NEW))
        extra = dict(tool_sources(NEW)); extra["launcher.py"] = b"import os\n"
        cases = [
            ("sha", dict(manifest_tools={"sha256": "b" * 64})),
            ("größe", dict(manifest_tools={"size": len(good) + 1})),
            ("zusatzdatei", dict(tools_blob=tools_zip(extra))),
            ("fassung", dict(tools_blob=tools_zip(tool_sources("9.9.8")))),
            ("fehlt", dict(with_asset=False)),
            ("zipname", dict(manifest_tools={"zip": "bwk-tools.zip"})),
        ]
        for i, (label, kw) in enumerate(cases):
            with self.subTest(label=label):
                v = f"9.0.{i + 1}"
                self.publish(version=v, **kw)
                self.run_ok()
                n = self.pending(v)
                self.assertEqual((n["status"], n["approvable"]), ("check-failed", False), n)
                self.assertFalse((self.work / "staging" / v / "tools.part").exists())
                self.assertFalse((self.ld.root / "versions" / NEW).exists())
        self.assertIsNone(self.ld.state()["pending"])

    def test_nach_der_pruefung_ausgetauschtes_paket_wird_nicht_eingespielt(self):
        self.publish()
        self.run_ok()
        evil = dict(tool_sources(NEW)); evil["bwk_pull.py"] += b"\n# manipuliert\n"
        (self.work / "staging" / "9.0.1" / "tools.part").write_bytes(tools_zip(evil))
        self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok()
        self.assertFalse((self.ld.root / "versions" / NEW).exists())
        self.assertIsNone(self.ld.state()["pending"])
        res = self.result("9.0.1")
        self.assertEqual(res["status"], "deployed")
        self.assertIn("nicht eingespielt", res["message"])

    def test_vorhandener_ordner_mit_anderem_inhalt_wird_nicht_ueberschrieben(self):
        self.publish()
        self.run_ok()
        d = self.ld.root / "versions" / NEW; d.mkdir()
        for name in TOOL_FILES:
            (d / name).write_text("# fremd\n")
        self.launch("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok()
        self.assertEqual((d / "bwk_pull.py").read_text(), "# fremd\n")
        self.assertIsNone(self.ld.state()["pending"])
        self.assertIn("nicht eingespielt", self.result("9.0.1")["message"])

    def test_ablehnen_legt_kein_werkzeug_bereit(self):
        self.publish()
        self.run_ok()
        self.launch("reject", "9.0.1", "--confirm", "9.0.1", "--by", "Mario")
        self.run_ok()
        self.assertEqual(self.result("9.0.1")["status"], "rejected")
        self.assertFalse((self.ld.root / "versions" / NEW).exists())
        self.assertEqual(self.ld.state()["current"], CUR)


class SelbstupdateMitEchtemDeployWerkzeug(base.Base):
    """Vertragstest: Startdatei -> neue Fassung -> ECHTES bwk_deploy.py der neuen Fassung (Docker durch Attrappe ersetzt)."""

    def setUp(self):
        super().setUp()
        bindir = self.tmp / "bin"; bindir.mkdir()
        (bindir / "docker").write_text(base.FAKE_DOCKER)
        os.chmod(bindir / "docker", 0o755)
        self.docker_log = self.tmp / "docker.log"
        self._old_path = os.environ.get("PATH", "")
        os.environ["PATH"] = str(bindir) + os.pathsep + self._old_path
        os.environ["FAKE_DOCKER_LOG"] = str(self.docker_log)
        os.environ["FAKE_DOCKER_SERVICES"] = "web\\ntwitch\\ndiscord\\ndb\\n"
        os.environ["FAKE_DOCKER_RUNNING"] = "web\\ntwitch\\ndiscord\\ndb\\n"
        cfg = self.work / "pull" / "config.json"
        d = json.loads(cfg.read_text()); d.pop("deploy_script")
        d.update(services=["web", "twitch", "discord"], db_container="bcc-db")
        cfg.write_text(json.dumps(d))
        (self.project / "app").mkdir(); (self.project / "app" / "server.js").write_text("alt\n")
        # Wie auf der NAS: Der Ordner der Startdatei liegt im Projektordner.
        self.ld = LauncherDir(self.project / "deploy")
        self.ld.add_real()
        self.ld.set_state(current=CUR)

    def cleanup(self):
        os.environ["PATH"] = self._old_path
        for k in ("FAKE_DOCKER_LOG", "FAKE_DOCKER_SERVICES", "FAKE_DOCKER_RUNNING"):
            os.environ.pop(k, None)
        super().cleanup()

    def test_neues_werkzeug_installiert_zip_mit_neuem_ordner_und_laesst_die_startdatei_unberuehrt(self):
        blob = base.make_zip("9.0.1", extra={"neu-app/server.mjs": "// neu\n"})
        tblob = tools_zip(tool_sources(NEW, allow_mcp))
        entry = {"version": NEW, "zip": f"bwk-tools-v{NEW}.zip", "sha256": hashlib.sha256(tblob).hexdigest(), "size": len(tblob)}
        self.fake.publish("9.0.1", blob, base.manifest_for("9.0.1", blob, tools=entry, files_count=5))
        aid = self.fake._next; self.fake._next += 1
        self.fake.assets[aid] = tblob
        self.fake.releases[0]["assets"].append({"id": aid, "name": entry["zip"], "size": len(tblob), "state": "uploaded"})
        launcher_before = (self.ld.root / "launcher.py").read_bytes()
        old_tool_before = (self.ld.root / "versions" / CUR / "bwk_deploy.py").read_bytes()

        def run():
            r = self.ld.run("--work", str(self.work), "run")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        run()
        self.assertTrue(self.pending("9.0.1")["deep_check_deferred"])
        self.assertFalse(self.docker_log.exists(), "vor der Freigabe wird Docker nicht angefasst")
        self.assertEqual(self.ld.run("--work", str(self.work), "approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario").returncode, 0)
        run()
        self.assertEqual(self.result("9.0.1")["status"], "tools-pending")
        self.assertFalse(self.docker_log.exists(), "beim Bereitlegen des Werkzeugs wird nichts installiert")
        self.assertFalse((self.project / "neu-app").exists())
        run()
        res = self.result("9.0.1")
        self.assertEqual(res["status"], "deployed", res)
        self.assertEqual(self.prod_version(), "9.0.1")
        self.assertEqual((self.project / "neu-app" / "server.mjs").read_text(), "// neu\n")
        self.assertEqual((self.project / "app" / "server.js").read_text(), "console.log('server');\n")
        log = self.docker_log.read_text()
        self.assertIn("exec bcc-db pg_dump", log)
        self.assertIn("stop web twitch discord", log)
        self.assertIn("up -d --build web twitch discord", log)
        backup = self.work / "backups" / res["backup_id"]
        self.assertTrue((backup / "postgres.dump").is_file())
        self.assertEqual((backup / "previous" / "app" / "server.js").read_text(), "alt\n")
        # Der Ordner der Startdatei wird von der Installation nicht verändert und nicht gesichert.
        self.assertEqual((self.ld.root / "launcher.py").read_bytes(), launcher_before)
        self.assertEqual((self.ld.root / "versions" / CUR / "bwk_deploy.py").read_bytes(), old_tool_before)
        self.assertFalse((backup / "previous" / "deploy").exists())
        self.assertEqual(self.ld.state()["current"], NEW)

    def test_zip_mit_ordner_deploy_wird_abgelehnt(self):
        self.fake.publish("9.0.1", base.make_zip("9.0.1", extra={"deploy/launcher.py": "import os\n"}))
        r = self.ld.run("--work", str(self.work), "run")
        self.assertEqual(r.returncode, 0, r.stderr)
        n = self.pending("9.0.1")
        self.assertEqual((n["status"], n["approvable"]), ("check-failed", False))
        self.assertIn("Nicht erlaubte Datei", n["error"])


class ArbeitsordnerImProjekt(base.Base):
    """1.8.0: Arbeitsordner unter der Startdatei (<Projekt>/deploy/work); --work, project und compose entfallen."""

    def setUp(self):
        super().setUp()
        self.ld = LauncherDir(self.project / "deploy")
        self.ld.add_real()
        self.ld.set_state(current=CUR)
        # Arbeitsordner an den neuen Ort verschieben, wie bei der Umstellung auf der NAS.
        self.new_work = self.ld.root / "work"
        os.rename(self.work, self.new_work)
        cfg = self.new_work / "pull" / "config.json"
        d = json.loads(cfg.read_text())
        os.rename(d["token_file"], self.new_work / "pull" / "github_token")
        d["token_file"] = "github_token"          # relativ zum Ordner pull/
        d.pop("project"); d.pop("compose")        # Standard: Ordner über der Startdatei
        cfg.write_text(json.dumps(d))
        self.work = self.new_work                 # Hilfsfunktionen der Basisklasse (pending, result, calls)

    def test_lauf_ohne_work_angabe_meldet_freigabe_und_installiert(self):
        self.fake.publish("9.0.1")
        r = self.ld.run("run")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.pending("9.0.1")["status"], "awaiting-approval")
        self.assertEqual(self.ld.run("approve", "9.0.1", "--confirm", "9.0.1", "--by", "Mario").returncode, 0)
        r = self.ld.run("run")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"mit Werkzeug {CUR}", r.stdout)
        self.assertEqual(self.result("9.0.1")["status"], "deployed")
        self.assertEqual(self.prod_version(), "9.0.1")
        call = self.calls()[0]
        self.assertIn(str(self.project.resolve()), call)
        self.assertIn(str((self.project / "compose.yaml").resolve()), call)
        self.assertIn(str(self.new_work.resolve()), call)
        self.assertTrue((self.new_work / "approvals" / "updater.json").is_file())
        r = self.ld.run("status")
        self.assertIn("Produktive Version: 9.0.1", r.stdout)

    def test_ausdrueckliche_angabe_hat_vorrang(self):
        other = self.tmp / "anderer-ordner"; other.mkdir()
        r = self.ld.run("--work", str(other), "status")
        self.assertEqual(r.returncode, 1)
        self.assertIn("repo fehlt", r.stderr)

    def test_ohne_arbeitsordner_und_ohne_angabe_klare_fehlermeldung(self):
        os.rename(self.new_work, self.tmp / "weg")
        r = self.ld.run("run")
        self.assertEqual(r.returncode, 1)
        self.assertIn("--work fehlt", r.stderr)
        # Direkter Aufruf ohne Startdatei: ebenfalls kein stiller Standard.
        os.rename(self.tmp / "weg", self.new_work)
        e = dict(os.environ); e.pop("BWK_LAUNCHER", None)
        r = subprocess.run([sys.executable, str(self.ld.root / "versions" / CUR / "bwk_pull.py"), "status"],
                           capture_output=True, text=True, timeout=60, env=e)
        self.assertEqual(r.returncode, 1)
        self.assertIn("--work fehlt", r.stderr)

    def test_symlink_als_arbeitsordner_wird_nicht_verwendet(self):
        os.rename(self.new_work, self.tmp / "echt")
        os.symlink(self.tmp / "echt", self.new_work)
        r = self.ld.run("run")
        self.assertEqual(r.returncode, 1)
        self.assertIn("--work fehlt", r.stderr)


class McpOrdnerImUpdate(base.Base):
    """1.8.0: mcp-app/ ist ein erlaubter Ordner im Update-ZIP."""

    def test_schleuse(self):
        from pathlib import PurePosixPath as P
        for ok in ("mcp-app/server.mjs", "mcp-app/package.json", "mcp-app/Dockerfile", "mcp-app/setup-readonly-views.sql"):
            self.assertTrue(deploy.allowed(P(ok)), ok)
        for bad in ("mcp-app/.env", "mcp-app/secrets/token.txt", "mcp-app/node_modules/x/index.js", "mcp/server.mjs",
                    "deploy/launcher.py", "deploy/work/pull/config.json", "tools/deploy/bwk_pull.py"):
            self.assertFalse(deploy.allowed(P(bad)), bad)

    def test_release_mit_mcp_ordner_wird_normal_geprueft_und_installiert(self):
        os.environ.pop("BWK_LAUNCHER", None)
        blob = base.make_zip("9.0.1", extra={"mcp-app/server.mjs": "// mcp\n", "mcp-app/package.json": "{}\n"})
        self.fake.publish("9.0.1", blob, base.manifest_for("9.0.1", blob, files_count=6))
        self.assertEqual(self.run_pull(), 0)
        n = self.pending("9.0.1")
        self.assertEqual((n["status"], n["approvable"]), ("awaiting-approval", True))
        self.assertIn("mcp-app/server.mjs", n["files"])
        self.assertNotIn("deep_check_deferred", n)


class OhneStartdatei(base.Base):
    """Werkzeug direkt gestartet (bisheriger Aufruf): kein Selbstupdate, sonst unverändert."""

    def publish_with_tools(self, zip_extra=None, version="9.0.1"):
        blob = base.make_zip(version, extra=zip_extra)
        tblob = tools_zip(tool_sources(NEW))
        entry = {"version": NEW, "zip": f"bwk-tools-v{NEW}.zip", "sha256": hashlib.sha256(tblob).hexdigest(), "size": len(tblob)}
        self.fake.publish(version, blob, base.manifest_for(version, blob, tools=entry, files_count=4 + len(zip_extra or {})))
        aid = self.fake._next; self.fake._next += 1
        self.fake.assets[aid] = tblob
        self.fake.releases[0]["assets"].append({"id": aid, "name": entry["zip"], "size": len(tblob), "state": "uploaded"})

    def test_release_mit_werkzeug_wird_mit_bisherigem_werkzeug_installiert(self):
        os.environ.pop("BWK_LAUNCHER", None)
        self.publish_with_tools()
        self.assertEqual(self.run_pull(), 0)
        n = self.pending("9.0.1")
        self.assertEqual((n["status"], n["approvable"], n["tools_update"]["mode"]), ("awaiting-approval", True, "manual"))
        self.assertIn("Startdatei", n["tools_update"]["reason"])
        self.approve("9.0.1")
        self.assertEqual(self.run_pull(), 0)
        res = self.result("9.0.1")
        self.assertEqual(res["status"], "deployed")
        self.assertIn(f"Werkzeug {NEW} wurde nicht eingespielt", res["message"])
        u = json.loads((self.work / "approvals" / "updater.json").read_text())
        self.assertEqual((u["tool_version"], u["launcher"]), (CUR, False))

    def test_zip_das_neues_werkzeug_braucht_wird_abgelehnt_mit_hinweis(self):
        os.environ.pop("BWK_LAUNCHER", None)
        self.publish_with_tools(zip_extra={"neu-app/server.mjs": "//\n"})
        self.assertEqual(self.run_pull(), 0)
        n = self.pending("9.0.1")
        self.assertEqual((n["status"], n["approvable"]), ("check-failed", False))
        self.assertIn(f"Werkzeug {NEW}", n["error"])

    def test_umgebungsvariable_allein_genuegt_nicht(self):
        os.environ["BWK_LAUNCHER"] = "1"
        self.addCleanup(os.environ.pop, "BWK_LAUNCHER", None)
        self.assertIsNone(bwk_pull.launcher_root())
        self.publish_with_tools()
        self.assertEqual(self.run_pull(), 0)
        self.assertEqual(self.pending("9.0.1")["tools_update"]["mode"], "manual")

    def test_unerwarteter_abbruch_endet_mit_code_70(self):
        tmp = self.tmp / "kopie"; tmp.mkdir()
        for name, data in tool_sources(None, crash_in_run).items():
            (tmp / name).write_bytes(data)
        r = subprocess.run([sys.executable, str(tmp / "bwk_pull.py"), "--work", str(self.work), "run"], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 70, r.stderr)
        r = subprocess.run([sys.executable, str(HERE / "bwk_pull.py"), "--work", str(self.tmp / "gibt-es-nicht"), "run"], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 1)
        self.assertIn("FEHLER", r.stderr)


if __name__ == "__main__":
    unittest.main()
