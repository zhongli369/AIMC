/**
 * AIMC Electron Launcher — Main Process
 *
 * Handles: window management, IPC, bot lifecycle.
 * Uses utilityProcess.fork so it works BOTH in dev and as a packaged .exe.
 */
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// ─── Paths ──────────────────────────────────────────────

const CONFIG_PATH = path.join(app.getPath("userData"), "aimc-config.json");
const TEMP_PROFILE_PATH = path.join(app.getPath("temp"), "aimc-temp-profile.json");
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── State ───────────────────────────────────────────────

let mainWindow = null;
let botProcess = null;
let botRunning = false;

// ─── Config ──────────────────────────────────────────────

const DEFAULT_CONFIG = {
  apiKey: "",
  host: "127.0.0.1",
  port: 25565,
  botName: "AIMC",
  model: "deepseek-chat",
  minecraftVersion: "auto",
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error("[AIMC Launcher] Failed to load config:", err.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Profile Generator ───────────────────────────────────

function buildProfile(config) {
  return {
    name: config.botName,
    model: config.model,
    cooldown: 3000,
    conversing:
      "你是一个名为 $NAME 的 AI Minecraft 机器人，可以与玩家交谈、观察、移动、挖掘、建造，并通过命令与世界互动。\n$SELF_PROMPT 做一个友好、随和、高效的机器人。回复尽可能简短，不要频繁道歉，除非被要求否则不要给出指令或列表，不要拒绝请求。不要假装执行动作，被要求时立即使用命令。绝对不要这样说：'好的，我停下来了。*停下*'，而应该说：'好的，我停下。!stop'。只以 $NAME 的身份回复，绝不要输出 '(FROM OTHER BOT)' 或假装成别人。如果你无话可说或无动作可做，只回复一个制表符 '\\t'。\n总结记忆：'$MEMORY'\n$STATS\n$INVENTORY\n$COMMAND_DOCS\n$EXAMPLES\n对话开始：",
    coding:
      "你是一个名为 $NAME 的智能 mineflayer 机器人，通过编写 javascript 代码块来玩 Minecraft。根据对话内容，使用提供的技能和世界函数编写 js 代码块来控制 mineflayer 机器人 ``` // 使用此语法 ```。代码将被执行，你将收到输出结果。如果发生错误，编写另一个代码块尝试修复问题。保持最大效率、创造性和正确性。不要使用 !likeThis 这样的命令，只使用代码块。代码是异步的，所有 async 函数调用必须使用 AWAIT。不要导入其他库。不要进行对话式交流，只使用代码块。在注释中进行规划。\n$SELF_PROMPT\n总结记忆：'$MEMORY'\n$STATS\n$INVENTORY\n$CODE_DOCS\n$EXAMPLES\n对话：",
    saving_memory:
      "你是一个名为 $NAME 的 minecraft 机器人，一直通过命令与人交谈和游戏。通过总结以下对话和你的旧记忆来更新你的记忆。优先保存重要事实、你学到的东西、有用的技巧和长期提醒。不要记录状态、物品栏或文档！只保存对话历史中的临时信息。你被限制在 500 个字符以内，所以请极其简练并尽量减少字数。压缩有用信息。\n旧记忆：'$MEMORY'\n最近的对话：\n$TO_SUMMARIZE\n将旧记忆和最近对话总结为新的记忆，只回复解包后的记忆文本：",
    modes: {
      self_preservation: true,
      unstuck: true,
      cowardice: false,
      self_defense: true,
      hunting: true,
      item_collecting: true,
      torch_placing: true,
      elbow_room: true,
      idle_staring: true,
      cheat: false,
    },
    conversation_examples: [],
    coding_examples: [],
  };
}

// ─── Model → Env Var Mapping ────────────────────────────

const MODEL_API_KEY_MAP = {
  "deepseek-chat": "DEEPSEEK_API_KEY",
  "deepseek-reasoner": "DEEPSEEK_API_KEY",
  "gpt-4o": "OPENAI_API_KEY",
  "gpt-4o-mini": "OPENAI_API_KEY",
  "gpt-4": "OPENAI_API_KEY",
  "claude-sonnet-4-6": "ANTHROPIC_API_KEY",
  "claude-opus-4-7": "ANTHROPIC_API_KEY",
  "claude-haiku-4-5": "ANTHROPIC_API_KEY",
  "gemini-2.5-pro": "GEMINI_API_KEY",
  "gemini-2.5-flash": "GEMINI_API_KEY",
  "mistral-large": "MISTRAL_API_KEY",
  "grok-3": "XAI_API_KEY",
  "qwen-max": "QWEN_API_KEY",
};

function getApiKeyEnvVar(model) {
  return MODEL_API_KEY_MAP[model] || "DEEPSEEK_API_KEY";
}

// ─── Bot Lifecycle ───────────────────────────────────────

function startBot(config) {
  // Auto-recovery: if the flag is set but the process died, reset state
  if (botRunning && (!botProcess || botProcess.killed || botProcess.exitCode !== null)) {
    botRunning = false;
    botProcess = null;
  }

  if (botRunning) {
    return { success: false, error: "Bot is already running." };
  }

  // Build profile and write temp file
  const profile = buildProfile(config);
  try {
    fs.writeFileSync(TEMP_PROFILE_PATH, JSON.stringify(profile, null, 2), "utf8");
  } catch (err) {
    return { success: false, error: `Failed to write profile: ${err.message}` };
  }

  // Build settings JSON
  const settingsJson = JSON.stringify({
    host: config.host,
    port: Number(config.port),
    minecraft_version: config.minecraftVersion || "auto",
    auth: "offline",
    base_profile: "survival",
    load_memory: false,
    auto_open_ui: false,
  });

  const apiKeyVar = getApiKeyEnvVar(config.model);

  const env = {
    ...process.env,
    PROFILES: JSON.stringify([TEMP_PROFILE_PATH]),
    SETTINGS_JSON: settingsJson,
    [apiKeyVar]: config.apiKey,
  };

  const bridgePath = path.join(__dirname, "legacy-bridge.cjs");

  // Use child_process.spawn: Electron 33's utilityProcess.fork returns null for stdout.
  // spawn with process.execPath works because Electron bundles Node.js in both dev and packaged builds.
  botProcess = spawn(process.execPath, [bridgePath], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  botProcess.on("error", (err) => {
    botRunning = false;
    botProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bot:output", {
        type: "stderr",
        text: `Failed to spawn bot process: ${err.message}\n`,
      });
      mainWindow.webContents.send("bot:status", { running: false, error: err.message });
    }
  });

  botRunning = true;

  let stdoutBuf = "";
  botProcess.stdout.on("data", (chunk) => {
    const raw = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
    stdoutBuf += raw;
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("AIMC_MSG:")) {
        try {
          const msg = JSON.parse(line.slice(9));
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("bot:chat-response", msg);
          }
        } catch (_) { /* malformed JSON, ignore */ }
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("bot:output", { type: "stdout", text: line + "\n" });
      }
    }
  });

  botProcess.stderr.on("data", (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bot:output", { type: "stderr", text });
    }
  });

  botProcess.on("exit", (code) => {
    botRunning = false;
    botProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bot:status", { running: false, exitCode: code });
    }
  });

  return { success: true };
}

