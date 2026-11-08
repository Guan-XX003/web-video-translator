---
name: web-video-translator-setup
description: "Set up translation tik / Web Video Translator from this repository for a new user. Use for first installation, local transcription connection issues, browser loading, or optional translation, rewriting and BGM configuration."
---

# 口播翻译插件配置引导

Set up translation tik / Web Video Translator from this repository for a new user. Use for first installation, local transcription connection issues, browser loading, or optional translation, rewriting and BGM configuration.

## Locate and inspect

Read installed `references/installation.json` if present. Verify `repository_path` contains `onboarding.json`, `extension/manifest.json` and `server/server.py`; if the clone moved, use its current location. Read the current README, manifest and launcher before giving version-specific instructions. Do not assume an old base-model or 15-second version: the current source is 0.8.0, small model, about 7-second audio batches plus processing time.

## Setup route

1. Identify OS and Chrome/Edge version; reuse known values. Browser 116+ is required. Loading the unpacked `extension/` does not need Node or a frontend build. For no-caption audio recognition use Python 3.10–3.13, preferably 3.12. Explain that first startup installs dependencies and downloads small (about 0.5 GB); honor offline or bandwidth constraints before starting a download.
2. Guide the user to `chrome://extensions` or `edge://extensions`, developer mode, and “load unpacked” selecting `extension/`, then refresh the video tab. This repository contains source, not an extension-store release or a downloadable full Windows package. Windows scripts are not yet fully tested on Windows hardware.
3. Start `启动本机识别.command` on macOS or `启动本机识别.bat` on Windows from the clone. Keep the process running and report errors without exposing pairing tokens. For an existing listener on 127.0.0.1:8765, diagnose whether it belongs to this application instead of killing arbitrary processes.
4. Have the user enter the launcher pairing code in the extension settings locally and select “检测连接”. Do not ask them to send the code in chat. `/health` requires the local X-TK-Token; its 401 without authentication does not mean the server is broken. Validate via the settings UI or a private local request that does not print the token.
5. Test with one video the user can normally play. Clicking the extension icon or its shortcut and granting tab audio are user gestures. Start playback, unmute and confirm original transcription, then export a short result. Refresh/navigation requires reauthorization. Distinguish readable TikTok caption extraction (no local ASR required) from audio capture (local service required).

## Optional services

Basic local transcription needs no paid API. For online translation, explain that Google mode sends text to an unofficial service; it can fail or be turned off. DeepSeek-compatible translation/rewriting needs the user's own Key/model/HTTPS endpoint in extension settings, and sends text/context/presets to that endpoint. AudD BGM identification needs the user's Token and sends a short audio sample only when invoked. Keys are entered locally, never included in distributed files or Issue logs. Configure only the optional services requested; a saved key is not permission to make a chargeable test call or enable automatic rewriting.

Finish with installed version, local connection test, whether capture/export worked, enabled external services and the next user action. Never say “fully offline” if translation or BGM is enabled, or “verified” if only code/dependencies were checked.
