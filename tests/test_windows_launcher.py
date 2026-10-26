import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).resolve().parents[1] / 'windows/launcher.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTest(unittest.TestCase):
    def test_deploy_pairing_only_to_private_runtime_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root, data = base / 'package with spaces 中文', base / 'user data'
            (root / 'extension').mkdir(parents=True)
            data.mkdir()
            (root / 'extension/manifest.json').write_text('{}')
            source = root / 'extension/portable-config.js'
            source.write_text("globalThis.TK_PORTABLE_TOKEN = '';\n")
            with patch.object(launcher, 'ROOT', root), patch.object(launcher, 'DATA', data):
                target = launcher.deploy_extension('new-test-token')
                self.assertIn('new-test-token', (target / 'portable-config.js').read_text())
                self.assertNotIn('new-test-token', source.read_text())
                launcher.deploy_extension('rotated-token')
                self.assertNotIn('new-test-token', (target / 'portable-config.js').read_text())

    def test_browser_launch_isolated_without_remote_debugging(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            with patch.object(launcher, 'ROOT', base / '程序'), patch.object(launcher, 'DATA', base / 'user data'), patch.object(launcher.subprocess, 'Popen') as popen:
                launcher.open_browser(base / 'extension with spaces')
                args = popen.call_args.args[0]
                self.assertIn('--user-data-dir=' + str(base / 'user data/chrome-profile'), args)
                self.assertIn('--load-extension=' + str(base / 'extension with spaces'), args)
                self.assertFalse(any('remote-debugging' in a or 'disable-web-security' in a or 'no-sandbox' in a for a in args))

    def test_incomplete_package_reports_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, 'ROOT', Path(directory)):
            with self.assertRaisesRegex(RuntimeError, '完整解压'):
                launcher.required_files()


if __name__ == '__main__':
    unittest.main()
