# GitHub 调研与实现选择

调研日期：2026-10-22。通过 GitHub 仓库搜索与 README / 许可证 / 源码检查确认以下项目。

| 项目 | 许可证（调研时） | 相关能力 | 本项目取舍 |
| --- | --- | --- | --- |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | Unlicense（主体） | TikTok 的 `video.subtitleInfos`、`cla_info.caption_infos`、creator caption JSON | 参考实际字段与格式，未复制源码。浏览器读取已登录页面数据，无需额外下载完整视频 |
| [ainoya/chrome-extension-web-transcriptor-ai](https://github.com/ainoya/chrome-extension-web-transcriptor-ai) | MIT | TabCapture + Transformers.js 在浏览器本地转录 | 确认标签页音频捕获路线；此版将 Whisper 放在 Python 本机服务，避开扩展 WebGPU / WASM 兼容与构建复杂度。未复制代码或图标 |
| [botbahlul/crx-live-translate](https://github.com/botbahlul/crx-live-translate) | MIT | 直播识别与免 Key 在线翻译 | 当前工作区已有 0.3.5 副本；其 README 要求 CORS 插件和虚拟音频设备，不适合作为这个需求的默认安装方案。未改动原目录 |
| [tantara/transformers.js-chrome](https://github.com/tantara/transformers.js-chrome) | Apache-2.0 | 扩展内本地模型运行示例 | 纯浏览器离线版后续可参考，此版未引入 |
| [Felix198902/ai-tiktok-analyzer-pro](https://github.com/Felix198902/ai-tiktok-analyzer-pro) | GitHub 标记为 Other / NOASSERTION | README 描述 TikTok 字幕、评论与分析功能 | 许可证不明确，且有 Cloudflare 后端依赖；未基于它二次分发 |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | CTranslate2 Whisper 多语言本机推理 | 本项目实际使用的语音识别依赖，锁定 1.2.1；模型从 Hugging Face 首次下载 |

选择独立实现小型 Manifest V3 插件，并直接依赖成熟的本机识别库。无需沿用旧插件的音频路由和跨域方案，也避免混入与目标无关的评论采集、账号服务或商业后台。

真实 TikTok 样例：`https://www.tiktok.com/@hankgreen1/video/7047596209028074758`。开发测试读取了网页 `__UNIVERSAL_DATA_FOR_REHYDRATION__`，从 `subtitleInfos` 得到 WebVTT，并成功解析 12 句。签名字幕 URL 不写入源码或交付包，因为会过期。
