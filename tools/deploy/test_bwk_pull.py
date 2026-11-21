#!/usr/bin/env python3
"""Tests für bwk_pull.py und make_release_manifest.py gegen einen simulierten GitHub-Server.

Ausführen:  python3 -m unittest -v test_bwk_pull   (im Ordner deploy/)
Es wird nichts installiert, kein Docker und kein Netzwerk außer Loopback verwendet.
"""
import contextlib
import datetime as dt
import fcntl
import hashlib
import http.server
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bwk_pull  # noqa: E402
import make_release_manifest as mrm  # noqa: E402

OWNER_REPO = "tester/bwk-test"
TOKEN = "github_pat_" + "A" * 40

FAKE_DEPLOY = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
a = sys.argv[1:]
def opt(n): return a[a.index(n) + 1]
work, project, version = Path(opt("--work")), Path(opt("--project")), a[1]
with open(work / "fake-deploy-calls.jsonl", "a") as f: f.write(json.dumps(a) + "\n")
mode = os.environ.get("FAKE_DEPLOY_MODE", "ok")
folder = work / "staging" / version
if mode == "nostart":
    print("Ein weiterer Deployment-/Rollback-Vorgang läuft bereits", file=sys.stderr); sys.exit(1)
(folder / "deployment-state.json").write_text(json.dumps({"status": "deploying"}))
if mode == "rolledback":
    (folder / "deployment-result.json").write_text(json.dumps({"status": "failed-rolled-back", "backup_id": "b1", "error": "Dienst startet nicht"}))
    sys.exit(1)
