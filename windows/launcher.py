"""Windows portable launcher: no downloads, pip, registry edits, or system Python."""
import argparse
import ctypes
import json
import os
import platform
import shutil
import subprocess
import sys
import traceback
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'TikTokTranscriptZh'
MODEL = ROOT / 'models' / 'faster-whisper-base'
DLL_HANDLES = []


def prepare_environment():
    DATA.mkdir(parents=True, exist_ok=True)
    os.environ['TK_CONFIG_DIR'] = str(DATA / 'config')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['PYTHONUTF8'] = '1'
    # Keep all loaded DLL directories alive for delayed native imports.
    runtime = ROOT / 'runtime'
    dirs = {runtime, *(p.parent for p in (runtime / 'Lib' / 'site-packages').rglob('*.dll'))}
    for directory in sorted(dirs):
        if directory.is_dir():
            DLL_HANDLES.append(os.add_dll_directory(str(directory)))
    sys.path.insert(0, str(ROOT / 'server'))


def required_files():
    for relative in ('runtime/python.exe', 'browser/chrome-win64/chrome.exe', 'extension/manifest.json',
                     'server/server.py', 'models/faster-whisper-base/model.bin',
                     'models/faster-whisper-base/config.json', 'models/faster-whisper-base/tokenizer.json'):
        if not (ROOT / relative).is_file():
            raise RuntimeError(f'文件不完整：{relative}。请先完整解压 ZIP，再运行一键启动.bat。')


def health(token):
    request = urllib.request.Request('http://127.0.0.1:8765/health', headers={'X-TK-Token': token})
    try:
        # Bypass system proxy only for this loopback check.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=2) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError('8765 端口正在被其他服务使用。请关闭之前的识别服务窗口后重试。') from error
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return None


def deploy_extension(token):
    target = DATA / 'extension'
    target.mkdir(exist_ok=True)
    for source in (ROOT / 'extension').rglob('*'):
        if not source.is_file():
            continue
        dest = target / source.relative_to(ROOT / 'extension')
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
    # Generated on the target computer. Never included in the redistributable ZIP.
    config = target / 'portable-config.js'
    config.write_text('globalThis.TK_PORTABLE_TOKEN = ' + json.dumps(token) + ';\n', encoding='utf-8')
    return target


def open_browser(extension):
    subprocess.Popen([
        str(ROOT / 'browser' / 'chrome-win64' / 'chrome.exe'),
        '--user-data-dir=' + str(DATA / 'chrome-profile'),
        '--load-extension=' + str(extension),
        '--disable-extensions-except=' + str(extension),
        '--no-first-run', '--no-default-browser-check',
        'https://www.tiktok.com/',
    ], cwd=ROOT, close_fds=True)


def diagnose():
    required_files()
    import faster_whisper
    import ctranslate2
    import onnxruntime
    import numpy
    import av
    print('Windows Python:', sys.version.split()[0], platform.machine())
    print('faster-whisper:', faster_whisper.__version__)
    print('CTranslate2:', ctranslate2.__version__, 'ONNX Runtime:', onnxruntime.__version__)
    from server import Transcriber
    transcriber = Transcriber('base', offline=True, model_path=MODEL)
    transcriber.load()
    sample = ROOT / 'windows' / 'smoke.wav'
    result = transcriber.transcribe(sample.read_bytes(), 'en')
    text = ' '.join(segment['text'] for segment in result['segments'])
    if 'bedroom' not in text.lower():
        raise RuntimeError('测试语音识别结果不符合预期：' + text)
    print('离线识别测试通过:', text)
    print('依赖、模型及测试语音均来自包内，没有下载文件。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--diagnose', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'win32' or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise RuntimeError('此便携包用于 Windows 10/11 的 Intel / AMD 64 位电脑。')
    ctypes.windll.kernel32.SetConsoleTitleW('网页口播中文助手 - 本机模型服务（请保留此窗口）')
    prepare_environment()
    if args.diagnose:
        diagnose()
        return
    required_files()
    from server import Transcriber, load_token, make_handler
    from http.server import ThreadingHTTPServer
    token = load_token()
    state = health(token)
    if state and state.get('ok'):
        if not state.get('loaded'):
            raise RuntimeError('本机服务正在加载模型，请等待原窗口显示模型就绪后再双击。')
        target = DATA / 'extension'
        if not (target / 'manifest.json').is_file():
            raise RuntimeError('原服务尚未完成插件配置，请等待后重试。')
        open_browser(target)
        print('本机服务已在运行，已重新打开专用浏览器。')
        return
    transcriber = Transcriber('base', offline=True, model_path=MODEL)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', 8765), make_handler(token, transcriber))
    except OSError as error:
        raise RuntimeError('无法使用本机 8765 端口。请确认没有其他识别服务正在启动。') from error
    server.daemon_threads = True
    print('正在加载包内 Whisper base 多语言模型，无需下载。', flush=True)
    try:
        transcriber.load()
        # Check packaged VAD and audio libraries before calling the service ready.
        import av
        from faster_whisper.vad import get_vad_model
        get_vad_model()
        extension = deploy_extension(token)
        print('\n模型已就绪，正在打开专用 Chrome 并自动加载、配对插件。', flush=True)
        print('首次欢迎页显示“配对完成”后，即可打开普通网页视频（TikTok 等）。')
        print('播放并取消静音，按 Alt+Shift+Y 授权当前标签页音频。')
        print('音频本机识别；中文翻译需要联网。请保留此窗口，按 Ctrl+C 停止。\n', flush=True)
        open_browser(extension)
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n本机识别已停止。浏览器窗口可手动关闭。')
    except Exception as error:
        DATA.mkdir(parents=True, exist_ok=True)
        log = DATA / 'last-error.log'
        log.write_text(traceback.format_exc(), encoding='utf-8')
        print(f'\n启动失败：{error}\n诊断信息：{log}\n请将报错截图或该日志发给开发者。', flush=True)
        sys.exit(1)
