# translation tik · 网页口播中文助手

在 Chrome / Edge 侧边栏中，把正在播放的网页口播转成原文与简体中文，并复制或导出 TXT、SRT、JSON。适合查看外语教程、研究视频表达和整理口播内容。

当前版本 **0.8.0**。浏览器扩展需手动加载，尚未发布到扩展商店。

## 让 AI 带你完成首次配置

下载并进入本仓库后，用 Python 3 安装本项目的配置引导 Skill：

```bash
python3 scripts/install_skills.py
```

Windows 若没有 `python3` 命令，可使用 `py -3 scripts/install_skills.py`。

安装器使用 Python 标准库，不会安装运行依赖、启动服务、下载模型或配置账号。它会安装配置引导 Skill，以及本仓库附带的业务 Skill（如果有）；默认目录为 `$CODEX_HOME/skills`，未设置时为 `~/.codex/skills`。更新同名 Skill 前，会把原目录备份到同级 `skill-backups/`。可用 `--dry-run` 查看计划，或用 `--skills-dir ~/.agents/skills` 指定目录。

重新打开 Codex 任务后输入：

```text
$web-video-translator-setup
请检查我的环境，并带我配置这个项目，直到完成一个最小可用测试。
```

引导会识别系统、检查前置条件、使用你自己的账号与本地配置，并说明哪些步骤已验证、哪些仍待授权或实测。下载仓库不会自动执行 Skill；需要先安装并在支持 Skills 的助手中调用。安装器在本地 Skill 内记录克隆路径，之后请保留该目录；移动源码后重新运行安装器即可更新路径。

也可手动复制 [`setup-skills/web-video-translator-setup`](setup-skills/web-video-translator-setup/SKILL.md) 整个目录到支持的 Skills 路径，再告诉助手源码位置。不使用 AI 助手的用户，可以继续按下面的手动步骤操作。

## 它如何工作

| 视频情况 | 处理方式 | 是否需要本机识别服务 |
|---|---|---|
| TikTok 页面能读取到原始字幕 | 提取字幕并翻译 | 否 |
| 无字幕视频、普通网页音频或内嵌播放器 | 授权标签页音频 → 本机 Whisper 识别 → 翻译 | 是 |

音频识别使用 `faster-whisper`，默认 `small` 多语言模型。口播识别把声音发送到本机 `127.0.0.1:8765`。默认在线翻译会把文字发送给 Google 的非官方免 Key 接口，也可选自配的 DeepSeek 兼容服务。可在设置里关闭翻译，仅提取原文。BGM 识别是单独的可选功能，点击识别时会向 AudD 上传短音频片段。

## 安装前准备

- Chrome / Edge 116 或更高版本。
- 无字幕音频识别：Python 3.10–3.13，建议 3.12。
- 首次安装依赖和下载模型需要联网；`small` 模型约 0.5 GB。缓存后可离线识别，在线翻译仍需要网络。
- 仓库源码不含 Python 运行环境、模型或 Windows 完整便携包。Windows 打包脚本保存在仓库中，但尚未在 Windows 实机验收。

## 1. 下载与加载插件

```bash
git clone https://github.com/Guan-XX003/web-video-translator.git
```

也可以使用 GitHub 的 **Code → Download ZIP**，然后完整解压。

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 启用“开发者模式”，选择“加载已解压的扩展程序”。
3. 选择仓库中的 **`extension` 文件夹**，确认里面有 `manifest.json`。
4. 在浏览器工具栏固定插件，刷新已经打开的视频网页。

## 2. 启动本机识别服务

### macOS

进入下载的仓库目录，双击 `启动本机识别.command`；如果无法双击，在终端运行：

```bash
cd web-video-translator
chmod +x 启动本机识别.command
./启动本机识别.command
```

### Windows

安装上述版本的 Python，再双击仓库根目录的 **`启动本机识别.bat`**。首次运行会安装依赖并下载模型。Windows 脚本与便携包构建流程尚未在 Windows 实机完整验证。

### 配对

