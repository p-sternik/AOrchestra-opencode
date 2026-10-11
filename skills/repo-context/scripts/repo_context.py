#!/usr/bin/env python3
"""Bounded repository evidence and provenance; no model calls or code execution."""
import argparse
import ast
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import unquote

EXCLUDED = {'.git', '.opencode', '.agents', '.claude', 'node_modules', '.venv', 'venv', '__pycache__', 'vendor', '.cache'}
SOURCE_EXTENSIONS = {'.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.go', '.rs', '.java', '.cs', '.rb', '.php', '.cpp', '.c', '.h', '.kt', '.swift', '.sql'}
MANIFESTS = {'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'composer.json', 'Gemfile', 'Makefile', 'Dockerfile'}
START, END = '<!-- repo-context:start -->', '<!-- repo-context:end -->'

def sensitive(path):
    return any(part.lower() in {'.ssh', '.aws', '.gnupg', '.azure', '.kube'} for part in path.parts) or path.name.lower().startswith('.env') or path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}

def within(root, candidate):
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False

def target(root, value):
    path = Path(value)
    if path.is_absolute() or re.match(r'^[A-Za-z]:[\\/]', value) or '..' in path.parts:
        raise ValueError('Expected a repository-relative path')
    resolved = (root / path).resolve()
    if not within(root, resolved) or sensitive(path):
        raise ValueError('Path leaves repository or is sensitive')
    return resolved

def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def revision(root):
    process = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=15)
    return process.stdout.strip() if process.returncode == 0 else None

def tracked_files(root):
    try:
        process = subprocess.run(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], capture_output=True, timeout=30)
        if process.returncode == 0:
            names = process.stdout.decode('utf-8', errors='replace').split('\0')
            files = sorted(set(name for name in names if name))
            if len(files) > 50_000:
                raise ValueError('Too many files; select a smaller subproject')
            return files
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    names = []
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = [name for name in folders if name not in EXCLUDED and not (Path(directory) / name).is_symlink()]
        for name in files:
            names.append((Path(directory) / name).relative_to(root).as_posix())
        if len(names) > 50_000:
            raise ValueError('Too many files; select a smaller subproject')
    return sorted(names)

def symbols(path, text):
    if path.suffix == '.py':
        try:
            tree = ast.parse(text)
            found = [{'name': node.name, 'line': node.lineno} for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
            return 'python-ast', sorted(found, key=lambda item: item['line'])[:30]
        except SyntaxError:
            return 'unparsed', []
    pattern = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|static\s+|async\s+)*(?:class|interface|type|function|def|func|fn|struct|enum)\s+([A-Za-z_$][\w$]*)', re.MULTILINE)
    return 'regex-candidates', [{'name': match.group(1), 'line': text.count('\n', 0, match.start()) + 1} for match in list(pattern.finditer(text))[:30]]

def excluded(name, extra=()):
    path = Path(name)
    return any(part in EXCLUDED for part in path.parts) or sensitive(path) or any(name == item or name.startswith(item.rstrip('/') + '/') for item in extra)

def scoped_inventory(root, scope):
    directory = target(root, scope)
    if not directory.is_dir():
        return []
    files = []
    for name in tracked_files(root):
        path = root / name
        if not excluded(name) and within(directory, path.resolve()) and path.is_file() and not path.is_symlink():
            files.append(name)
    return sorted(files)

