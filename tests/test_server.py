import importlib.util
import io
import json
import threading
import unittest
import urllib.error
import urllib.request
import wave
import sys
import types
from unittest.mock import patch, Mock
from http.server import ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'server/server.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def wav(rate=16000, seconds=1):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b'\x00\x00' * int(rate * seconds))
    return stream.getvalue()


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = bridge.Transcriber('base')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.make_handler('test-token', cls.model))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def request(self, path, body=None, token='test-token', origin=None, host=None):
        headers = {'X-TK-Token': token, 'Content-Type': 'audio/wav'}
        if origin: headers['Origin'] = origin
        if host: headers['Host'] = host
        request = urllib.request.Request(self.base + path, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=5) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)

    def test_health_and_pairing(self):
        self.assertEqual(self.request('/health')[0], 200)
        self.assertEqual(self.request('/health', token='wrong')[0], 401)
        self.assertFalse(self.request('/health')[1]['loaded'])

    def test_untrusted_web_origin_and_dns_rebinding(self):
        self.assertEqual(self.request('/health', origin='https://evil.test')[0], 403)
        self.assertEqual(self.request('/health', host='evil.test')[0], 403)
        self.assertEqual(self.request('/health', origin='chrome-extension://' + 'a' * 32)[0], 200)

    def test_audio_validation_and_silence_without_loading_model(self):
        status, data = self.request('/transcribe?language=en', wav())
        self.assertEqual(status, 200); self.assertEqual(data['segments'], [])
        self.assertEqual(self.request('/transcribe', wav(rate=8000))[0], 400)
        self.assertEqual(self.request('/transcribe', b'not wav' * 30)[0], 400)
        self.assertEqual(self.request('/transcribe?language=invalid', wav())[0], 400)
        self.assertEqual(self.request('/transcribe', wav(seconds=36))[0], 400)

    def test_routes(self):
        self.assertEqual(self.request('/unknown')[0], 404)
        self.assertEqual(self.request('/unknown', wav())[0], 404)

    def test_portable_model_path_and_offline_are_forwarded(self):
        constructor = Mock(return_value=object())
        fake = types.SimpleNamespace(WhisperModel=constructor)
        with patch.dict(sys.modules, {'faster_whisper': fake}):
            model = bridge.Transcriber('base', offline=True, model_path=Path('/portable/models/base'))
            model.load()
            model.load()
        self.assertEqual(constructor.call_count, 1)
        self.assertEqual(constructor.call_args.args[0], '/portable/models/base')
        self.assertTrue(constructor.call_args.kwargs['local_files_only'])


if __name__ == '__main__': unittest.main()
