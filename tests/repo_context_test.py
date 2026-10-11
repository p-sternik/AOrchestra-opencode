import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/repo-context/scripts/repo_context.py'

class RepoContextTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path(__file__).parent, prefix='repo-context-test-')
        self.root = Path(self.temporary.name)
        (self.root / 'src').mkdir()
        (self.root / 'src/api.py').write_text('def old_api():\n    return 1\n', encoding='utf-8')
        (self.root / 'docs/agent-context').mkdir(parents=True)
        (self.root / 'docs/agent-context/repo-map.md').write_text('# Map\n[API](../../src/api.py)\n', encoding='utf-8')
    def tearDown(self):
        self.temporary.cleanup()
    def run_helper(self, mode, *args):
        return subprocess.run([sys.executable, str(SCRIPT), mode, '--root', str(self.root), *args], capture_output=True, text=True)
    def test_agents_preserves_authored_bytes_and_is_idempotent(self):
        path = self.root / 'AGENTS.md'
        authored = b'# Existing policy\r\n\r\nUse only approved staging commands.\r\n'
        path.write_bytes(authored)
        self.assertEqual(self.run_helper('agents').returncode, 0)
        first = path.read_bytes()
        self.assertTrue(first.startswith(authored))
        self.assertEqual(self.run_helper('agents').returncode, 0)
        self.assertEqual(first, path.read_bytes())
    def test_malformed_agents_is_not_overwritten(self):
        path = self.root / 'AGENTS.md'
        original = '# Policy\n<!-- repo-context:start -->\n'
        path.write_text(original, encoding='utf-8')
        self.assertEqual(self.run_helper('agents').returncode, 2)
        self.assertEqual(original, path.read_text(encoding='utf-8'))
    def test_missing_map_does_not_create_agents(self):
        result = self.run_helper('agents', '--map', 'docs/missing.md')
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / 'AGENTS.md').exists())
    def test_preview_does_not_mutate(self):
        self.assertEqual(self.run_helper('agents', '--preview').returncode, 0)
        self.assertFalse((self.root / 'AGENTS.md').exists())
    def test_polish_navigation_is_supported(self):
        result = self.run_helper('agents', '--language', 'pl')
        self.assertEqual(result.returncode, 0)
        content = (self.root / 'AGENTS.md').read_text(encoding='utf-8')
        self.assertIn('Nawigacja po repozytorium', content)
        self.assertIn('[mapy repozytorium]', content)
    def test_modified_source_marks_document_stale(self):
        result = self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', 'src/api.py')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.run_helper('check').returncode, 0)
        (self.root / 'src/api.py').write_text('def old_api():\n    return 2\n', encoding='utf-8')
        result = self.run_helper('check')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['issues'][0]['source'], 'src/api.py')
    def test_deleted_source_and_broken_links_are_reported(self):
        self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', 'src/api.py')
        (self.root / 'src/api.py').unlink()
        result = self.run_helper('check')
        self.assertEqual(result.returncode, 1)
        issues = json.loads(result.stdout)['issues']
        self.assertTrue(any('source' in issue for issue in issues))
        self.assertTrue(any('link' in issue for issue in issues))
    def test_outside_source_and_sensitive_file_are_rejected(self):
        for source in ['../outside.py', '.env', 'C:/outside.py']:
            result = self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', source)
            self.assertEqual(result.returncode, 2)
    def test_index_skips_secrets_and_marks_symbol_parser(self):
        (self.root / '.env').write_text('TOKEN=dummy\n', encoding='utf-8')
        result = self.run_helper('index', '--focus', 'api', '--limit', '5')
        self.assertEqual(result.returncode, 0)
        index = json.loads(result.stdout)
        api = next(item for item in index['selected_files'] if item['path'] == 'src/api.py')
        self.assertEqual(api['symbols_kind'], 'python-ast')
        self.assertEqual(api['symbols'][0]['name'], 'old_api')
        self.assertNotIn('TOKEN', result.stdout)
    def test_source_build_directory_is_included(self):
        (self.root / 'src/build').mkdir()
        (self.root / 'src/build/compiler.py').write_text('def compile_sources():\n    return True\n', encoding='utf-8')
        result = self.run_helper('index', '--focus', 'compiler', '--limit', '10')
        self.assertEqual(result.returncode, 0)
        self.assertIn('src/build/compiler.py', [item['path'] for item in json.loads(result.stdout)['selected_files']])
    def test_explicit_exclusion_is_visible(self):
        (self.root / 'generated').mkdir()
        (self.root / 'generated/compiler.py').write_text('def generated(): pass\n', encoding='utf-8')
        result = self.run_helper('index', '--exclude', 'generated')
        data = json.loads(result.stdout)
        self.assertNotIn('generated/compiler.py', [item['path'] for item in data['selected_files']])
        self.assertIn('generated/compiler.py', data['excluded_examples'])
    def test_new_scoped_file_identifies_affected_document(self):
        self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', 'src/api.py', '--scope', 'src')
        (self.root / 'src/consumer.py').write_text('from api import old_api\n', encoding='utf-8')
        result = self.run_helper('check')
        self.assertEqual(result.returncode, 1)
        issue = next(item for item in json.loads(result.stdout)['issues'] if item['reason'] == 'scope inventory changed')
        self.assertEqual(issue['document'], 'docs/agent-context/repo-map.md')
        self.assertEqual(issue['added'], ['src/consumer.py'])
    def test_missing_provenance_is_not_reported_as_tracked_freshness(self):
        result = self.run_helper('check')
        self.assertEqual(json.loads(result.stdout)['freshness'], 'untracked')

if __name__ == '__main__':
    unittest.main(verbosity=2)
