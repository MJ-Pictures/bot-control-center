#!/usr/bin/env python3
"""Host-side BWK deployment gate. Python 3.9+. Requires local SSH/operator approval.
Never mount a Docker socket or production application tree into the MCP container.
"""
import argparse
import contextlib
import fcntl
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MAX_ZIP = 16 * 1024 * 1024
MAX_UNPACKED = 100 * 1024 * 1024
MAX_FILES = 2000
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
TOOL_VERSION = "1.8.0"
# 1.5.0: Dienstliste und Datenbank-Container sind einstellbar (Standard = bisherige Werte).
# Die Namen werden streng geprüft, weil sie als Argumente an docker übergeben werden.
DEFAULT_SERVICES = ('twitchbot', 'discordbot')
SERVICE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
CONTAINER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$")
MAX_SERVICES = 8

def parse_services(value):
    """Kommagetrennte Liste oder Liste von Compose-Dienstnamen -> geprüftes Tupel."""
    if value is None or value == '': return DEFAULT_SERVICES
    items = value if isinstance(value, (list, tuple)) else str(value).split(',')
    out = []
    for item in items:
        if not isinstance(item, str): raise ValueError('Dienstname ungültig')
        name = item.strip()
        if not SERVICE_RE.fullmatch(name): raise ValueError(f'Dienstname ungültig: {name[:40]!r}')
        if name in out: raise ValueError(f'Dienstname doppelt: {name}')
        out.append(name)
    if not out or len(out) > MAX_SERVICES: raise ValueError(f'Dienstliste braucht 1 bis {MAX_SERVICES} Einträge')
    return tuple(out)

def check_container_name(value):
    name = str(value or '')
    if not CONTAINER_RE.fullmatch(name): raise ValueError('Name des Datenbank-Containers ungültig')
    return name
