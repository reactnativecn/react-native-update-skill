"""Exercise the actual release shell with isolated fake git/gh executables."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
COMMIT = '1' * 40
OTHER = '2' * 40
TAG_OBJECT = '3' * 40


class ReleaseTagTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'tools').mkdir()
        (self.root / 'releases').mkdir()
        shutil.copyfile(ROOT / 'tools/release.sh', self.root / 'tools/release.sh')
        (self.root / 'VERSION').write_text('0.5.0\n')
        (self.root / 'releases/v0.5.0.md').write_text('notes\n')
        (self.root / 'react-native-update.skill').write_bytes(b'package')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.log = self.root / 'calls.log'
        self.env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}',
                    'GITHUB_REPOSITORY': 'test/repo', 'GITHUB_SHA': COMMIT,
                    'GH_TOKEN': 'test-not-a-token', 'CALL_LOG': str(self.log),
                    'REMOTE_TAGS': '', 'LS_FAILURE': '0', 'PUSH_FAILURE': '0'}
        self.fake('git', '''import os, sys
args = sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as f: f.write('git ' + ' '.join(args) + '\\n')
if args[0] == 'rev-parse': print(os.environ['GITHUB_SHA'])
if args[0] == 'ls-remote':
    print(os.environ['REMOTE_TAGS'])
    sys.exit(int(os.environ['LS_FAILURE']))
if args[0] == 'push': sys.exit(int(os.environ['PUSH_FAILURE']))
''')
        self.fake('gh', '''import os, sys
with open(os.environ['CALL_LOG'], 'a') as f: f.write('gh ' + ' '.join(sys.argv[1:]) + '\\n')
''')
        self.fake('sha256sum', "print('fixture-checksum  react-native-update.skill')")
        self.fake('python3', '')  # The package is a fixed fixture; packaging has its own suite.

    def fake(self, name, body):
        file = self.bin / name
        file.write_text(f'#!{sys.executable} -S\n{body}')
        file.chmod(0o755)

    def run_release(self):
        result = subprocess.run(['bash', str(self.root / 'tools/release.sh')], env=self.env,
                                capture_output=True, text=True, timeout=20)
        return result, self.log.read_text()

    def test_occupied_lightweight_tag_is_rejected_before_release_creation(self):
        self.env['REMOTE_TAGS'] = f'{OTHER}\trefs/tags/v0.5.0'
        result, calls = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Refusing to publish', result.stdout)
        self.assertNotIn('gh ', calls)
        self.assertNotIn('git push', calls)

    def test_occupied_annotated_tag_is_peeled_and_rejected(self):
        self.env['REMOTE_TAGS'] = f'{TAG_OBJECT}\trefs/tags/v0.5.0\n{OTHER}\trefs/tags/v0.5.0^{{}}'
        result, calls = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(OTHER, result.stdout)
        self.assertNotIn('gh ', calls)

    def test_matching_lightweight_tag_is_reused_without_moving_it(self):
        self.env['REMOTE_TAGS'] = f'{COMMIT}\trefs/tags/v0.5.0'
        result, calls = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--verify-tag', calls)
        self.assertNotIn('git tag ', calls)
        self.assertNotIn('git push', calls)

    def test_matching_annotated_tag_uses_peeled_commit(self):
        self.env['REMOTE_TAGS'] = f'{TAG_OBJECT}\trefs/tags/v0.5.0\n{COMMIT}\trefs/tags/v0.5.0^{{}}'
        result, calls = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('gh release create', calls)
        self.assertNotIn('git push', calls)

    def test_missing_tag_is_pushed_before_verified_release_creation(self):
        result, calls = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'git tag v0.5.0 {COMMIT}', calls)
        self.assertLess(calls.index('git push origin refs/tags/v0.5.0'), calls.index('gh release create'))
        self.assertIn('--verify-tag', calls)
        self.assertNotIn('--force', calls)

    def test_lookup_failure_is_not_treated_as_absent_tag(self):
        self.env['LS_FAILURE'] = '128'
        result, calls = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('git tag ', calls)
        self.assertNotIn('gh ', calls)

    def test_racing_tag_push_failure_stops_publication(self):
        self.env['PUSH_FAILURE'] = '1'
        result, calls = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('gh ', calls)


if __name__ == '__main__':
    unittest.main()
