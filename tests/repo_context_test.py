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
    def make_symlink(self, path, target, directory=False):
        try:
            path.symlink_to(target, target_is_directory=directory)
        except OSError as error:
            if getattr(error, 'winerror', None) == 1314:
                self.skipTest('Windows account lacks symlink privilege')
            raise
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

    def test_resolved_sensitive_sources_are_rejected(self):
        secret = self.root / '.env.private'
        secret.write_text('def private_token(): pass\n', encoding='utf-8')
        self.make_symlink(self.root / 'src/alias.py', secret)
        result = self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', 'src/alias.py')
        self.assertEqual(result.returncode, 2)

    def test_sensitive_directory_alias_is_rejected(self):
        secret = self.root / '.aws'
        secret.mkdir()
        (secret / 'private.py').write_text('def private_token(): pass\n', encoding='utf-8')
        self.make_symlink(self.root / 'src/alias', secret, directory=True)
        spec = importlib.util.spec_from_file_location('repo_context', SCRIPT)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        with self.assertRaises(ValueError):
            helper.target(self.root, 'src/alias/private.py')

    def test_nested_navigation_with_spaces_preserves_policy_and_valid_links(self):
        path = self.root / 'src/AGENTS.md'
        authored = '# Module policy\nPreserve legacy API.\n'
        path.write_text(authored, encoding='utf-8')
        document = self.root / 'docs/agent-context/repo map.md'
        document.write_text('# Map\n', encoding='utf-8')
        args = ('--agents-path', 'src/AGENTS.md', '--map', 'docs/agent-context/repo map.md')
        self.assertEqual(self.run_helper('agents', *args).returncode, 0)
        first = path.read_text(encoding='utf-8')
        self.assertTrue(first.startswith(authored))
        self.assertIn('(../docs/agent-context/repo%20map.md)', first)
        self.assertEqual(self.run_helper('agents', *args).returncode, 0)
        self.assertEqual(first, path.read_text(encoding='utf-8'))

    def test_unrecorded_documents_remain_visible_with_partial_provenance(self):
        self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', 'src/api.py')
        (self.root / 'docs/agent-context/new-module.md').write_text('# Unverified\n', encoding='utf-8')
        result = self.run_helper('check')
        data = json.loads(result.stdout)
        self.assertEqual(data['freshness'], 'partial')
        self.assertIn('docs/agent-context/new-module.md', data['untracked_documents'])

    def test_index_bounds_and_unknown_symbols(self):
        (self.root / 'src/api.py').write_text('not valid python !', encoding='utf-8')
        data = json.loads(self.run_helper('index', '--focus', 'api', '--limit', '1').stdout)
        self.assertEqual(len(data['selected_files']), 1)
        self.assertEqual(data['selected_files'][0]['symbols_kind'], 'unparsed')
        self.assertEqual(data['selected_files'][0]['symbols'], [])
        data = json.loads(self.run_helper('index', '--limit', '1', '--max-bytes', '1').stdout)
        self.assertEqual(data['selected_files'], [])
        self.assertEqual(data['unread'][0]['reason'], 'file-size limit')

    def test_scoped_refresh_preserves_other_document_provenance(self):
        second = 'docs/agent-context/other.md'
        (self.root / second).write_text('# Other\n', encoding='utf-8')
        (self.root / 'other.py').write_text('def other(): pass\n', encoding='utf-8')
        self.run_helper('record', '--document', second, '--source', 'other.py')
        state_path = self.root / 'docs/agent-context/.state.json'
        prior = json.loads(state_path.read_text())['documents'][second]
        self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', 'src/api.py', '--scope', 'src')
        (self.root / 'other.py').write_text('def changed(): pass\n', encoding='utf-8')
        self.run_helper('record', '--document', 'docs/agent-context/repo-map.md', '--source', 'src/api.py', '--scope', 'src')
        self.assertEqual(json.loads(state_path.read_text())['documents'][second], prior)
        issues = json.loads(self.run_helper('check').stdout)['issues']
        self.assertEqual({issue['document'] for issue in issues}, {second})

if __name__ == '__main__':
    unittest.main(verbosity=2)