(project / "VERSION").write_text(version + "\n")
(folder / "deployment-result.json").write_text(json.dumps({"status": "deployed", "backup_id": "b1", "version": version}))
'''


def make_zip(version, extra=None, omit=(), version_in_file=None):
    root = f"bwk-control-center-v{version}"
    entries = {
        "VERSION": (version_in_file or version) + "\n",
        "app/server.js": "console.log('server');\n",
        "public/index.html": "<html></html>\n",
        f"UPDATE-{version}.md": "# Update\n",
    }
    for k in omit:
        entries.pop(k, None)
    entries.update(extra or {})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in entries.items():
            z.writestr(f"{root}/{name}", content)
    return buf.getvalue()


def manifest_for(ver, blob, **over):
    m = {"schema": 1, "version": ver, "zip": f"bwk-control-center-v{ver}.zip",
         "sha256": hashlib.sha256(blob).hexdigest(), "size": len(blob), "files_count": 4,
         "tests": 10, "auto_deploy": True, "manual_reasons": [], "summary": "Testrelease"}
    m.update(over)
    return m


class Fake:
    """Simulierter GitHub-API-Server plus Download-Server (anderer Port, wie bei GitHub)."""

    def __init__(self):
        self.releases = []
        self.assets = {}
        self.requests = []   # (server, path, authorization)
        outer = self

        class Api(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass

            def do_GET(self):
                outer.requests.append(("api", self.path, self.headers.get("Authorization")))
                if self.path.startswith(f"/repos/{OWNER_REPO}/releases?"):
                    body = json.dumps(outer.releases).encode()
                    etag = '"' + hashlib.md5(body).hexdigest() + '"'
                    if self.headers.get("If-None-Match") == etag:
                        self.send_response(304); self.end_headers(); return
                    self.send_response(200); self.send_header("ETag", etag)
                    self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
                prefix = f"/repos/{OWNER_REPO}/releases/assets/"
                if self.path.startswith(prefix):
                    aid = int(self.path[len(prefix):])
                    if aid not in outer.assets: self.send_response(404); self.end_headers(); return
                    self.send_response(302)
                    self.send_header("Location", f"http://127.0.0.1:{outer.cdn.server_port}/blob/{aid}")
                    self.end_headers(); return
                self.send_response(404); self.end_headers()

        class Cdn(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass

            def do_GET(self):
                outer.requests.append(("cdn", self.path, self.headers.get("Authorization")))
                aid = int(self.path.rsplit("/", 1)[1])
                data = outer.assets[aid]
                self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers()
                self.wfile.write(data)

        self.api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Api)
        self.cdn = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Cdn)
        for s in (self.api, self.cdn):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        self._next = 1

    def close(self):
        for s in (self.api, self.cdn):
            s.shutdown(); s.server_close()

    def publish(self, version, blob=None, manifest=None, draft=False, prerelease=False, with_manifest=True, with_zip=True):
        blob = blob if blob is not None else make_zip(version)
        manifest = manifest if manifest is not None else manifest_for(version, blob)
        assets = []
        if with_zip:
            zid = self._next; self._next += 1
            self.assets[zid] = blob
            assets.append({"id": zid, "name": f"bwk-control-center-v{version}.zip", "size": len(blob), "state": "uploaded"})
        if with_manifest:
            mid = self._next; self._next += 1
            self.assets[mid] = json.dumps(manifest).encode()
            assets.append({"id": mid, "name": "release-manifest.json", "size": 10, "state": "uploaded"})
        self.releases.insert(0, {"tag_name": f"v{version}", "draft": draft, "prerelease": prerelease,
                                 "html_url": f"https://github.com/{OWNER_REPO}/releases/tag/v{version}",
                                 "published_at": "2026-11-12T20:00:00Z", "assets": assets})
        return blob

    def asset_requests(self):
        return [r for r in self.requests if "/assets/" in r[1] or r[0] == "cdn"]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bwk-pull-test-"))
        self.work = self.tmp / "deploy-work"
        self.project = self.tmp / "cc"
        self.work.mkdir(); self.project.mkdir()
        (self.project / "VERSION").write_text("9.0.0\n")
        (self.project / "compose.yaml").write_text("services: {}\n")
        self.fake = Fake()
        (self.tmp / "fake_deploy.py").write_text(FAKE_DEPLOY)
        self.token_file = self.tmp / "token"
        self.token_file.write_text(TOKEN)
        os.chmod(self.token_file, 0o600)
        (self.work / "pull").mkdir()
        (self.work / "pull" / "config.json").write_text(json.dumps({
            "repo": OWNER_REPO, "token_file": str(self.token_file), "project": str(self.project),
            "compose": str(self.project / "compose.yaml"), "api_base": f"http://127.0.0.1:{self.fake.api.server_port}",
            "deploy_script": str(self.tmp / "fake_deploy.py")}))
        os.environ["FAKE_DEPLOY_MODE"] = "ok"
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.fake.close()
        shutil.rmtree(self.tmp, ignore_errors=True)
        os.environ.pop("FAKE_DEPLOY_MODE", None)

    def pull(self, *args):
        with contextlib.redirect_stdout(io.StringIO()):
            return bwk_pull.main(["--work", str(self.work)] + list(args))

    def run_pull(self, only=None):
        return self.pull("run", *(["--only", only] if only else []))

    def pending(self, v):
        p = self.work / "approvals" / "pending" / f"{v}.json"
        return json.loads(p.read_text()) if p.exists() else None

    def result(self, v):
        p = self.work / "approvals" / "results" / f"{v}.json"
        return json.loads(p.read_text()) if p.exists() else None

    def calls(self):
        p = self.work / "fake-deploy-calls.jsonl"
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def approve(self, v, by="Mario"):
        return self.pull("approve", v, "--confirm", v, "--by", by)

    def write_grant(self, v, sha, age=dt.timedelta(0), via="control-center", by="Mario", name=None):
        at = (dt.datetime.now(dt.timezone.utc) - age).isoformat().replace("+00:00", "Z")
        d = self.work / "approvals" / "granted"; d.mkdir(parents=True, exist_ok=True)
        p = d / (name or f"{v}.json")
        p.write_text(json.dumps({"version": v, "sha256": sha, "approved_by": by, "via": via, "approved_at": at}))
        return p

    def prod_version(self):
        return (self.project / "VERSION").read_text().strip()


class HappyPath(Base):
    def test_release_wird_gemeldet_nicht_installiert(self):
        blob = self.fake.publish("9.0.1")
        self.assertEqual(self.run_pull(), 0)
        n = self.pending("9.0.1")
        self.assertEqual(n["status"], "awaiting-approval")
        self.assertTrue(n["approvable"])
        self.assertEqual(n["sha256"], hashlib.sha256(blob).hexdigest())
        self.assertEqual(n["sha256_short"], n["sha256"][:12])
        self.assertIn("app/server.js", n["files"])
        self.assertEqual(n["files_total"], 4)
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.prod_version(), "9.0.0")
        staged = self.work / "staging" / "9.0.1"
        self.assertTrue((staged / "update.part").is_file())
        self.assertFalse((staged / "deployment-request.json").exists())

    def test_freigabe_per_cli_installiert_einmalig(self):
        blob = self.fake.publish("9.0.1")
        sha = hashlib.sha256(blob).hexdigest()
        self.run_pull()
        self.assertEqual(self.approve("9.0.1"), 0)
        self.run_pull()
        calls = self.calls()
        self.assertEqual(len(calls), 1)
        a = calls[0]
        self.assertEqual(a[0], "deploy")
        self.assertEqual(a[a.index("--confirm") + 1], "9.0.1")
        self.assertEqual(a[a.index("--expected-sha256") + 1], sha)
        self.assertEqual(self.result("9.0.1")["status"], "deployed")
        self.assertEqual(self.result("9.0.1")["by"], "Mario")
        self.assertIsNone(self.pending("9.0.1"))
        self.assertEqual(self.prod_version(), "9.0.1")
        used = list((self.work / "approvals" / "used").glob("9.0.1-*-used.json"))
        self.assertEqual(len(used), 1)
        self.assertFalse((self.work / "approvals" / "granted" / "9.0.1.json").exists())
        # Wiederholung: Freigabe erneut hineinlegen darf nichts auslösen
        self.write_grant("9.0.1", sha)
        self.run_pull()
        self.assertEqual(len(self.calls()), 1)

    def test_protokolldatei_mit_rotation(self):
        log = self.work / "pull" / "pull.log"
        log.write_text("x" * (bwk_pull.LOG_MAX + 1))
        self.fake.publish("9.0.1")
        self.run_pull()
        self.assertTrue((self.work / "pull" / "pull.log.1").is_file())
        self.assertIn("Neues Release 9.0.1", log.read_text())
        self.assertLess(log.stat().st_size, 5000)

    def test_zweiter_lauf_laedt_nicht_erneut(self):
        self.fake.publish("9.0.1")
        self.run_pull()
        n1 = len(self.fake.asset_requests())
        self.run_pull()
        self.assertEqual(len(self.fake.asset_requests()), n1)

    def test_kein_neueres_release(self):
        self.fake.publish("9.0.0")
        self.run_pull()
        self.assertIsNone(self.pending("9.0.0"))
        self.assertEqual(self.fake.asset_requests(), [])

    def test_entwurf_und_vorabversion_werden_ignoriert(self):
        self.fake.publish("9.0.2", draft=True)
        self.fake.publish("9.0.3", prerelease=True)
        self.run_pull()
        self.assertIsNone(self.pending("9.0.2"))
        self.assertIsNone(self.pending("9.0.3"))

    def test_token_nur_an_api_nicht_an_download_host(self):
        self.fake.publish("9.0.1")
        self.run_pull()
        api = [r for r in self.fake.requests if r[0] == "api"]
        cdn = [r for r in self.fake.requests if r[0] == "cdn"]
        self.assertTrue(cdn)
        self.assertTrue(all(r[2] == "Bearer " + TOKEN for r in api))
        self.assertTrue(all(r[2] is None for r in cdn))

    def test_etag_vermeidet_erneute_auswertung(self):
        self.fake.publish("9.0.1")
        self.run_pull()
        self.assertIsNotNone(bwk_pull.load_state(bwk_pull.load_ctx(_Args(self.work)))["etag"])


class _Args:
    def __init__(self, work):
        self.work = str(work); self.config = None
        self.repo = self.token_file = self.project = self.compose = None


class Pruefungen(Base):
    def test_falscher_hash_im_manifest(self):
        blob = make_zip("9.0.1")
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for("9.0.1", blob, sha256="0" * 64))
        self.run_pull()
        n = self.pending("9.0.1")
        self.assertEqual(n["status"], "check-failed")
        self.assertFalse(n["approvable"])
        self.assertFalse((self.work / "staging" / "9.0.1").exists())
        self.assertNotEqual(self.approve_code("9.0.1"), 0)

    def approve_code(self, v):
        try:
            return self.approve(v)
        except bwk_pull.PullError:
            return 1

    def test_manifest_version_passt_nicht(self):
        blob = make_zip("9.0.1")
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for("9.0.1", blob, version="9.0.9"))
        self.run_pull()
        self.assertEqual(self.pending("9.0.1")["status"], "check-failed")

    def test_unerlaubte_datei_im_zip(self):
        blob = make_zip("9.0.1", extra={".env": "SECRET=1\n"})
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for("9.0.1", blob, files_count=5))
        self.run_pull()
        n = self.pending("9.0.1")
        self.assertEqual(n["status"], "check-failed")
        self.assertIn("Nicht erlaubte Datei", n["error"])
        self.assertFalse((self.work / "staging" / "9.0.1").exists())

    def test_versionsdatei_im_zip_passt_nicht(self):
        blob = make_zip("9.0.1", version_in_file="9.0.5")
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for("9.0.1", blob))
        self.run_pull()
        self.assertEqual(self.pending("9.0.1")["status"], "check-failed")

    def test_dateizahl_weicht_ab(self):
        blob = make_zip("9.0.1")
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for("9.0.1", blob, files_count=99))
        self.run_pull()
        self.assertEqual(self.pending("9.0.1")["status"], "check-failed")

    def test_zu_grosses_asset_wird_nicht_geladen(self):
        blob = make_zip("9.0.1")
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for("9.0.1", blob, size=bwk_pull.MAX_ZIP + 1))
        self.run_pull()
        self.assertEqual(self.pending("9.0.1")["status"], "check-failed")
        # Nur das Manifest (Asset 2) wurde geholt, das ZIP (Asset 1) nie.
        self.assertEqual([r[1] for r in self.fake.requests if r[0] == "cdn"], ["/blob/2"])

    def test_manifest_fehlt(self):
        self.fake.publish("9.0.1", with_manifest=False)
        self.run_pull()
        self.assertEqual(self.pending("9.0.1")["status"], "check-failed")

    def test_auto_deploy_false_nur_hinweis(self):
        blob = make_zip("9.0.1")
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for(
            "9.0.1", blob, auto_deploy=False, manual_reasons=["compose.yaml geändert"]))
        self.run_pull()
        n = self.pending("9.0.1")
        self.assertEqual(n["status"], "manual-required")
        self.assertFalse(n["approvable"])
        self.assertEqual(n["manual_reasons"], ["compose.yaml geändert"])
        self.assertNotEqual(self.approve_code("9.0.1"), 0)
        # selbst eine von Hand geschriebene Freigabe installiert nichts
        self.write_grant("9.0.1", n["sha256"])
        self.run_pull()
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.result("9.0.1")["status"], "approval-invalid")

    def test_auto_deploy_true_mit_gruenden_gilt_als_manuell(self):
        blob = make_zip("9.0.1")
        self.fake.publish("9.0.1", blob=blob, manifest=manifest_for("9.0.1", blob, manual_reasons=["Grund"]))
        self.run_pull()
        self.assertEqual(self.pending("9.0.1")["status"], "manual-required")


class Freigaben(Base):
    def prepared(self, v="9.0.1"):
        blob = self.fake.publish(v)
        self.run_pull()
        return hashlib.sha256(blob).hexdigest()

    def test_abgelaufene_freigabe(self):
        sha = self.prepared()
        self.write_grant("9.0.1", sha, age=dt.timedelta(hours=25))
        self.run_pull()
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.result("9.0.1")["status"], "approval-expired")
        self.assertEqual(self.pending("9.0.1")["status"], "awaiting-approval")

    def test_freigabe_aus_der_zukunft(self):
        sha = self.prepared()
        self.write_grant("9.0.1", sha, age=-dt.timedelta(hours=2))
        self.run_pull()
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.result("9.0.1")["status"], "approval-invalid")

    def test_freigabe_mit_falschem_hash(self):
        self.prepared()
        self.write_grant("9.0.1", "f" * 64)
        self.run_pull()
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.result("9.0.1")["status"], "approval-invalid")

    def test_freigabe_mit_falscher_version_im_inhalt(self):
        sha = self.prepared()
        p = self.write_grant("9.0.1", sha)
        d = json.loads(p.read_text()); d["version"] = "9.0.7"; p.write_text(json.dumps(d))
        self.run_pull()
        self.assertEqual(self.calls(), [])

    def test_unbekannter_kanal_und_leerer_name(self):
        sha = self.prepared()
        self.write_grant("9.0.1", sha, via="telegram")
        self.run_pull()
        self.assertEqual(self.calls(), [])
        sha2 = sha
        self.write_grant("9.0.1", sha2, by="")
        self.run_pull()
        self.assertEqual(self.calls(), [])

    def test_freigabe_ohne_offene_anfrage(self):
        self.write_grant("9.0.4", "a" * 64)
        self.run_pull(only="apply")
        self.assertEqual(self.calls(), [])
        self.assertEqual(len(list((self.work / "approvals" / "used").glob("9.0.4-*-orphan.json"))), 1)

    def test_symlink_als_freigabe_wird_nicht_gelesen(self):
        sha = self.prepared()
        real = self.tmp / "real.json"
        real.write_text(json.dumps({"version": "9.0.1", "sha256": sha, "approved_by": "X", "via": "cli",
                                    "approved_at": dt.datetime.now(dt.timezone.utc).isoformat()}))
        d = self.work / "approvals" / "granted"; d.mkdir(parents=True, exist_ok=True)
        os.symlink(real, d / "9.0.1.json")
        self.run_pull()
        self.assertEqual(self.calls(), [])

    def test_ueberlange_freigabedatei(self):
        sha = self.prepared()
        p = self.write_grant("9.0.1", sha)
        p.write_text(p.read_text() + " " * 20000)
        self.run_pull()
        self.assertEqual(self.calls(), [])

    def test_manipuliertes_zip_nach_der_pruefung(self):
        sha = self.prepared()
        part = self.work / "staging" / "9.0.1" / "update.part"
        part.write_bytes(part.read_bytes() + b"x")
        self.write_grant("9.0.1", sha)
        self.run_pull()
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.result("9.0.1")["status"], "approval-invalid")

    def test_millisekunden_zeitstempel_wie_javascript(self):
        sha = self.prepared()
        p = self.write_grant("9.0.1", sha)
        d = json.loads(p.read_text())
        d["approved_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.123Z")
        p.write_text(json.dumps(d))
        self.run_pull()
        self.assertEqual(len(self.calls()), 1)

    def test_ablehnen(self):
        self.prepared()
        self.assertEqual(self.pull("reject", "9.0.1", "--confirm", "9.0.1", "--by", "Mario"), 0)
        self.run_pull()
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.result("9.0.1")["status"], "rejected")
        self.assertIsNone(self.pending("9.0.1"))
        self.run_pull()  # wird nicht erneut gemeldet
        self.assertIsNone(self.pending("9.0.1"))

    def test_cli_bestaetigung_muss_stimmen(self):
        self.prepared()
        with self.assertRaises(bwk_pull.PullError):
            self.pull("approve", "9.0.1", "--confirm", "9.0.2", "--by", "Mario")

    def test_neuere_version_ersetzt_offene(self):
        self.fake.publish("9.0.1")
        self.run_pull()
        self.fake.publish("9.0.2")
        self.run_pull()
        self.assertIsNone(self.pending("9.0.1"))
        self.assertEqual(self.result("9.0.1")["status"], "superseded")
        self.assertEqual(self.pending("9.0.2")["status"], "awaiting-approval")

    def test_pending_wird_nach_manueller_installation_aufgeraeumt(self):
        self.fake.publish("9.0.1")
        self.run_pull()
        (self.project / "VERSION").write_text("9.0.1\n")
        self.run_pull()
        self.assertIsNone(self.pending("9.0.1"))


class Fehlerfaelle(Base):
    def test_installation_startet_nicht_freigabe_wird_verbraucht_anfrage_bleibt(self):
        sha = hashlib.sha256(self.fake.publish("9.0.1")).hexdigest()
        self.run_pull()
        os.environ["FAKE_DEPLOY_MODE"] = "nostart"
        self.approve("9.0.1")
        self.run_pull()
        self.assertEqual(self.result("9.0.1")["status"], "not-started")
        self.assertEqual(self.pending("9.0.1")["status"], "awaiting-approval")
        self.assertFalse((self.work / "staging" / "9.0.1" / "deployment-request.json").exists())
        self.assertFalse((self.work / "approvals" / "granted" / "9.0.1.json").exists())
        # erneute Freigabe funktioniert
        os.environ["FAKE_DEPLOY_MODE"] = "ok"
        self.approve("9.0.1")
        self.run_pull()
        self.assertEqual(self.result("9.0.1")["status"], "deployed")

    def test_fehlgeschlagen_mit_rollback_wird_gemeldet(self):
        self.fake.publish("9.0.1")
        self.run_pull()
        os.environ["FAKE_DEPLOY_MODE"] = "rolledback"
        self.approve("9.0.1")
        self.run_pull()
        r = self.result("9.0.1")
        self.assertEqual(r["status"], "failed-rolled-back")
        self.assertEqual(r["backup_id"], "b1")
        self.assertIn("Dienst startet nicht", r["message"])
        self.assertEqual(self.prod_version(), "9.0.0")
        self.assertIsNone(self.pending("9.0.1"))
        self.run_pull()
        self.assertEqual(len(self.calls()), 1)  # keine automatische Wiederholung

    def test_belegter_lock_tut_nichts(self):
        self.fake.publish("9.0.1")
        lock = self.work / "pull" / ".pull.lock"
        fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            self.assertEqual(self.run_pull(), 0)
        finally:
            os.close(fd)
        self.assertIsNone(self.pending("9.0.1"))
        self.assertEqual(self.fake.requests, [])

    def test_netzwerkfehler_ist_nicht_fatal_und_wird_wiederholt(self):
        self.fake.publish("9.0.1")
        port = self.fake.cdn.server_port
        self.fake.cdn.shutdown(); self.fake.cdn.server_close()
        self.assertEqual(self.run_pull(), 0)
        self.assertIsNone(self.pending("9.0.1"))
        self.assertFalse((self.work / "staging" / "9.0.1").exists())
        self.assertNotIn("9.0.1", bwk_pull.load_state(bwk_pull.load_ctx(_Args(self.work)))["handled"])

    def test_token_datei_muss_privat_sein(self):
        os.chmod(self.token_file, 0o644)
        with self.assertRaises(bwk_pull.PullError):
            self.run_pull()

    def test_token_format(self):
        self.token_file.write_text("zu kurz!")
        with self.assertRaises(bwk_pull.PullError):
            self.run_pull()

    def test_weiterleitung_auf_fremden_host_wird_blockiert(self):
        self.assertTrue(bwk_pull.redirect_host_allowed("release-assets.githubusercontent.com"))
        self.assertTrue(bwk_pull.redirect_host_allowed("objects.githubusercontent.com"))
        self.assertTrue(bwk_pull.redirect_host_allowed("github.com"))
        self.assertFalse(bwk_pull.redirect_host_allowed("evil.example.com"))
        self.assertFalse(bwk_pull.redirect_host_allowed("githubusercontent.com.evil.example"))
        self.assertFalse(bwk_pull.redirect_host_allowed("notgithubusercontent.com"))
        with self.assertRaises(bwk_pull.PullError):
            bwk_pull.Fetcher("http://evil.example.com", None)

    def test_ungueltiges_repo(self):
        cfg = self.work / "pull" / "config.json"
        d = json.loads(cfg.read_text()); d["repo"] = "../../etc/passwd"; cfg.write_text(json.dumps(d))
        with self.assertRaises(bwk_pull.PullError):
            self.run_pull()

    def test_release_tag_muster(self):
        picked = bwk_pull.pick_release([
            {"tag_name": "v9.0.1"}, {"tag_name": "v9.10.0"}, {"tag_name": "9.99.0"},
            {"tag_name": "v9.0.2-beta"}, {"tag_name": "v10.0.0", "draft": True}])
        self.assertEqual(picked[0], "9.10.0")


FAKE_DOCKER = r"""#!/bin/sh
# Minimaler Docker-Ersatz für den Vertragstest mit dem echten bwk_deploy.py
case "$*" in
  *"config --services"*) printf '%b' "${FAKE_DOCKER_SERVICES:-twitchbot\\ndiscordbot\\npostgres\\n}" ;;
  *"ps --status running --services"*) printf '%b' "${FAKE_DOCKER_RUNNING:-twitchbot\\ndiscordbot\\n}" ;;
  *"exec "*"pg_dump"*) echo "docker $*" >> "$FAKE_DOCKER_LOG"; head -c 400 /dev/zero | tr '\\0' 'x' ;;
  *"exec "*"pg_dump"*) head -c 400 /dev/zero | tr '\\0' 'x' ;;
  *) echo "docker $*" >> "$FAKE_DOCKER_LOG" ;;
esac
exit 0
"""


class EchtesDeployWerkzeug(Base):
    """Vertragstest: bwk_pull ruft das ECHTE bwk_deploy.py auf (Docker durch Attrappe ersetzt)."""

    def setUp(self):
        super().setUp()
        bindir = self.tmp / "bin"; bindir.mkdir()
        (bindir / "docker").write_text(FAKE_DOCKER)
        os.chmod(bindir / "docker", 0o755)
        self.docker_log = self.tmp / "docker.log"
        self._old_path = os.environ.get("PATH", "")
        os.environ["PATH"] = str(bindir) + os.pathsep + self._old_path
        os.environ["FAKE_DOCKER_LOG"] = str(self.docker_log)
        cfg = self.work / "pull" / "config.json"
        d = json.loads(cfg.read_text()); d.pop("deploy_script"); cfg.write_text(json.dumps(d))
        (self.project / "app").mkdir(); (self.project / "app" / "server.js").write_text("alt\n")

    def cleanup(self):
        os.environ["PATH"] = self._old_path
        os.environ.pop("FAKE_DOCKER_LOG", None)
        os.environ.pop("FAKE_DOCKER_SERVICES", None)
        os.environ.pop("FAKE_DOCKER_RUNNING", None)
        super().cleanup()

    def set_config(self, **kw):
        cfg = self.work / "pull" / "config.json"
        d = json.loads(cfg.read_text()); d.update(kw); cfg.write_text(json.dumps(d))

    def test_komplette_installation_mit_echtem_werkzeug(self):
        self.fake.publish("9.0.1")
        self.run_pull()
        self.approve("9.0.1")
        self.run_pull()
        r = self.result("9.0.1")
        self.assertEqual(r["status"], "deployed", r)
        self.assertTrue(r["backup_id"].startswith("9.0.1-"))
        self.assertEqual(self.prod_version(), "9.0.1")
        self.assertEqual((self.project / "app" / "server.js").read_text(), "console.log('server');\n")
        backup = self.work / "backups" / r["backup_id"]
        self.assertTrue((backup / "postgres.dump").is_file())
        self.assertEqual((backup / "previous" / "app" / "server.js").read_text(), "alt\n")
        log = self.docker_log.read_text()
        self.assertIn("stop twitchbot discordbot", log)
        self.assertIn("up -d --build twitchbot discordbot", log)
        folder = self.work / "staging" / "9.0.1"
        self.assertEqual(json.loads((folder / "deployment-request.json").read_text())["status"], "completed")
        self.assertEqual(json.loads((folder / "deployment-request.json").read_text())["requested_via"], "pull")


    # ---- 1.5.0: Dienstliste und Datenbank-Container einstellbar

    def test_standard_ohne_einstellung_bleibt_wie_bisher(self):
        self.fake.publish("9.0.1"); self.run_pull(); self.approve("9.0.1"); self.run_pull()
        log = self.docker_log.read_text()
        self.assertIn("exec bcc-db pg_dump", log)
        self.assertIn("stop twitchbot discordbot", log)

    def test_eigene_dienste_und_datenbank_container(self):
        os.environ["FAKE_DOCKER_SERVICES"] = "web\\ntwitch\\ndiscord\\ndb\\n"
        os.environ["FAKE_DOCKER_RUNNING"] = "web\\ntwitch\\ndiscord\\ndb\\n"
        self.set_config(services=["web", "twitch", "discord"], db_container="bcc-db")
        self.fake.publish("9.0.1"); self.run_pull(); self.approve("9.0.1"); self.run_pull()
        r = self.result("9.0.1")
        self.assertEqual(r["status"], "deployed", r)
        log = self.docker_log.read_text()
        self.assertIn("exec bcc-db pg_dump", log)
        self.assertIn("stop web twitch discord", log)
        self.assertIn("up -d --build web twitch discord", log)
        self.assertNotIn("twitchbot", log)

    def test_fehlender_dienst_wird_vor_jeder_aenderung_erkannt(self):
        self.set_config(services=["web", "twitch", "discord"])   # Compose kennt nur twitchbot/discordbot
        self.fake.publish("9.0.1"); self.run_pull(); self.approve("9.0.1"); self.run_pull()
        r = self.result("9.0.1")
        self.assertNotEqual(r["status"], "deployed", r)
        self.assertEqual(self.prod_version(), "9.0.0")
        self.assertEqual((self.project / "app" / "server.js").read_text(), "alt\n")
        log = self.docker_log.read_text() if self.docker_log.exists() else ""
        self.assertNotIn("stop ", log)
        self.assertNotIn("pg_dump", log)

    def test_nicht_laufender_dienst_fuehrt_zum_rollback(self):
        os.environ["FAKE_DOCKER_SERVICES"] = "web\\ntwitch\\ndiscord\\n"
        os.environ["FAKE_DOCKER_RUNNING"] = "web\\ndiscord\\n"          # twitch startet nicht
        self.set_config(services="web,twitch,discord")
        self.fake.publish("9.0.1"); self.run_pull(); self.approve("9.0.1"); self.run_pull()
        r = self.result("9.0.1")
        self.assertEqual(r["status"], "failed-rolled-back", r)
        self.assertEqual((self.project / "app" / "server.js").read_text(), "alt\n")

    def test_ungueltige_namen_in_config_werden_abgelehnt(self):
        for bad in (["web", "--rm"], ["web", "web"], [], ["a b"], ["Web"], "x;rm -rf /", [1], ["a"] * 9):
            self.set_config(services=bad)
            with self.assertRaises(bwk_pull.PullError, msg=repr(bad)):
                self.run_pull()
        self.set_config(services=["twitchbot", "discordbot"], db_container="-v /:/host")
        with self.assertRaises(bwk_pull.PullError):
            self.run_pull()


class WerkzeugNamen(unittest.TestCase):
    def test_parse_services(self):
        d = bwk_pull.deploy
        self.assertEqual(d.parse_services(None), ("twitchbot", "discordbot"))
        self.assertEqual(d.parse_services(""), ("twitchbot", "discordbot"))
        self.assertEqual(d.parse_services("web, twitch,discord"), ("web", "twitch", "discord"))
        self.assertEqual(d.parse_services(["bcc-web", "bcc_twitch"]), ("bcc-web", "bcc_twitch"))
        for bad in ("-web", "web,,x", "a" * 64, "wéb", "web/../x", ["web", None]):
            with self.assertRaises(ValueError, msg=repr(bad)):
                d.parse_services(bad)

    def test_container_name(self):
        d = bwk_pull.deploy
        self.assertEqual(d.check_container_name("bcc-db"), "bcc-db")
        self.assertEqual(d.check_container_name("bcc-db"), "bcc-db")
        for bad in ("", "-x", "a b", "x;y", "a" * 64, "../x", None):
            with self.assertRaises(ValueError, msg=repr(bad)):
                d.check_container_name(bad)

    def test_twitch_app_ist_erlaubter_ordner(self):
        d = bwk_pull.deploy
        self.assertIn("twitch-app", d.ALLOWED_DIRS)
        self.assertEqual(d.TOOL_VERSION, bwk_pull.TOOL_VERSION)
        self.assertEqual(d.TOOL_VERSION, bwk_pull.TOOL_VERSION)


class Manifest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bwk-mrm-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def zip_to(self, version, **kw):
        p = self.tmp / f"bwk-control-center-v{version}.zip"
        p.write_bytes(make_zip(version, **kw))
        return p

    def test_unveraenderte_infrastruktur_ist_auto_deploy(self):
        old = self.zip_to("9.0.0", extra={"compose.yaml": "a", "docker/node.Dockerfile": "b"})
        new = self.zip_to("9.0.1", extra={"compose.yaml": "a", "docker/node.Dockerfile": "b", "app/neu.js": "1"})
        m = mrm.build_manifest(new, "9.0.1", old, tests=5)
        self.assertTrue(m["auto_deploy"])
        self.assertEqual(m["manual_reasons"], [])
        self.assertEqual(m["files_count"], 5)
        self.assertEqual(m["sha256"], hashlib.sha256(new.read_bytes()).hexdigest())
        bwk_pull.validate_manifest(m, "9.0.1")

    def test_compose_oder_dockerfile_aenderung_ist_manuell(self):
        old = self.zip_to("9.0.0", extra={"compose.yaml": "a", "docker/node.Dockerfile": "b"})
        new = self.zip_to("9.0.1", extra={"compose.yaml": "GEÄNDERT", "docker/node.Dockerfile": "b"})
        m = mrm.build_manifest(new, "9.0.1", old)
        self.assertFalse(m["auto_deploy"])
        self.assertTrue(any("compose.yaml" in r for r in m["manual_reasons"]))

    def test_package_json_und_migration_und_freitext(self):
        old = self.zip_to("9.0.0")
        new = self.zip_to("9.0.1", extra={"package.json": "{}"})
        m = mrm.build_manifest(new, "9.0.1", old, db_migration=True, manual_reasons=["Neustart von postgres nötig"])
        self.assertFalse(m["auto_deploy"])
        self.assertEqual(len(m["manual_reasons"]), 3)

    def test_ohne_vorgaenger_ist_manuell(self):
        new = self.zip_to("9.0.1")
        m = mrm.build_manifest(new, "9.0.1", "none")
        self.assertFalse(m["auto_deploy"])

    def test_dateiname_muss_passen(self):
        p = self.tmp / "falsch.zip"
        p.write_bytes(make_zip("9.0.1"))
        with self.assertRaises(ValueError):
            mrm.build_manifest(p, "9.0.1", "none")

    def test_manifest_kommt_durch_pull_durch(self):
        # Ende-zu-Ende: erzeugtes Manifest wird vom Pull-Werkzeug akzeptiert
        old = self.zip_to("9.0.0")
        new = self.zip_to("9.0.1")
        m = mrm.build_manifest(new, "9.0.1", old, tests=7)
        base = Base("setUp")
        base.setUp()
        try:
            base.fake.publish("9.0.1", blob=new.read_bytes(), manifest=m)
            base.run_pull()
            self.assertEqual(base.pending("9.0.1")["status"], "awaiting-approval")
            self.assertEqual(base.pending("9.0.1")["tests"], 7)
        finally:
            base.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