# 1.5.0: 'twitch-app' für den künftigen eigenen Twitch-Bot-Container (Entkopplung Schritt 3).
# 1.8.0: 'mcp-app' (MCP-Zugang als Dienst des Control Centers).
ALLOWED_DIRS = {'app', 'discord-app', 'twitch-app', 'mcp-app', 'public', 'shared', 'overlay', 'scripts', 'tests'}
ALLOWED_ROOT = {'VERSION', 'README.md', 'SECURITY-HARDENING.md', 'DISCORD-SETUP.md', 'SOCIAL-MEDIA-SETUP.md', 'THIRD-PARTY-NOTICES.md', 'STUBENKONTROLLE-SETUP.md', 'STUBENKONTROLLE-TESTS.md', 'FOLLOWATHON-TESTS.md', 'SECURITY-TESTS.md', 'POSTGRESQL-MIGRATION.md', 'MITGLIEDER-KONSOLIDIERUNG.md', 'LICENSE.md', 'LICENSE-SUMMARY.md', 'THIRD_PARTY_LICENSES.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'NOTICE'}
ALLOWED_ROOT_RE = re.compile(r'^(UPDATE-[0-9.]+\.md|[A-Za-z0-9_-]+-TESTS\.md|package(-lock)?\.json)$')
FORBIDDEN = {'.env', '.git', '.ssh', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml', 'secrets', 'data', 'discord-data', 'postgres-data', 'backups', 'node_modules', 'deploy-work', 'config', '.DS_Store'}


# 1.7.0: Werkzeug-Paket (Selbstupdate über die Startdatei launcher.py). Ein Release kann das Werkzeug als
# eigenen Anhang mitbringen; es läuft nicht durch die Schleuse des Control-Center-ZIPs, sondern durch diese Prüfung.
TOOLS_FILES = ('bwk_deploy.py', 'bwk_pull.py', 'make_release_manifest.py')
MAX_TOOLS_ZIP = 1024 * 1024
MAX_TOOLS_FILE = 512 * 1024
TOOLS_VERSION_LINE = re.compile(rb'^TOOL_VERSION = "(\d+\.\d+\.\d+)"[ \t]*\r?$', re.M)

def tools_zip_name(version): return f'bwk-tools-v{version}.zip'

def check_tools_zip(path, version):
    """Prüft ein Werkzeug-Paket, ohne etwas daraus auszuführen. Gibt {Dateiname: Inhalt} zurück.

    Erlaubt sind genau die drei Werkzeug-Dateien, flach im ZIP, als reguläre Dateien; jede muss
    ihre Fassung als TOOL_VERSION = "x.y.z" tragen und gültiges Python sein (nur übersetzt, nicht gestartet).
    """
    if not VERSION_RE.fullmatch(str(version)): raise ValueError('Werkzeug-Fassung muss x.y.z sein')
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_TOOLS_ZIP:
        raise ValueError('Werkzeug-Paket fehlt, ist Symlink oder zu groß')
    out = {}
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if sorted(i.filename for i in infos) != sorted(TOOLS_FILES):
            raise ValueError('Werkzeug-Paket: unerwartete Dateiliste')
        for info in infos:
            unix_type = (info.external_attr >> 16) & 0o170000
            if info.is_dir() or unix_type not in (0, stat.S_IFREG) or not 0 < info.file_size <= MAX_TOOLS_FILE:
                raise ValueError(f'Werkzeug-Paket: {info.filename} ist keine zulässige Datei')
            data = z.read(info)
            if len(data) != info.file_size: raise ValueError('Werkzeug-Paket: Größe stimmt nicht')
            out[info.filename] = data
    for name, data in out.items():
        found = TOOLS_VERSION_LINE.findall(data)
        if len(found) != 1 or found[0].decode() != version:
            raise ValueError(f'Werkzeug-Paket: {name} trägt nicht die Fassung {version}')
        try: compile(data, name, 'exec', dont_inherit=True)
        except (SyntaxError, ValueError) as exc: raise ValueError(f'Werkzeug-Paket: {name} ist kein gültiges Python ({exc.__class__.__name__})')
    return out


def digest_bytes(data): return hashlib.sha256(data).hexdigest()
def digest_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    with open(tmp, 'x', encoding='utf8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)


def check_path(project, relative):
    cur = project
    for part in relative.parts:
        cur = cur / part
        if cur.is_symlink(): raise ValueError(f'Symlink im Produktivpfad verboten: {relative}')
    if not project.is_dir() or project.is_symlink(): raise ValueError('Projektwurzel fehlt oder ist Symlink')
    return cur


def allowed(rel):
    parts = rel.parts
    if not parts or any(p in FORBIDDEN or p.startswith('.') for p in parts): return False
    if len(parts) == 1: return parts[0] in ALLOWED_ROOT or bool(ALLOWED_ROOT_RE.fullmatch(parts[0]))
    return parts[0] in ALLOWED_DIRS and all(p not in FORBIDDEN for p in parts)


def verify(work, version):
    if not VERSION_RE.fullmatch(version): raise ValueError('Version muss x.y.z sein')
    folder = work / 'staging' / version
    meta_path = folder / 'upload.json'
    request_path = folder / 'deployment-request.json'
    if not meta_path.is_file(): raise ValueError('Upload-Metadaten fehlen')
    meta = json.loads(meta_path.read_text())
    zip_path = folder / 'update.part'
    if zip_path.is_symlink() or not zip_path.is_file() or zip_path.stat().st_size > MAX_ZIP:
        raise ValueError('ZIP fehlt, ist Symlink oder zu groß')
    actual = digest_file(zip_path)
    if meta.get('sha256') != actual: raise ValueError('SHA256 des ZIP stimmt nicht')
    with zipfile.ZipFile(zip_path) as z:
        files = []
        seen = set()
        size = 0
        top = None
        for info in z.infolist():
            name = info.filename
            if name.startswith('__MACOSX/') or '/._' in name or name.endswith('/.DS_Store') or name.endswith('.DS_Store'):
                continue
            if '\\' in name or name.startswith('/') or '\x00' in name:
                raise ValueError('Unsicherer Dateipfad im ZIP')
            parts = PurePosixPath(name).parts
            if any(p in ('..', '.', '') for p in parts): raise ValueError('Unsicherer Pfad')
            if top is None: top = parts[0]
            if parts[0] != top or not re.fullmatch(r'bwk-control-center-v[\w. -]+', top):
                raise ValueError('ZIP benötigt genau einen BWK-Projektwurzelordner')
            unix_type = (info.external_attr >> 16) & 0o170000
            if unix_type not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Symlink oder Spezialdatei im ZIP verboten')
            if info.is_dir(): continue
            if len(parts) < 2: raise ValueError('ZIP muss einen Wurzelordner haben')
            rel = PurePosixPath(*parts[1:])
            if not allowed(rel):
                # Bestehende Produktions-Archive enthalten zum Teil leere state/secrets-Verzeichnisse
                # mit README-Platzhaltern. Niemals nach production kopieren.
                if (str(rel) in ('compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml')) or (rel.parts[0] in ('data','discord-data','secrets','postgres-data','backups') and len(rel.parts)==2 and rel.parts[-1].lower().startswith('readme')) or (rel.parts[0]=='docker' and len(rel.parts)==2 and rel.parts[-1].endswith('.Dockerfile')) or (rel.parts[0] in ('data','discord-data','secrets') and len(rel.parts)==2 and rel.parts[-1]=='.gitkeep'):
                    continue
                raise ValueError(f'Nicht erlaubte Datei im ZIP: {rel}')
            if str(rel).lower() in seen: raise ValueError('Doppelter Dateiname')
            seen.add(str(rel).lower())
            size += info.file_size
            if size > MAX_UNPACKED or len(files) >= MAX_FILES or info.file_size > 12 * 1024 * 1024:
                raise ValueError('ZIP überschreitet Größen- oder Dateigrenzen')
            files.append((str(rel), info))
        names = {rel for rel,_ in files}
        for required in ('VERSION','app/server.js','public/index.html'):
            if required not in names: raise ValueError(f'Pflichtdatei fehlt: {required}')
        version_txt = z.read(next(info for rel, info in files if rel=='VERSION')).decode('utf8').strip()
        if version_txt.lstrip('vV') != version: raise ValueError(f'Version im Archiv ist {version_txt}; erwartet {version}')
        # CRC + Entpacken überprüfen, bevor irgendetwas produktiv verändert wird.
        for _, info in files:
            with z.open(info) as f:
                while f.read(1024 * 1024): pass
    return folder, zip_path, files, actual


def compose_run(compose, project, args):
    cmd = ['docker', 'compose', '-f', str(compose)] + args
    print('Ausführung:', ' '.join(cmd), flush=True)
    subprocess.run(cmd, cwd=project, check=True, timeout=600)


def create_backup(project, folder, files, version, db_container, db_user, db_name):
    backups = folder.parent.parent / 'backups'
    backups.mkdir(exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_id = f'{version}-{stamp}'
    target = backups / backup_id
    target.mkdir(mode=0o700)
    manifest = {'backup_id':backup_id, 'version':version, 'paths':{},'added':[],'created_at':stamp,'db_dump':'postgres.dump'}
    old = target / 'previous'
    old.mkdir()
    for rel,_ in files:
        path = check_path(project, PurePosixPath(rel))
        if path.is_dir(): raise ValueError('Dateipfad ist produktiv ein Ordner: '+rel)
        if path.exists():
            dest = old / rel
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(path,dest)
            manifest['paths'][rel] = digest_file(dest)
        else: manifest['added'].append(rel)
    write_json(target/'manifest.json',manifest)
    # Physische PostgreSQL-Daten niemals ersetzen. Konsistentes logisches Backup vor jedem Deployment.
    with open(target/'postgres.dump','wb') as stream:
        subprocess.run(['docker','exec',db_container,'pg_dump','-U',db_user,'-d',db_name,'-Fc'],stdout=stream,check=True,timeout=180)
    if (target/'postgres.dump').stat().st_size < 100:
        raise RuntimeError('PostgreSQL-Dump scheint leer: Deployment abgebrochen')
    return target


def apply_archive(project, zip_path, files):
    with zipfile.ZipFile(zip_path) as z:
        for rel,info in files:
            target = check_path(project,PurePosixPath(rel))
            target.parent.mkdir(parents=True,exist_ok=True)
            fd,tmp = tempfile.mkstemp(prefix='.bwk-update-',dir=target.parent)
            try:
                with os.fdopen(fd,'wb') as out, z.open(info) as src:
                    shutil.copyfileobj(src,out)
                    out.flush(); os.fsync(out.fileno())
                # Bestehende Eigentümer und Dateimodi erhalten (z. B. ausführbare .sh-Dateien).
                # Metadaten vor dem atomaren Austausch auf der temporären Datei setzen.
                if target.exists():
                    previous = target.stat()
                    os.chmod(tmp, stat.S_IMODE(previous.st_mode))
                    os.chown(tmp, previous.st_uid, previous.st_gid)
                else:
                    os.chmod(tmp, 0o644)
                os.replace(tmp,target)
            finally:
                if os.path.exists(tmp): os.unlink(tmp)


def restore(project, backup):
    manifest = json.loads((backup/'manifest.json').read_text())
    for rel,sha in manifest['paths'].items():
        target=check_path(project,PurePosixPath(rel))
        source=backup/'previous'/rel
        if digest_file(source)!=sha: raise RuntimeError('Backup verändert: '+rel)
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,target)
    for rel in manifest['added']:
        target=check_path(project,PurePosixPath(rel))
        if target.is_file(): target.unlink()
    return manifest


@contextlib.contextmanager
def exclusive_deployment_lock(work):
    """Serialize all host-side production actions; fail closed on concurrent access."""
    lock_path = work / '.host-deployment.lock'
    if lock_path.is_symlink():
        raise ValueError('Unsichere Lock-Datei')
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Ein weiterer Deployment-/Rollback-Vorgang läuft bereits')
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def json_or_none(path):
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding='utf8'))


def set_request_state(path, state, **fields):
    old = json_or_none(path)
    if old is None:
        raise ValueError('Freigabeanfrage fehlt')
    old.update(status=state, **fields)
    write_json(path, old)


def effective_deployment_state(folder):
    result = json_or_none(folder / 'deployment-result.json')
    in_progress = json_or_none(folder / 'deployment-state.json')
    request = json_or_none(folder / 'deployment-request.json')
    if result is not None:
        return result.get('status', 'completed')
    if in_progress is not None:
        return in_progress.get('status', 'unknown')
    if request is not None:
        return request.get('status', 'unknown')
    if (folder / 'upload.json').is_file():
        return 'staged'
    return 'not-found'


def perform_deployment(work, project, compose, folder, zpath, files, version, sha,
                       db_container, db_user, db_name, services=DEFAULT_SERVICES):
    services = list(parse_services(list(services)))
    # Lock must be held by the caller. State marker survives crashes and stops replay.
    if (folder / 'deployment-result.json').exists() or (folder / 'deployment-state.json').exists():
        raise ValueError('Deployment bereits abgeschlossen oder begonnen; keine erneute Ausführung')
    req_path = folder / 'deployment-request.json'
    request = json_or_none(req_path)
    if request is None or request.get('version') != version or request.get('sha256') != sha:
        raise ValueError('Keine passende Freigabeanfrage')
    if request.get('status') != 'pending-local-approval':
        raise ValueError('Anfrage ist nicht mehr zur Freigabe offen')
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    write_json(folder / 'deployment-state.json', {'status':'preparing','version':version,'started_at':started})
    try:
        backup = create_backup(project,folder,files,version,db_container,db_user,db_name)
    except Exception as exc:
        write_json(folder/'deployment-result.json',{'status':'failed-before-change','version':version,'error':str(exc)})
        set_request_state(req_path,'failed-before-change',finished_at=dt.datetime.now(dt.timezone.utc).isoformat())
        raise
    print('Backup und PostgreSQL-Dump:', backup, flush=True)
    write_json(folder/'deployment-state.json',{'status':'deploying','version':version,'backup_id':backup.name,'started_at':started})
    try:
        compose_run(compose,project,['stop',*services])
        apply_archive(project,zpath,files)
        compose_run(compose,project,['up','-d','--build',*services])
        running=subprocess.check_output(['docker','compose','-f',str(compose),'ps','--status','running','--services'],cwd=project,text=True,timeout=30).splitlines()
        if not set(services).issubset(set(running)):
            raise RuntimeError('Nicht alle Bot-Dienste laufen')
        result={'status':'deployed','backup_id':backup.name,'version':version}
        write_json(folder/'deployment-result.json',result)
        set_request_state(req_path,'completed',completed_at=dt.datetime.now(dt.timezone.utc).isoformat(),backup_id=backup.name)
        write_json(folder/'deployment-state.json',{'status':'deployed','version':version,'backup_id':backup.name})
        print(json.dumps(result))
    except Exception as exc:
        print('Deployment fehlgeschlagen; Datei-Rollback wird versucht:',str(exc),file=sys.stderr)
        recovered=False
        recovery_error=None
        try:
            restore(project,backup)
            compose_run(compose,project,['up','-d','--build',*services])
            recovered=True
        except Exception as rollback_error:
            recovery_error=str(rollback_error)
            print('KRITISCH: manueller Eingriff erforderlich:',rollback_error,file=sys.stderr)
        result={'status':'failed-rolled-back' if recovered else 'failed-manual-recovery-required',
                'backup_id':backup.name,'version':version,'error':str(exc)}
        if recovery_error: result['recovery_error']=recovery_error
        write_json(folder/'deployment-result.json',result)
        set_request_state(req_path,result['status'],finished_at=dt.datetime.now(dt.timezone.utc).isoformat(),backup_id=backup.name)
        write_json(folder/'deployment-state.json',result)
        raise


def perform_rollback(work, project, compose, backup_id, services=DEFAULT_SERVICES):
    services = list(parse_services(list(services)))
    request_path=work/'requests'/f'rollback-{backup_id}.json'
    request=json_or_none(request_path)
    if request is None or request.get('backup_id') != backup_id:
        raise ValueError('Keine passende Rollback-Anfrage')
    if request.get('status') != 'pending-local-approval':
        raise ValueError('Rollback-Anfrage bereits verarbeitet oder gesperrt')
    result_path=work/'requests'/f'rollback-result-{backup_id}.json'
    state_path=work/'requests'/f'rollback-state-{backup_id}.json'
    if result_path.exists() or state_path.exists():
        raise ValueError('Rollback bereits gestartet oder abgeschlossen')
    backup=work/'backups'/backup_id
    if not backup.is_dir():raise ValueError('Backup nicht gefunden')
    write_json(state_path,{'status':'rolling-back','backup_id':backup_id})
    try:
        compose_run(compose,project,['stop',*services])
        restore(project,backup)
        compose_run(compose,project,['up','-d','--build',*services])
        running=subprocess.check_output(['docker','compose','-f',str(compose),'ps','--status','running','--services'],cwd=project,text=True,timeout=30).splitlines()
        if not set(services).issubset(set(running)):
            raise RuntimeError('Nicht alle Bot-Dienste laufen nach Rollback')
        result={'status':'rolled-back','backup_id':backup_id}
        write_json(result_path,result)
        set_request_state(request_path,'completed',completed_at=dt.datetime.now(dt.timezone.utc).isoformat())
        write_json(state_path,result)
        print('Code-Rollback abgeschlossen. DB-Dump nur manuell nach fachlicher Prüfung wiederherstellen:',backup/'postgres.dump')
    except Exception as exc:
        result={'status':'failed-manual-review-required','backup_id':backup_id,'error':str(exc)}
        write_json(result_path,result)
        set_request_state(request_path,'failed-manual-review-required',finished_at=dt.datetime.now(dt.timezone.utc).isoformat())
        write_json(state_path,result)
        raise


def main():
    ap=argparse.ArgumentParser(description='BWK host-only update gateway (kein MCP-Rootzugriff)')
    ap.add_argument('command',choices=['stage-local','request-local','inspect','deploy','rollback','status'])
    ap.add_argument('identifier',help='Update-Version x.y.z oder Backup-ID')
    ap.add_argument('--work',required=True, type=Path,help='NAS-Pfad des deploy-work-Verzeichnisses')
    ap.add_argument('--project',type=Path,help='Existierender produktiver Control-Center-Quellcode-Ordner')
    ap.add_argument('--compose',type=Path,help='Vollständiger Pfad zur produktiven compose.yaml')
    ap.add_argument('--confirm',help='Lokale Bestätigung: exakte Versions-/Backup-ID')
    ap.add_argument('--zip',type=Path,help='Lokale ZIP-Datei für stage-local')
    ap.add_argument('--expected-sha256',help='Vertrauenswürdig unabhängig abgeglichener SHA256 des ZIPs')
    ap.add_argument('--db-container',default='bcc-db',help='Name des PostgreSQL-Containers für den Dump')
    ap.add_argument('--services',default=','.join(DEFAULT_SERVICES),help='Kommagetrennte Compose-Dienste, die gestoppt und neu gestartet werden')
    ap.add_argument('--version',action='version',version='bwk_deploy '+TOOL_VERSION)
    ap.add_argument('--db-user',default='bwk')
    ap.add_argument('--db-name',default='bwk')
    args=ap.parse_args()
    wanted=parse_services(args.services)
    args.db_container=check_container_name(args.db_container)
    work=args.work.resolve(strict=True)
    if args.command=='stage-local':
        if not VERSION_RE.fullmatch(args.identifier) or not args.zip: raise ValueError('Version und --zip erforderlich')
        src=args.zip.resolve(strict=True)
        if src.stat().st_size>MAX_ZIP:raise ValueError('Archiv zu groß')
        dest=work/'staging'/args.identifier
        dest.mkdir(parents=True,exist_ok=True)
        if (dest/'upload.json').exists() or (dest/'update.part').exists():raise ValueError('Version ist bereits gestaged')
        shutil.copyfile(src,dest/'update.part')
        sha=digest_file(dest/'update.part')
        write_json(dest/'upload.json',{'version':args.identifier,'sha256':sha,'created_via':'local-host'})
        print('Staged',args.identifier,'SHA256:',sha)
        return
    if args.command=='request-local':
        folder,_,_,sha=verify(work,args.identifier)
        p=folder/'deployment-request.json'
        if p.exists() or (folder/'deployment-result.json').exists() or (folder/'deployment-state.json').exists():raise ValueError('Anfrage wurde bereits erstellt oder Version verarbeitet')
        write_json(p,{'version':args.identifier,'sha256':sha,'status':'pending-local-approval','requested_via':'local-host'})
        print('Anfrage erstellt; KEINE Installation ausgeführt')
        return
    if args.command=='status':
        d=work/'staging'/args.identifier
        print('effective_status:', effective_deployment_state(d))
        for filename in ['upload.json','validated-sha256.json','deployment-request.json','host-review.json','deployment-state.json','deployment-result.json']:
            p=d/filename
            if p.exists():print(filename, p.read_text())
        return
    if args.command in ('inspect','deploy'):
        folder,zpath,files,sha=verify(work,args.identifier)
        result={'version':args.identifier,'sha256':sha,'files_count':len(files),'files':[r for r,_ in files], 'decision':'review-required'}
        write_json(folder/'host-review.json',result)
        print(json.dumps({'version':args.identifier,'sha256':sha,'files_count':len(files),'paths':result['files'][:30]},indent=2))
        if args.command=='inspect':return
    if not args.project or not args.compose: raise ValueError('Für deploy/rollback sind --project und --compose erforderlich')
    project=args.project.resolve(strict=True)
    compose=args.compose.resolve(strict=True)
    if compose.name not in ('compose.yaml','compose.yml','docker-compose.yml','docker-compose.yaml'):
        raise ValueError('Unerwarteter Compose-Dateiname')
    if not compose.is_file() or not project.is_dir() or project == work or work in project.parents:
        raise ValueError('Produktionspfade ungültig')
    services = subprocess.check_output(['docker','compose','-f',str(compose),'config','--services'],cwd=project,text=True,timeout=30).splitlines()
    required=set(wanted)
    if not required.issubset(set(services)):
        raise ValueError(f'Benötigte Dienste fehlen: {sorted(required-set(services))}')
    if args.confirm != args.identifier:
        raise ValueError('Explizite lokale Freigabe fehlt: --confirm muss exakt der ID entsprechen')
    if args.command=='deploy':
        if not args.expected_sha256 or args.expected_sha256 != sha:
            raise ValueError('Unabhängig geprüfter SHA256 erforderlich: --expected-sha256')
        with exclusive_deployment_lock(work):
            perform_deployment(work,project,compose,folder,zpath,files,args.identifier,sha,
                               args.db_container,args.db_user,args.db_name,wanted)
    else:
        if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-\d{8}T\d{6}Z',args.identifier):
            raise ValueError('Backup-ID ungültig')
        with exclusive_deployment_lock(work):
            perform_rollback(work,project,compose,args.identifier,wanted)

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('FEHLER:',e,file=sys.stderr);sys.exit(1)
