# AIMC — AI Minecraft Companion

AI Minecraft 队友系统。基于 LLM 驱动的智能体，具备结构化意图管道、安全护盾和语音就绪架构。默认语言：中文。

```
DeepSeek V4 → AgentOutput JSON → Zod 校验 → SafetyGuard → ActionDispatcher → Mineflayer
```

## 特性

- **新 AgentCore 管道** — 文字聊天经 Zod 校验 + 安全护盾后执行，LLM 输出不可直接控制 Minecraft
- **双管道共存** — 旧 Mindcraft `!stop`、`!go` 等命令与新管道同时运行
- **30 种动作类型** — 移动、挖掘、战斗、背包管理、社交、建造等
- **安全约束** — 自动检测岩浆/虚空/坠落危险，低血量自动逃跑，禁止破坏玩家建筑
- **语音就绪** — Whisper.cpp STT + Edge-TTS 管道已编写，待接入 Electron UI
- **记忆系统** — SQLite + 混合检索，待接入 Electron
- **人格引擎** — 4 种预设（同伴/建造者/探索者/守卫），待接入 Electron

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Minecraft Java Edition](https://www.minecraft.net/) 1.20.x
- 一个 LLM API Key（支持 DeepSeek / OpenAI / Anthropic / Google 等）

### 安装与运行

```bash
git clone git@github.com:zhongli369/AIMC.git
cd AIMC
npm install
npm run build        # 编译 TypeScript（dist/ 自带，源码修改后需要）
npm run electron     # 启动 Electron 启动器
```

### 使用步骤

1. 打开 Minecraft → 进入世界 → 按 `Esc` → 对局域网开放 → 记下端口号
2. 在 AIMC 启动器中填入 API Key、服务器 IP 和端口
3. 点击 **Start Bot** — 机器人加入游戏
4. 在底部输入框打字发送消息，AI 队友用中文回复

### 打包为独立版

```bash
npx electron-builder --dir
# 输出: release/win-unpacked/ — 复制到任意位置运行 AIMC Launcher.exe
```

## 项目结构

```
├── electron/           ← Electron 启动器 + 桥接
│   ├── main.cjs        ← 主进程（窗口、IPC、Bot 生命周期）
│   ├── preload.cjs     ← contextBridge API
│   ├── legacy-bridge.cjs ← 旧 Mindcraft + 新 AgentCore 双管道桥接
│   └── renderer/       ← UI（HTML/CSS/JS）
├── src/
│   ├── runtime/        ← Zod 校验 + 安全护盾 + 动作分发器
│   ├── agent/          ← AgentCore（think 循环）
│   ├── llm/            ← DeepSeek V4 流式客户端 + 提示词（中文）
│   ├── voice/          ← Whisper.cpp + Edge-TTS 管道
│   ├── memory/         ← SQLite + 混合检索记忆系统
│   ├── personality/    ← 人格 + 情绪 + 社交引擎
│   ├── behavior/       ← 主动引擎 + 任务规划器
│   ├── legacy/         ← 原 Mindcraft 代码（保留不动）
│   └── ...
└── patches/            ← mineflayer 等依赖补丁
```

## 借鉴与致谢

本项目从以下开源项目大量借鉴代码和设计：

| 项目 | 说明 |
|------|------|
| [**Mindcraft**](https://github.com/mindcraft-bots/mindcraft) | 核心架构来源 — `src/legacy/` 保留了完整原版代码 |
| [**Mineflayer**](https://github.com/PrismarineJS/mineflayer) | Minecraft Bot API — 所有游戏交互的底层依赖 |
| [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) | 寻路算法 |
| [mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp) | PVP 战斗模块 |
| [mineflayer-collectblock](https://github.com/PrismarineJS/mineflayer-collectblock) | 方块采集 |
| [mineflayer-armor-manager](https://github.com/PrismarineJS/mineflayer-armor-manager) | 装备管理 |
| [mineflayer-auto-eat](https://github.com/PrismarineJS/mineflayer-auto-eat) | 自动进食 |
| [minecraft-data](https://github.com/PrismarineJS/minecraft-data) | Minecraft 数据字典 |
| [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) | Web 地图查看器 |
| [**Zod**](https://github.com/colinhacks/zod) | TypeScript 运行时校验 — 所有 LLM 输出的守门人 |
| [**Electron**](https://github.com/electron/electron) | 桌面应用框架 |
| [DeepSeek API](https://platform.deepseek.com/) | 默认 LLM 后端 |
| [Edge-TTS](https://github.com/rany2/edge-tts) | 微软 Edge 文字转语音 |
| [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) | 本地语音识别 |

## 许可证

本项目基于原 Mindcraft 项目修改。原项目许可证见 `src/legacy/` 目录。