def index_repo(root, args):
    names, skipped, exclusions = [], 0, []
    for item in args.exclude:
        target(root, item)
    for name in tracked_files(root):
        path = Path(name)
        if excluded(name, args.exclude):
            skipped += 1
            if len(exclusions) < 30:
                exclusions.append(name)
            continue
        try:
            absolute = target(root, name)
            if absolute.is_file() and not (root / path).is_symlink():
                names.append(name)
        except ValueError:
            skipped += 1
    focus = [term.lower() for term in args.focus]
    def score(name):
        path = Path(name)
        return (50 if path.name in MANIFESTS else 0) + sum(20 for term in focus if term in name.lower()) + (5 if re.search(r'(^|/)(main|app|index|server)\.', name) else 0)
    candidates = [name for name in names if Path(name).suffix in SOURCE_EXTENSIONS or Path(name).name in MANIFESTS]
    selected, unread = [], []
    for name in sorted(candidates, key=lambda name: (-score(name), name))[:args.limit]:
        absolute = target(root, name)
        if absolute.stat().st_size > args.max_bytes:
            unread.append({'path': name, 'reason': 'file-size limit'})
            continue
        text = absolute.read_text(encoding='utf-8', errors='replace')
        kind, definitions = symbols(absolute, text)
        selected.append({'path': name, 'sha256': file_hash(absolute), 'symbols_kind': kind, 'symbols': definitions})
    print(json.dumps({'root': str(root), 'revision': safe_revision(root), 'listed_files': len(names), 'excluded_files': skipped, 'excluded_examples': exclusions,
                      'languages_by_extension': dict(collections.Counter(Path(name).suffix for name in names if Path(name).suffix in SOURCE_EXTENSIONS)),
                      'selected_files': selected, 'unread': unread, 'coverage': 'bounded selection; symbols do not establish callers, flows or domain rules'}, indent=2, ensure_ascii=False))

def safe_revision(root):
    try:
        return revision(root)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

def atomic_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='', dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()

def registry(root, docs_dir):
    directory = target(root, docs_dir)
    path = directory / '.state.json'
    if path.is_symlink() or not within(root, path.resolve()):
        raise ValueError('Unsafe provenance path')
    state = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'version': 1, 'documents': {}}
    if state.get('version') != 1 or not isinstance(state.get('documents'), dict):
        raise ValueError('Unknown provenance format')
    return directory, path, state

def record(root, args):
    _, state_path, state = registry(root, args.docs_dir)
    document = target(root, args.document)
    if not document.is_file():
        raise ValueError('Document does not exist')
    sources = {}
    for source in args.source:
        path = target(root, source)
        if not path.is_file():
            raise ValueError(f'Source does not exist: {source}')
        sources[path.relative_to(root).as_posix()] = file_hash(path)
    key = document.relative_to(root).as_posix()
    scope_files = {}
    for scope in args.scope:
        directory = target(root, scope)
        if not directory.is_dir():
            raise ValueError(f'Scope directory does not exist: {scope}')
        scope_files[directory.relative_to(root).as_posix()] = scoped_inventory(root, scope)
    state['documents'][key] = {'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'revision': safe_revision(root),
                               'document_sha256': file_hash(document), 'sources': sources, 'scope_files': scope_files}
    atomic_text(state_path, json.dumps(state, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'recorded': key, 'sources': len(sources)}))

def local_links(root, document):
    errors = []
    text = document.read_text(encoding='utf-8')
    # Check Markdown inline file targets only; heading/external/reference links need agent review.
    for match in re.finditer(r'\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["\'][^)]*["\'])?\)', text):
        value = match.group(1).strip('<>')
        if value.startswith('#') or re.match(r'^[a-z][a-z0-9+.-]*:', value, re.I):
            continue
        candidate = (document.parent / unquote(value.split('#')[0])).resolve()
        if not within(root, candidate) or not candidate.exists():
            errors.append({'document': document.relative_to(root).as_posix(), 'link': value, 'reason': 'missing or outside repository'})
    return errors

def check(root, args):
    directory, _, state = registry(root, args.docs_dir)
    issues = []
    for document_name, info in state['documents'].items():
        document = target(root, document_name)
        if not document.is_file():
            issues.append({'document': document_name, 'reason': 'document missing'})
            continue
        if file_hash(document) != info['document_sha256']:
            issues.append({'document': document_name, 'reason': 'document changed since verification'})
        for name, expected in info['sources'].items():
            source = target(root, name)
            if not source.is_file() or file_hash(source) != expected:
                issues.append({'document': document_name, 'source': name, 'reason': 'source modified or missing'})
        for scope, previous in info.get('scope_files', {}).items():
            current = scoped_inventory(root, scope)
            added, removed = sorted(set(current) - set(previous)), sorted(set(previous) - set(current))
            if added or removed:
                issues.append({'document': document_name, 'scope': scope, 'reason': 'scope inventory changed', 'added': added, 'removed': removed})
    documents = []
    if directory.exists():
        for document in directory.rglob('*.md'):
            if not document.is_symlink() and within(root, document.resolve()):
                documents.append(document)
    for name in ['AGENTS.md', 'agents.md']:
        document = root / name
        if document.is_file() and not document.is_symlink() and document not in documents:
            documents.append(document)
    for document in documents:
        issues.extend(local_links(root, document))
    print(json.dumps({'recorded_documents': len(state['documents']), 'freshness': 'tracked' if state['documents'] else 'untracked', 'checked_link_documents': len(documents), 'issues': issues,
                      'limits': 'hashes and local inline link targets only; no semantic, anchor or external-URL verification'}, indent=2, ensure_ascii=False))
    return 1 if issues else 0

