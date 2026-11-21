#!/usr/bin/env python3
"""Baut das Werkzeug-Paket bwk-tools-vX.Y.Z.zip für ein Release (deterministisch).

Enthält genau bwk_deploy.py, bwk_pull.py und make_release_manifest.py aus diesem Ordner.
Die Startdatei launcher.py gehört nicht dazu: Sie wird vom Update-Werkzeug nie ersetzt.

Aufruf:  python3 make_tools_package.py --out-dir dist
Ausgabe: eine JSON-Zeile mit version, zip, sha256, size.

Mit --starter entsteht zusätzlich bwk-updater-start-vX.Y.Z.zip für die einmalige Ersteinrichtung:
Ordner deploy/ mit launcher.py, state.json und versions/X.Y.Z/ (in den Projektordner entpacken).
"""
import argparse
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("bwk_deploy_for_tools", str(HERE / "bwk_deploy.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def build(out_dir):
    version = deploy.TOOL_VERSION
    out = Path(out_dir) / deploy.tools_zip_name(version)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(deploy.TOOLS_FILES):
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 12, 22, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, (HERE / name).read_bytes())
    deploy.check_tools_zip(out, version)
    return {"version": version, "zip": out.name, "path": str(out), "sha256": deploy.digest_file(out),
            "size": out.stat().st_size}


def build_starter(out_dir):
    """Startpaket für die Ersteinrichtung der Startdatei (wird von Hand entpackt, nie vom Updater eingespielt)."""
    version = deploy.TOOL_VERSION
    out = Path(out_dir) / f"bwk-updater-start-v{version}.zip"
    state = {"schema": 1, "current": version, "previous": None, "pending": None, "trial": None, "failed": []}
    entries = [("deploy/launcher.py", (HERE / "launcher.py").read_bytes()),
               ("deploy/state.json", (json.dumps(state, indent=2) + "\n").encode("utf8"))]
    for guide in (HERE / "UPDATER-EINRICHTEN.md", HERE / f"UPGRADE-{version}.md"):
        if guide.is_file():
            entries.append((f"deploy/{guide.name}", guide.read_bytes()))
    entries += [(f"deploy/versions/{version}/{name}", (HERE / name).read_bytes()) for name in sorted(deploy.TOOLS_FILES)]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 12, 22, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
    return {"version": version, "zip": out.name, "path": str(out), "sha256": deploy.digest_file(out),
            "size": out.stat().st_size, "files": [n for n, _ in entries]}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Werkzeug-Paket bauen")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--starter", action="store_true", help="zusätzlich das Startpaket für die Ersteinrichtung bauen")
    args = ap.parse_args(argv)
    print(json.dumps(build(args.out_dir), ensure_ascii=False))
    if args.starter:
        print(json.dumps(build_starter(args.out_dir), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("FEHLER:", exc, file=sys.stderr)
        sys.exit(1)
