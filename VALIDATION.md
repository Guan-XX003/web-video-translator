# 验证记录

日期：2026-10-22。平台：Apple Silicon macOS；Python 3.12；Playwright Chromium 151；扩展 Manifest V3。

## 自动测试

`node --test tests/core.test.cjs`：7 项通过。

- WebVTT 多行、时间设置、标记清理与字符实体。
- SRT 与 TikTok creator-caption JSON 毫秒时间轴。
- 精确关联视频 ID、拒绝非 TikTok 字幕域名。
- 可见正在播放的视频优先，屏幕外视频不会获选。
- 中文 SRT 时间轴与原文回退。
- 降采样与 16 kHz PCM WAV 文件头、长度与采样值。
- 连续碎片字幕 / ASR 片段合并为完整语句，明显时间间隙不合并。

`python3 -m unittest discover -s tests -p 'test_*.py'`：4 组通过，覆盖健康检查、配对码、Origin / Host 校验、正常静音 WAV、非法格式 / 语言 / 长度及未知路由。

`node tests/check.cjs`：Manifest 资源引用、全部 JS 语法、没有全站 host 权限，通过。Mac 启动脚本通过 `zsh -n`。

## 真实 TikTok 字幕流程

从 `https://www.tiktok.com/@hankgreen1/video/7047596209028074758` 的真实网页加载扩展内容脚本。网页实际渲染出 video 元素；读取网页 JSON 内字幕元数据，从实际 TikTok CDN 下载 WebVTT。

12 条原始字幕，经语句合并后输出 5 组；Google 在线翻译成功。扩展 background 存储状态为「提取与翻译完成」，source 为「字幕」。不是预设文案，也没有模拟翻译接口。

## 本机识别与音频链路

- 在当前 Mac 安装 faster-whisper 1.2.1，下载并缓存 `base` 多语言模型。
- 使用 macOS 系统合成英文测试语音，长度约 8.9 秒。
- `Transcriber('base', offline=True)` 实际执行识别，约 2.2 秒完成；确认识别结果包含 `bedroom`。
- 实际 HTTP 请求 `POST /transcribe?language=en`：200，`local: true`；相同测试语音约 1.6 秒完成。
- 插件音频处理完整链路：将真实测试语音经 AudioContext / MediaStream 输入扩展音频处理代码，分段降采样 / WAV 编码，发送到本机真实 Whisper HTTP 服务，随后通过实际 Google 服务翻译，background 保存本机语音原文与中文。
- 合并断句后的实测输出包括完整的 `leave your phone outside the bedroom`，中文正确保留了「把手机放在卧室外面」的含义。
- 切换测试 TikTok 视频 ID 后，旧文案没有出现在新视频中。

之后追加了有界面浏览器验证：通过原生 `Option+Shift+Y` 快捷键触发插件 action，Chrome 确实显示「已分享标签页内容」，侧边栏显示「标签页音频已授权」。`tabCapture.getMediaStreamId` → 真实标签页音轨 → 真正 OFFSCREEN_DOCUMENT → 本机 HTTP Whisper → Google 翻译全部通过；此轮没有替换 `getUserMedia`。测试音频来自隔离测试页中的 MP4（含约 8.9 秒语音），测试页使用 TikTok 域名请求拦截，仅在临时浏览器配置中提供。切换到第二个视频 ID 后没有串入旧文案。

**边界**：真实线上 TikTok 已验证字幕流程；原生标签页音频捕获已验证受控视频页。没有声称对所有线上 TikTok 视频音轨做过捕获验证。

## 浏览器界面

Browser plugin / browser skill 在当前会话未提供，使用 Playwright 加载真实未打包扩展，隔离临时用户配置目录，不修改日常 Chrome / Edge 配置。

| 检查 | 结果 |
| --- | --- |
| 页面标题、非空界面 | 通过 |
| 前端运行时异常 | 未发现 pageerror；无框架错误浮层 |
| 双语 → 中文 → 原文视图 | 通过 |
| 系统剪贴板复制 | 通过，出现成功提示 |
| SRT 下载与中文文件内容 | 通过 |
| 设置保存 | 通过 |
| 最近文案选择 / 回到当前视频 / 清空 | 通过 |
| 390×900 主界面、320×760 设置 | 通过，无横向溢出 |
| 实际截图检查 | 检查了字体、配色、间距、控件、文案、正文滚动与底部按钮 |

修正项：未提供视频描述时的误导性空状态、设置页与主界面混排、底部导出按钮遮挡正文、分段断句导致的翻译歧义、扩展以普通标签页打开时的消息权限判定。

测试截图保存在开发机 `/tmp/tk-panel-bilingual.png`、`/tmp/tk-panel-live-translated.png`、`/tmp/tk-panel-settings-320.png`，未将示例截图或合成语音当成生产数据打入安装包。

