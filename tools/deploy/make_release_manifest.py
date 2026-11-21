#!/usr/bin/env python3
"""Erzeugt release-manifest.json für ein BWK-Control-Center-Release (Version 1.9.0).

Wird beim Bau eines Releases ausgeführt, nicht auf der NAS.
Nutzt dieselbe Tiefenprüfung wie das Host-Werkzeug (bwk_deploy.verify), damit
Dateizahl und SHA256 garantiert übereinstimmen.

Beispiel:
  python3 make_release_manifest.py --zip bwk-control-center-v8.9.9.zip --version 8.9.9 \\
      --previous-zip bwk-control-center-v8.9.8.zip --tests 300 --summary "Kurzbeschreibung" \\
      --out release-manifest.json

auto_deploy wird automatisch auf false gesetzt, wenn sich gegenüber dem Vorgänger
compose.yaml, docker/*, package.json oder package-lock.json ändern, oder wenn
--db-migration / --manual-reason angegeben sind.
"""
import argparse
import datetime as dt
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("bwk_deploy_for_manifest", str(HERE / "bwk_deploy.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

TOOL_VERSION = "1.9.0"
INFRA_EXACT = {"compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml",
               "package.json", "package-lock.json"}


def is_infra(rel):
    p = PurePosixPath(rel)
    return str(p) in INFRA_EXACT or (p.parts and p.parts[0] == "docker")


def entries(zip_path):
    """Relative Pfade -> (CRC, Größe) aller Infrastruktur-relevanten Dateien."""
    out = {}
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            parts = PurePosixPath(info.filename).parts
            if len(parts) < 2:
                continue
            rel = str(PurePosixPath(*parts[1:]))
            if is_infra(rel):
                out[rel] = (info.CRC, info.file_size)
    return out


def tools_entry(tools_zip):
    """Manifest-Eintrag für ein mitgeliefertes Werkzeug-Paket (bwk-tools-vX.Y.Z.zip)."""
    tools_zip = Path(tools_zip)
    m = re.fullmatch(r"bwk-tools-v(\d+\.\d+\.\d+)\.zip", tools_zip.name)
    if not m:
        raise ValueError("Werkzeug-Paket muss bwk-tools-vX.Y.Z.zip heißen")
    deploy.check_tools_zip(tools_zip, m.group(1))
    return {"version": m.group(1), "zip": tools_zip.name, "sha256": deploy.digest_file(tools_zip),
            "size": tools_zip.stat().st_size}


def build_manifest(zip_path, version, previous_zip, tests=None, summary="", manual_reasons=None, db_migration=False,
                   tools_zip=None):
    zip_path = Path(zip_path)
    if zip_path.name != f"bwk-control-center-v{version}.zip":
        raise ValueError(f"ZIP muss bwk-control-center-v{version}.zip heißen")
    tmp = Path(tempfile.mkdtemp(prefix="bwk-manifest-"))
    try:
        folder = tmp / "staging" / version
        folder.mkdir(parents=True)
        shutil.copyfile(zip_path, folder / "update.part")
        sha = deploy.digest_file(folder / "update.part")
        (folder / "upload.json").write_text(json.dumps({"version": version, "sha256": sha}))
        _, _, files, actual = deploy.verify(tmp, version)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    reasons = list(manual_reasons or [])
    if db_migration:
        reasons.append("Datenbank-Migration im Release; manuell einspielen")
    if previous_zip in (None, "none"):
        reasons.append("Keine Vergleichsbasis (kein Vorgänger-ZIP); Infrastruktur-Änderungen nicht prüfbar")
    else:
        old, new = entries(previous_zip), entries(zip_path)
        for rel in sorted(set(old) | set(new)):
            if old.get(rel) != new.get(rel):
                what = "neu" if rel not in old else "entfernt" if rel not in new else "geändert"
                reasons.append(f"{rel} {what}; Installation nur manuell")
    manifest = {
        "schema": 1, "version": version, "zip": zip_path.name, "sha256": actual,
        "size": zip_path.stat().st_size, "files_count": len(files), "tests": tests,
        "auto_deploy": not reasons, "manual_reasons": reasons, "summary": summary[:500],
        "created_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "generator": "make_release_manifest " + TOOL_VERSION,
    }
    if tools_zip:
        manifest["tools"] = tools_entry(tools_zip)
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description="release-manifest.json erzeugen")
    ap.add_argument("--zip", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--previous-zip", required=True, help="ZIP des Vorgängers oder 'none'")
    ap.add_argument("--tests", type=int)
    ap.add_argument("--summary", default="")
    ap.add_argument("--manual-reason", action="append", default=[])
    ap.add_argument("--db-migration", action="store_true")
    ap.add_argument("--tools-zip", help="Mitgeliefertes Werkzeug-Paket (bwk-tools-vX.Y.Z.zip)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    manifest = build_manifest(args.zip, args.version, args.previous_zip, args.tests, args.summary,
                              args.manual_reason, args.db_migration, args.tools_zip)
    Path(args.out).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("FEHLER:", exc, file=sys.stderr)
        sys.exit(1)
