#!/usr/bin/env python3
"""Loopback-only Whisper bridge. Audio never leaves this process."""
import argparse
import hmac
import io
import json
import os
import re
import secrets
import struct
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

MAX_AUDIO_BYTES = 4 * 1024 * 1024
LANGUAGES = {'auto', 'en', 'es', 'pt', 'ja', 'ko', 'zh', 'fr', 'de', 'id', 'th', 'vi', 'ar'}
MODEL_IDS = {'tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo'}


def token_file():
    directory = Path(os.environ.get('TK_CONFIG_DIR', Path.home() / '.tiktok-transcript-zh'))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    return directory / 'token'


def load_token():
    path = token_file()
    if path.exists():
        return path.read_text(encoding='utf-8').strip()
    token = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(token)
    return token


def validate_wav(body):
    try:
        with wave.open(io.BytesIO(body), 'rb') as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000 or audio.getcomptype() != 'NONE':
                raise ValueError('仅接受 16 kHz、单声道、16 位 PCM WAV')
            duration = audio.getnframes() / 16000
            if not 0.25 <= duration <= 35:
                raise ValueError('音频长度必须为 0.25–35 秒')
            pcm = audio.readframes(audio.getnframes())
            if len(pcm) != audio.getnframes() * 2:
                raise ValueError('WAV 音频数据不完整')
            # Silence should not trigger Whisper hallucinations.
            values = struct.unpack('<' + 'h' * (len(pcm) // 2), pcm)
            energy = sum(v * v for v in values) / max(1, len(values))
            return duration, energy ** 0.5 / 32768
    except (wave.Error, EOFError) as error:
        raise ValueError('无效 WAV 文件') from error


class Transcriber:
    def __init__(self, model_name, download_root=None, offline=False, model_path=None):
        self.name = model_name
        self.download_root = download_root
        self.offline = offline
        self.model_path = model_path
        self.model = None
        self.lock = threading.Lock()

    def load(self):
        if self.model is None:
            from faster_whisper import WhisperModel
            print(f'正在从本机加载 {self.name} 模型…' if self.offline else f'正在加载 {self.name} 模型；首次使用需要下载，请保持网络连接。', flush=True)
            self.model = WhisperModel(str(self.model_path or self.name), device='cpu', compute_type='int8', cpu_threads=max(2, min(os.cpu_count() or 4, 8)), download_root=self.download_root, local_files_only=self.offline)
            print('模型已就绪。音频在本机识别。', flush=True)

    def transcribe(self, body, language):
        _, rms = validate_wav(body)
        if rms < 0.001:
            return {'segments': [], 'language': language, 'local': True}
        # Reject concurrent requests instead of accumulating unbounded jobs.
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError('本机模型忙，请稍后重播此片段')
        try:
            self.load()
            import numpy as np
            with wave.open(io.BytesIO(body), 'rb') as audio:
                samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
            segments, info = self.model.transcribe(samples, language=None if language == 'auto' else language, task='transcribe', beam_size=3, vad_filter=True, condition_on_previous_text=False)
            result = [{'start': s.start, 'end': s.end, 'text': s.text.strip()} for s in segments if s.text.strip() and s.no_speech_prob < 0.8]
            return {'segments': result, 'language': info.language, 'local': True}
        finally:
            self.lock.release()


def make_handler(token, transcriber):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'TikTokLocalASR/0.1'

        def allowed_origin(self):
            origin = self.headers.get('Origin', '')
            return not origin or bool(re.fullmatch(r'chrome-extension://[a-p]{32}', origin))

        def cors(self):
            origin = self.headers.get('Origin', '')
            if origin and self.allowed_origin():
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')

        def reply(self, status, data):
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            host = self.headers.get('Host', '')
            if host not in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}:
                self.reply(403, {'error': 'Host 不受信任'})
                return False
            if not self.allowed_origin():
                self.reply(403, {'error': '仅允许浏览器插件访问'})
                return False
            if not hmac.compare_digest(self.headers.get('X-TK-Token', ''), token):
                self.reply(401, {'error': '配对码不正确，请从本机服务启动窗口复制'})
                return False
            return True

        def do_OPTIONS(self):
            if not self.allowed_origin():
                self.reply(403, {'error': '来源不受信任'})
                return
            self.send_response(204)
            self.cors()
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-TK-Token')
            self.end_headers()

        def do_GET(self):
            if not self.authorized():
                return
            if urlsplit(self.path).path == '/health':
                self.reply(200, {'ok': True, 'model': transcriber.name, 'loaded': transcriber.model is not None, 'local': True})
            else:
                self.reply(404, {'error': '接口不存在'})

        def do_POST(self):
            if not self.authorized():
                return
            parts = urlsplit(self.path)
            if parts.path != '/transcribe':
                self.reply(404, {'error': '接口不存在'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            if not 44 < length <= MAX_AUDIO_BYTES:
                self.reply(413, {'error': '音频文件大小无效，最大 4 MB'})
                return
            if self.headers.get('Content-Type', '').split(';')[0] != 'audio/wav':
                self.reply(415, {'error': '仅接受 audio/wav'})
                return
            language = parse_qs(parts.query).get('language', ['auto'])[0]
            if language not in LANGUAGES:
                self.reply(400, {'error': '不支持的口播语言'})
                return
            try:
                self.connection.settimeout(30)
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError('音频上传不完整')
                result = transcriber.transcribe(body, language)
                self.reply(200, result)
            except ValueError as error:
                self.reply(400, {'error': str(error)})
            except BlockingIOError as error:
                self.reply(429, {'error': str(error)})
            except Exception as error:
                # Do not echo local paths, credentials or raw audio into browser errors.
                print(f'识别失败：{type(error).__name__}: {error}', flush=True)
                self.reply(503, {'error': '模型加载或识别失败，请查看本机启动窗口；首次使用需要下载模型，离线使用请先完成下载'})

        def log_message(self, fmt, *args):
            # Request paths contain language only; neither token nor audio is logged.
            print(f'{self.log_date_time_string()} {fmt % args}', flush=True)

    return Handler


def main():
    parser = argparse.ArgumentParser(description='TikTok 口播中文助手 · 本机离线识别服务')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--model', choices=sorted(MODEL_IDS), default=os.environ.get('TK_WHISPER_MODEL', 'small'))
    parser.add_argument('--download-root', default=None)
    parser.add_argument('--model-path', type=Path, help='读取便携包内的模型目录')
    parser.add_argument('--offline', action='store_true', help='只读取已缓存的模型，禁止模型下载')
    parser.add_argument('--warmup', action='store_true', help='启动时下载并预加载模型')
    args = parser.parse_args()
    token = load_token()
    if args.model_path and not all((args.model_path / name).is_file() for name in ('model.bin', 'config.json', 'tokenizer.json')):
        parser.error('本机模型目录不完整，请重新解压便携包')
    transcriber = Transcriber(args.model, args.download_root, args.offline, args.model_path)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(token, transcriber))
    server.daemon_threads = True
    print(f'\nTikTok 本机识别服务：http://127.0.0.1:{args.port}\n模型：{args.model}（CPU / int8）\n配对码：{token}\n\n请将配对码粘贴到插件设置中。保留此窗口；按 Ctrl+C 退出。\n', flush=True)
    if args.warmup:
        try:
            transcriber.load()
        except Exception as error:
            print(f'模型预加载失败：{error}。服务会保留，下一次请求可重试。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n本机识别服务已停止。', flush=True)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