## 尚未验证

- Edge、Windows 的实机运行；当前使用标准 Chromium MV3 API，提供 Windows 启动脚本。
- 线上 TikTok 各种视频音轨的捕获表现；原生授权与真实标签页捕获已在受控测试页验证。
- 所有国家 / 登录状态 / 推荐流版式 / TikTok 实验版本。
- 各种语言、口音、背景音乐、长视频的识别准确率；base 模型不是逐字准确保证。
- Google 非官方免费翻译接口的长期稳定性与地区可达性。


## 0.1.1 用户指定视频回归

视频：`https://www.tiktok.com/@iahmadkhaled/video/7465431281766092050`。末条字幕结束时间 42.560 秒；内容为阿拉伯语 iPhone 主屏幕美化教程。

发现该视频同时提供 `Source: ASR` 的阿拉伯语原始字幕，以及 `Source: MT` 的英 / 中文机器译文。修复字幕元数据的 Source 保留和排序，先读取原始 ASR，避免从网页显示的中文或英文译文再次翻译。同时修复 VTT 小数秒不足三位的解析。

真实浏览器再次加载视频后，插件确认 `captionLanguage: ara-SA`、`captionSource: ASR`，所有段落保留阿拉伯语原文并有中文译文。自动翻译成功，但仍会将手机界面词误译为“添加性能”，不宣称术语准确。交付测试视频结果中的 `中文整理稿.txt` 是按操作语境校订的版本，与插件自动译文分别标注。

新增来源标记与小数时间解析测试，总计 8 项 Node 测试通过。


## 0.2.0 界面回归

按用户确认的白底 + 石墨黑 + 少量荧光青方向实现。设计规则见 `design/UI-0.2.md`。生成式概念图已发起，但持续超过 20 分钟未返回，停止等待；本次视觉验收依据用户确认的风格及文字设计规格，没有把未返回的图冒称为已验收概念图。

实际加载未打包扩展，重新打开用户指定的 TikTok 线上地址，内容脚本、CDN 字幕读取、Google 翻译、侧栏渲染完整通过：阿拉伯语 ASR，3 段原文与译文。截图直接来自真实扩展页面，无图片替代 UI，无人工改稿替代自动译文。

浏览器验证使用 Playwright Chromium 隔离配置，原因是当前 IAB 不支持加载该 MV3 扩展。另通过原生 Chrome 窗口及快捷键确认真实侧栏正常打开；TikTok 后续出现登录/年龄界面，没有填写或绕过。

- 400×900 主界面：正文阅读区高 319px；320×760 主界面：242px。均无横向溢出、底栏覆盖。
- 实际点击双语/中文/原文，左右键切换标签；复制中文与剪贴板成功提示、SRT 下载内容、配对码设置保存、历史选择与清空通过。
- 折叠说明可展开，音频状态可见；文案可滚动到末段。
- 查看了最终双语、中文、320px、设置、空状态截图，确认标题、正文、RTL 原文、时间戳、图标、按钮及滚动排版。前端无 pageerror。
- 8 项 Node 测试、4 组 Python 测试、Manifest 引用及全部 JS 语法检查通过。

### 视觉核对记录

| 核对点 | 规格与最终实现 | 修正或适配 |
| --- | --- | --- |
| 颜色 | #fff 底、#182020 主字/主按钮、#56ebd5 选中线、#f0fcf9 播放段 | 去除旧版大面积青绿主按钮 |
| 字体 | 18px 品牌、21px 阅读标题、15px 中文 / 1.85 行高、12px 原文、10px 等宽时间 | 320px 正文适配为 14px |
| 布局 | 顶部信息、标签、历史、开放段落、固定底栏 | 第二轮压缩顶部垂直间距，正文更早进入首屏 |
| 图标 | 一致轮廓线设置、跳转、刷新、复制、下载 | 保留代码原生 SVG，没有截图按钮 |
| 内容 | 用户实际视频与真实处理状态；未引入指标或营销区块 | 阿拉伯语 dir=auto，源语言由元数据生成 |
| 交互 | 选中下划线、播放段青线、设置独立页、折叠帮助 | 设置时隐藏无关底部操作；历史不标记当前播放 |

首屏文案对照：保留“口播中文助手”“双语/中文/原文”“最近文案”“口播文案”“导出”；采用规格中的品牌副标题和 CURRENT VIDEO 标签。后台状态按真实结果显示；样例文字按真实结果替换，为有意适配。实际截图已用 view_image 检查。生成图未返回，因此不宣称完成图片逐像素还原；其余没有已知阻止交付的布局问题。


## 0.3.0 Windows 便携包