def update_agents(root, args):
    map_path = target(root, args.map)
    if not map_path.is_file():
        raise ValueError('Create the repository map before linking AGENTS.md')
    if args.agents_path:
        path = target(root, args.agents_path)
    else:
        upper, lower = root / 'AGENTS.md', root / 'agents.md'
        if upper.exists() and lower.exists() and not os.path.samefile(upper, lower):
            raise ValueError('Both AGENTS.md and agents.md exist; select --agents-path explicitly')
        path = upper if upper.exists() or not lower.exists() else lower
        path = target(root, path.relative_to(root).as_posix())
    original = path.read_bytes().decode('utf-8') if path.exists() else ''
    newline = '\r\n' if '\r\n' in original else '\n'
    if original.count(START) != original.count(END) or original.count(START) > 1:
        raise ValueError('Malformed or duplicate managed navigation block')
    pointer = Path(os.path.relpath(map_path, path.parent)).as_posix()
    heading = '## Nawigacja po repozytorium' if args.language == 'pl' else '## Repository navigation'
    guidance = (f'Przy pracy w nieznanym obszarze lub zmianie między modułami zacznij od [mapy repozytorium]({pointer}). Czytaj tylko powiązane opisy modułu, przepływu i weryfikacji, a następnie sprawdź ich źródła w aktualnym kodzie.' if args.language == 'pl' else
                f'For an unfamiliar area or a cross-module change, start with [the repository map]({pointer}). Read only the relevant linked module/flow and verification notes, then confirm their source references in current code.')
    block = newline.join([START, heading, '', guidance, END])
    if START in original:
        first, last = original.index(START), original.index(END)
        if last < first:
            raise ValueError('Managed markers are out of order')
        revised = original[:first] + block + original[last + len(END):]
    else:
        revised = original + (newline + newline if original and not original.endswith(newline) else newline if original else '') + block + newline
    if args.preview:
        print(revised)
        return
    if revised != original:
        atomic_text(path, revised)
    print(json.dumps({'agents': path.relative_to(root).as_posix(), 'changed': revised != original, 'preserved_authored_text': True}))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    for mode in ['index', 'record', 'check', 'agents']:
        sub = modes.add_parser(mode)
        sub.add_argument('--root', required=True)
        if mode in {'record', 'check'}:
            sub.add_argument('--docs-dir', default='docs/agent-context')
        if mode == 'index':
            sub.add_argument('--focus', action='append', default=[])
            sub.add_argument('--limit', type=int, default=100)
            sub.add_argument('--max-bytes', type=int, default=262144)
            sub.add_argument('--exclude', action='append', default=[], help='Explicit repository-relative generated path to omit')
        elif mode == 'record':
            sub.add_argument('--document', required=True)
            sub.add_argument('--source', action='append', required=True)
            sub.add_argument('--scope', action='append', default=[], help='Directory inventory relevant to this document')
        elif mode == 'agents':
            sub.add_argument('--map', default='docs/agent-context/repo-map.md')
            sub.add_argument('--agents-path')
            sub.add_argument('--language', choices=['en', 'pl'], default='en')
            sub.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    root = Path(args.root).resolve(strict=True)
    if not root.is_dir():
        parser.error('Root must be a directory')
    if args.mode == 'index' and (args.limit < 1 or args.max_bytes < 1):
        parser.error('Limits must be positive')
    action = {'index': index_repo, 'record': record, 'check': check, 'agents': update_agents}[args.mode]
    return action(root, args) or 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(f'repo-context: {error}', file=sys.stderr)
        sys.exit(2)
