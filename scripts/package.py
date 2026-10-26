"""Build a redistributable ZIP without models, credentials or environment files."""
from pathlib import Path
import zipfile
import json

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
out = root / 'dist' / f'网页口播中文助手-{version}.zip'
out.parent.mkdir(exist_ok=True)
files = [*sorted((root / 'extension').rglob('*')), root / 'README.md', root / 'RESEARCH.md', root / 'VALIDATION.md', root / 'LICENSE', root / 'design/UI-0.2.md', root / '启动本机识别.command', root / '启动本机识别.bat', root / 'server/server.py', root / 'server/requirements.txt', root / 'package.json', root / '.gitignore', *sorted((root / 'tests').glob('*.cjs')), *sorted((root / 'tests').glob('test_*.py')), root / 'scripts/package.py', root / 'scripts/package_windows.py', *sorted((root / 'windows').glob('*'))]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        if file.is_file():
            archive.write(file, '网页口播中文助手/' + file.relative_to(root).as_posix())
print(out)