- 内置 CPython 3.12.10 Windows x64 嵌入版；Windows wheel 依赖从 PyPI 下载。对 Windows 环境条件重新评估元数据，补入 macOS 解析时不会自动选择的 colorama。版本及 SHA-256 记录在包内 SOURCES.json 和 requirements-lock.txt。
- 内置 Google 官方 Chrome for Testing win64（版本见 SOURCES.json），使用独立 user-data-dir，通过 load-extension 加载本地扩展；未使用远程调试端口、禁用安全功能或改注册表策略。普通 Chrome 不承诺支持此加载方式。
- 包含 Microsoft App-local C++ 库，并附官方 vc_redist.x64.exe 用于修复；Python 自带 vcruntime140/140_1。检查 143 个 Python/推理相关 PE 文件全部为 AMD64；导入项除包内 DLL 和 Windows 系统库外无缺失；检查包内 DLL 的静态导入符号均能解析。
- 打包 Whisper base 多语言 model.bin、config、tokenizer、vocabulary；实体复制而非 macOS 缓存符号链接。内置 Silero VAD ONNX 及其推理依赖。将网络 socket 连接强制拒绝后，用包内测试 WAV 实际识别，输出含 bedroom，确认没有模型/Tokenizer/VAD 网络下载。此项推理在 macOS 执行，未把它当成 Windows 二进制执行结果。
- 自动配对仅写入目标电脑 LocalAppData 下的私有扩展副本；可分发 ZIP 的 portable-config.js 为空。不把开发机真实配对码、浏览器配置、用户视频或日常登录资料打入包内。
- 在 Chromium 中实际触发首次安装欢迎页，自动保存配对码，向 127.0.0.1 的真实健康接口发起带配对码请求并显示就绪。初轮有请求拦截的 UI 检查，随后用真实本机 HTTP 服务重新验证，无接口拦截。重启配置保留和配对码刷新通过。
- 新增启动器测试：中文/空格路径以 argv 安全传参、独立 Chrome 配置、配对只写入运行时副本、令牌更新、缺失文件报错；本机服务新增 model-path 与 offline 传递检查。Python 共 8 项测试，Node 8 项测试，全部通过。
- 限制：没有 Windows 实机或 Windows VM，未执行 Windows python.exe、Chrome.exe 与 .bat。不能宣称 Windows 上已经端到端实测。提供运行诊断.bat 供目标电脑检查 DLL 导入与离线推理。Chrome 音频授权仍需用户明确点击插件图标/快捷键。


## 0.4.0 通用网页音视频（2026-10-23）

在 Apple Silicon macOS / Playwright Chromium 151 的隔离配置中加载真实 MV3 扩展，使用 CUA 原生 Option+Shift+Y 触发 action。无浏览器扩展测试专用 skill/plugin 的可用入口，因此使用 Playwright 验证内容和界面，CUA 负责原生快捷键授权。

- 普通 HTTP 网页 video：播放约 8.9 秒的本机合成英语 MP4。真实 tabCapture → offscreen getUserMedia → 16 kHz WAV → 本机 Whisper base → 实际 Google 在线翻译通过，没有替换 getUserMedia 或模拟识别 / 翻译接口。识别包含 bedroom；两段原文及中文保存。time 使用媒体进度。
- 跨域内嵌播放器：顶层 127.0.0.1:8123，iframe 127.0.0.1:8124。插件未取得 iframe DOM 权限，仍从实际标签页音轨识别合成语音并翻译。timeline 为 capture，时间基于录音经过时长，跳转按钮禁用；与上一网页记录 ID 不同。
- 完整页面导航后 captureTab 清空；重新原生快捷键授权后恢复识别。点击停止音频后确认 captureTab 清空。
- 中文视图、系统复制成功提示、SRT 实际下载 / 时间轴、400×900 和 320×760 截图及无横向溢出通过。检查实际截图中的正文排版、状态、时间戳和固定底栏。pageerror 为空。
- 真实线上回归：用户指定 TikTok 视频 7465431281766092050 仍以 ara-SA 原始字幕提取，3 段有中文译文，状态 done。
- Node 共 12 项测试通过：新增 HTTP/HTTPS / TikTok 域名判定、媒体暂停 / seek / SPA 与来源隔离、iframe 录音时间 / 重新授权重置、未授权 / 其他标签页 / 子框架报告拒绝及导航释放捕获。Python 8 项测试、Manifest 引用和全部 JS 语法通过。
- 权限使用 activeTab + scripting 临时注入；未添加全站常驻 host 权限。TikTok 原有内容脚本保留。

此轮不是对 YouTube、B 站、所有素材库或 DRM 平台的逐站验证。内部页、file:// 不支持；受保护视频可能没有音轨可捕获；无法访问媒体进度时不保证时间戳对应视频时间。Windows 包在 macOS 组装，尚无 Windows 实机 / VM 运行验证。
