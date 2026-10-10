# AIMC — AI Minecraft Companion

AI Minecraft 队友系统。基于 LLM 驱动的智能体，具备结构化意图管道、安全护盾和语音交互。默认语言：中文。

```
User Input / Proactive Tick / Voice Input
  → AgentCore.think()           ← 唯一 AI 决策
  → RuntimeCore.validate()      ← Zod + SafetyGuard（仅校验）
  → BehaviorArbitrator          ← 软层冲突仲裁
  → SkillRouter.route()         ← 唯一执行入口（token 门控）
  → ActionDispatcher.dispatch() ← 唯一 bot 控制器
  → Mineflayer Bot
```

## 特性

- **多提供商 LLM** — Doubao（默认）/ DeepSeek / OpenAI / Anthropic / Gemini / Mistral / Grok / Qwen，流式输出经 Zod 校验后才可执行
- **8 个内置技能** — follow / explore / mine / gather / collect / attack / defend / build，带重试与降级链
- **安全约束** — 自动检测岩浆/虚空/坠落危险，低血量自动逃跑，禁止破坏玩家建筑
- **语音交互** — Whisper STT + Doubao TTS（火山引擎 HMAC-SHA256 签名）/ Edge-TTS 降级；TTS 失败不阻断聊天
- **记忆系统** — SQLite + 混合检索 + 关系状态 + 共享经验
- **人格 / 情绪 / 社交引擎** — 同伴 / 建造者 / 探索者 / 守卫 4 种预设
- **团队协同** — 阵型、战斗/挖矿协调、意图预测
- **可观测性** — 运行时追踪、行为时间线、系统健康、事件导出器

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Minecraft Java Edition](https://www.minecraft.net/) 1.20.x
- 一个 LLM API Key（支持 Doubao / DeepSeek / OpenAI / Anthropic / Google 等）

### 安装与运行

```bash
git clone git@github.com:zhongli369/AIMC.git
cd AIMC
npm install
npm run build        # 编译 TypeScript（dist/ 自带，源码修改后需要）
npm run electron     # 启动 Electron 启动器
```

### 配置密钥（`.env`）

密钥**不硬编码在源码中**，启动时从 `.env`（已 gitignore）加载：

```bash
cp .env.example .env   # 然后编辑 .env 填入真实值
```

关键环境变量：

| 变量 | 用途 |
|------|------|
| `DOUBAO_API_KEY` / `ARK_API_KEY` | 豆包 LLM（ARK 推理） |
| `DEEPSEEK_API_KEY` | DeepSeek LLM（非豆包 provider 时的回退） |
| `DOUBAO_TTS_ACCESS_KEY_ID` | 火山引擎 IAM AccessKeyId（TTS 签名） |
| `DOUBAO_TTS_SECRET_ACCESS_KEY` | 火山引擎 IAM SecretAccessKey |
| `DOUBAO_TTS_API_KEY` | TTS grant token |
| `DOUBAO_TTS_APP_ID` | 火山引擎 TTS App ID |
| `AIMC_TTS_PROVIDER` | `doubao` 或 `edge` |

不配置 TTS 密钥时，语音合成优雅降级——bot 聊天与动作执行不受影响。完整清单见 `.env.example`。

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
│   ├── main.cjs        ← 主进程（窗口、IPC、Bot 生命周期、.env 加载）
│   ├── preload.cjs     ← contextBridge API
│   ├── legacy-bridge.cjs ← 桥接 + TTS/语音编排 + 心跳 + 异常边界
│   ├── tts-doubao.cjs  ← 豆包 TTS（火山引擎 Signature V4）
│   └── renderer/       ← UI（HTML/CSS/JS）
├── src/
│   ├── runtime/        ← Zod 校验 + 安全护盾 + 动作分发器（token 门控）
│   ├── agent/          ← AgentCore（think 循环）
│   ├── llm/            ← 多提供商 LLM 客户端 + 提示词（中文）
│   ├── skill/          ← 8 个内置技能 + SkillRouter
│   ├── voice/          ← Whisper STT + TTS 适配
│   ├── memory/         ← SQLite + 混合检索记忆系统
│   ├── personality/    ← 人格 + 情绪 + 社交引擎
│   ├── team/           ← 团队协同 + 阵型 + 意图预测
│   ├── behavior/       ← 主动引擎 + 任务规划器 + 稳定性
│   ├── observability/  ← 运行时追踪 + 时间线 + 健康
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
| [DeepSeek API](https://platform.deepseek.com/) | LLM 后端之一 |
| [火山引擎 / 豆包](https://www.volcengine.com/) | 默认 LLM + TTS 后端 |
| [Edge-TTS](https://github.com/rany2/edge-tts) | 微软 Edge 文字转语音 |
| [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) | 本地语音识别 |

## 许可证

本项目基于原 Mindcraft 项目修改。原项目许可证见 `src/legacy/` 目录。