保留启动窗口，将其中显示的“配对码”填入插件侧边栏 **设置 → 本机服务配对码**，保存并点击“检测连接”。配对码只用于本机服务，请勿公开。

## 3. 识别与导出

1. 打开一个能正常播放的视频网页。
2. 点击插件图标，或使用 `Alt+Shift+Y`（Mac 通常为 `Option+Shift+Y`），由你授权捕获当前标签页音频。
3. 播放并取消静音，约每 7 秒提交一批音频，识别与翻译还需要额外时间；想得到完整口播，请授权后从头播放。
4. 在“双语 / 中文 / 原文”之间切换，复制文案或导出 TXT、SRT、JSON。
5. 用“停止音频”结束捕获。刷新、完整跳转或跨站后，需要重新授权。

已有字幕可直接读取；音频路线只能识别实际播放且有声音的部分。快捷键冲突时，在浏览器扩展快捷键设置里修改。

## 可选：上下文翻译、口播改写和 BGM

- **DeepSeek 翻译 / 改写**：在设置中填写自己的 Key、模型和可信 HTTPS Chat Completions 地址。默认地址为 `https://api.deepseek.com/chat/completions`；以 `/v1` 结尾的自定义地址会自动补全。自定义域名需要浏览器授权。原文、上下文、术语表和改写提示词会发送给所选服务，费用由你承担。
- **中文口播改写**：在“改写”页选择或管理提示词预设，生成后可展开阅读、复制或导出 TXT / JSON。改写稿与原文、逐句翻译分开保存，不提供 SRT。自动改写可能随原文更新产生多次请求；建议完整识别后手动生成。
- **识别 BGM**：在设置中保存自己的 AudD API Token 并授权 `api.audd.io`，播放至少 5 秒后点击“识别 BGM”。最近约 12 秒声音只在内存滚动缓存，只有点击时才上传给 AudD；片段也可能包含口播和其他声音。服务需要账号与额度，匹配结果应自行核对。

Key 与 Token 保存在本机扩展存储中，不包含在源码或分发包。不要把凭据发到 Issue 中。

## 常见问题

| 问题 | 处理 |
|---|---|
| 无法连接本机服务 | 保留启动窗口，检查配对码并重新检测连接 |
| 视频在播放但没出现文字 | 检查标签页音频授权、静音状态，等待一个识别片段 |
| 有原文但没有中文 | 检查网络或稍后重试；非官方翻译接口可能限流 |
| 时间戳不能跳转 | 跨域内嵌播放器可能只显示录音经过时间 |
| 文字识别不准 | 避免多个播放器同时发声；尝试更大模型或正常播放速度 |
| 处理队列满 | 暂停视频，等待本机服务完成积压任务 |

可选模型：`small` 为默认；`base` 与 `tiny` 更轻，适合较慢电脑。macOS 示例：

```bash
./启动本机识别.command --model base
# 模型已缓存后，禁止再次联网下载模型
./启动本机识别.command --offline
```

## 隐私和限制

最近 20 条处理结果保存在浏览器本地，可在设置里清空。不申请麦克风权限；标签页里同时播放的广告或其他声音也会被捕获。

不支持浏览器内部页面和 `file://` 文件；DRM 或受保护播放器可能不可用。普通 HTTP/HTTPS 页面可尝试通用音频路线，但未逐站适配所有播放器。每次只识别一个已授权标签页；识别、翻译和 SRT 时间轴均需自行校对。

## 开发

前端无需构建，`extension/` 可直接加载。开发检查需要 Node.js 和 Python：

```bash
npm test
npm run check
# 构建源码扩展包，不会生成含模型的 Windows 完整包
npm run package
```

`server/` 为本机服务，`tests/` 为自动检查，`windows/` 与 `scripts/package_windows.py` 为便携包构建材料。Windows 打包脚本需要另行准备其引用的运行时、依赖与模型缓存，不能在全新机器上直接生成完整包。

[验证记录](VALIDATION.md) · [技术参考](RESEARCH.md) · [许可证](LICENSE) · [反馈问题](https://github.com/Guan-XX003/web-video-translator/issues)
