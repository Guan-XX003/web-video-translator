"""Assemble Windows x64 portable ZIP from official runtime/browser and PyPI wheels."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / 'build/windows-downloads'
OUT = ROOT / 'build/windows-portable/TikTok-Chinese-Assistant-Windows'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']


def extract_wheel(wheel, target):
    with zipfile.ZipFile(wheel) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            parts = PurePosixPath(info.filename).parts
            if '..' in parts or PurePosixPath(info.filename).is_absolute():
                raise ValueError('Unsafe wheel member')
            if parts[0].endswith('.data'):
                if parts[1] not in {'purelib', 'platlib'}:
                    raise ValueError(f'Wheel requires installer handling: {info.filename}')
                parts = parts[2:]
            dest = target.joinpath(*parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(archive.read(info))


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    runtime = OUT / 'runtime'
    runtime.mkdir()
    with zipfile.ZipFile(DOWNLOADS / 'python-3.12.10-embed-amd64.zip') as archive:
        archive.extractall(runtime)
    site = runtime / 'Lib/site-packages'
    site.mkdir(parents=True)
    wheels = sorted((DOWNLOADS / 'wheels').glob('*.whl'))
    for wheel in wheels:
        if not ('win_amd64' in wheel.name or 'none-any' in wheel.name):
            raise ValueError(f'Unexpected platform: {wheel}')
        extract_wheel(wheel, site)
    (runtime / 'python312._pth').write_text('python312.zip\n.\nLib\\site-packages\n..\\server\nimport site\n', encoding='ascii')
    # App-local Microsoft C++ runtime: no administrator install required.
    with zipfile.ZipFile(DOWNLOADS / 'Microsoft.VCLibs.x64.14.00.Desktop.appx') as archive:
        for name in ('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'concrt140.dll', 'vcomp140.dll'):
            (runtime / name).write_bytes(archive.read(name))
    (OUT / 'browser').mkdir()
    with zipfile.ZipFile(DOWNLOADS / 'chrome-win64.zip') as archive:
        archive.extractall(OUT / 'browser')
    for name in ('extension', 'server'):
        shutil.copytree(ROOT / name, OUT / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copytree(ROOT / 'windows', OUT / 'windows', ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.bat'))
    for name in ('一键启动.bat', '运行诊断.bat'):
        shutil.copy2(ROOT / 'windows' / name, OUT / name)
    model_cache = Path.home() / '.cache/huggingface/hub/models--Systran--faster-whisper-small'
    revision = (model_cache / 'refs/main').read_text().strip()
    model = OUT / 'models/faster-whisper-small'
    model.mkdir(parents=True)
    for name in ('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt', 'README.md'):
        shutil.copy2(model_cache / 'snapshots' / revision / name, model / name)
    # Original OpenAI license also applies to the converted small weights.
    shutil.copy2(DOWNLOADS / 'whisper-LICENSE.txt', model / 'LICENSE.txt')
    support = OUT / 'support'
    support.mkdir()
    shutil.copy2(DOWNLOADS / 'vc_redist.x64.exe', support)
    shutil.copy2(ROOT / 'LICENSE', OUT)
    shutil.copy2(ROOT / 'VALIDATION.md', OUT)
    shutil.copy2(ROOT / 'windows/使用说明.txt', OUT / '使用说明.txt')
    sources = {
        'python': 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
        'chrome': json.loads((DOWNLOADS / 'chrome-source.json').read_text()),
        'model': {'repository': 'https://huggingface.co/Systran/faster-whisper-small', 'revision': revision},
        'microsoft_runtime': 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx',
        'microsoft_repair': 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
        'wheels': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in wheels},
        'downloads_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in DOWNLOADS.iterdir() if p.is_file()},
    }
    (OUT / 'SOURCES.json').write_text(json.dumps(sources, indent=2, ensure_ascii=False), encoding='utf-8')
    lock = []
    from email.parser import BytesParser
    for wheel in wheels:
        with zipfile.ZipFile(wheel) as archive:
            metadata = BytesParser().parsebytes(archive.read(next(n for n in archive.namelist() if n.endswith('.dist-info/METADATA'))))
            lock.append(f"{metadata['Name']}=={metadata['Version']}")
    (OUT / 'windows/requirements-lock.txt').write_text('\n'.join(sorted(lock))+'\n', encoding='utf-8')
    paths = [p for p in OUT.rglob('*') if p.is_file()]
    checksums = {p.relative_to(OUT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    (OUT / 'SHA256SUMS.json').write_text(json.dumps(checksums, indent=2, ensure_ascii=False), encoding='utf-8')
    dest = ROOT / 'dist' / f'Web-Video-Translator-Windows-{VERSION}-x64.zip'
    dest.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for p in sorted(OUT.rglob('*')):
            if p.is_file():
                archive.write(p, 'TikTok-Chinese-Assistant-Windows/' + p.relative_to(OUT).as_posix())
    print(f'{dest}\nZIP: {dest.stat().st_size / 1024**2:.1f} MiB; extracted: {sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1024**2:.1f} MiB', flush=True)


if __name__ == '__main__':
    build()