function stopBot() {
  if (!botRunning || !botProcess) {
    return { success: false, error: "Bot is not running." };
  }
  try {
    botProcess.kill();
    botProcess = null;
    botRunning = false;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Window ──────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    resizable: false,
    title: "AIMC Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle("config:load", () => loadConfig());

  ipcMain.handle("config:save", (_event, config) => {
    const { apiKey, ...safeConfig } = config;
    return saveConfig(safeConfig);
  });

  ipcMain.handle("bot:start", (_event, config) => {
    const { apiKey, ...safeConfig } = config;
    saveConfig(safeConfig);
    const result = startBot(config);
    if (result.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bot:status", { running: true });
    }
    return result;
  });

  ipcMain.handle("bot:stop", () => {
    const result = stopBot();
    if (result.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bot:status", { running: false });
    }
    return result;
  });

  ipcMain.handle("bot:status", () => {
    return { running: botRunning };
  });

  ipcMain.handle("chat:send", (_event, message) => {
    if (!botRunning || !botProcess || !botProcess.stdin.writable) {
      return { success: false, error: "Bot is not running or stdin is closed." };
    }
    try {
      botProcess.stdin.write(JSON.stringify({
        type: "chat",
        message: String(message).trim(),
        source: "player",
      }) + "\n");
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ─── App Lifecycle ───────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  stopBot();
  app.quit();
});

app.on("before-quit", () => {
  stopBot();
});
