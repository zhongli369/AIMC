/**
 * AIMC Electron Launcher — Main Process
 *
 * Architecture:
 *   LauncherResolver → path discovery + validation
 *   BotProcessManager → spawn, lifecycle, error classification
 *   main.cjs → window, IPC, config, glue
 *
 * All paths are dynamically resolved. No hardcoded paths.
 * cwd is guaranteed to be a real filesystem path (never inside ASAR).
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const {
  validate: validatePaths,
  resolveBotProfileDir,
  buildBotElectronFlags,
} = require("./launcher-resolver.cjs");
const { BotProcessManager } = require("./bot-process-manager.cjs");

// ─── Paths ──────────────────────────────────────────────────

const CONFIG_PATH = path.join(app.getPath("userData"), "aimc-config.json");
const TEMP_PROFILE_PATH = path.join(app.getPath("temp"), "aimc-temp-profile.json");

// ─── State ──────────────────────────────────────────────────

let mainWindow = null;
let dashboardWindow = null;
const botManager = new BotProcessManager();

// ─── Config ─────────────────────────────────────────────────

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

// ─── Profile Generator ──────────────────────────────────────

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

// ─── Model → Env Var Mapping ───────────────────────────────

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

// ─── IPC → Renderer helpers ─────────────────────────────────

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── Bot Lifecycle ──────────────────────────────────────────

/**
 * Start the bot using validated paths and BotProcessManager.
 * Paths are resolved dynamically — no hardcoded paths.
 */
function startBot(config) {
  // ── Auto-recovery: detect stale state ─────────────
  const health = botManager.healthCheck();
  if (!health.healthy && health.details.reason === "state_mismatch") {
    console.log("[AIMC Launcher] Auto-recovered from stale bot state.");
  }

  if (botManager.running) {
    return { success: false, error: "Bot is already running." };
  }

  // ── Validate paths (DRY: LauncherResolver) ───────
  const validation = validatePaths();
  if (!validation.valid) {
    const errorMsg = "Path validation failed:\n" + validation.errors.map((e) => "  - " + e).join("\n");
    console.error("[AIMC Launcher]", errorMsg);
    sendToRenderer("bot:output", { type: "stderr", text: errorMsg + "\n" });
    return { success: false, error: validation.errors[0] };
  }

  // ── Build profile ─────────────────────────────────
  const profile = buildProfile(config);
  try {
    fs.writeFileSync(TEMP_PROFILE_PATH, JSON.stringify(profile, null, 2), "utf8");
  } catch (err) {
    return { success: false, error: `Failed to write profile: ${err.message}` };
  }

  // ── Build env ─────────────────────────────────────
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

  // ── Bot runtime profile (isolated Chromium cache) ──
  const botId = `${config.botName || "bot"}_${Date.now()}`;
  const runtimeProfile = resolveBotProfileDir(botId);

  if (!runtimeProfile.profileDir) {
    const errorMsg = `Failed to create bot profile directory: ${runtimeProfile.error}`;
    console.error("[AIMC Launcher]", errorMsg);
    sendToRenderer("bot:output", { type: "stderr", text: errorMsg + "\n" });
    return { success: false, error: errorMsg };
  }

  const electronFlags = buildBotElectronFlags(runtimeProfile.profileDir);

  console.log("[AIMC Launcher] Bot runtime profile:");
  console.log("  botId:", botId);
  console.log("  profileDir:", runtimeProfile.profileDir);
  console.log("  electronFlags:", electronFlags);
  console.log("[AIMC Launcher] Env vars passed to bot:");
  console.log("  SETTINGS_JSON:", settingsJson);
  console.log("  apiKeyEnvVar:", apiKeyVar, "=", config.apiKey ? "present" : "MISSING");

  // ── Spawn via BotProcessManager ───────────────────
  // BotProcessManager emits its own "status" events — do NOT duplicate them here.
  const result = botManager.start({
    exePath: validation.exePath,
    bridgePath: validation.bridgePath,
    cwd: validation.cwd,
    electronFlags,
    env: {
      PROFILES: JSON.stringify([TEMP_PROFILE_PATH]),
      SETTINGS_JSON: settingsJson,
      [apiKeyVar]: config.apiKey,
    },
  });

  return result;
}

function stopBot() {
  // BotProcessManager emits "status: {running: false}" via the exit handler — do not duplicate.
  return botManager.stop();
}

// ─── Window ─────────────────────────────────────────────────

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

function createDashboard() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return dashboardWindow;
  }

  dashboardWindow = new BrowserWindow({
    width: 960,
    height: 620,
    resizable: true,
    minWidth: 800,
    minHeight: 500,
    title: "AIMC Dashboard",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  dashboardWindow.loadFile(path.join(__dirname, "renderer", "ui", "dashboard.html"));

  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
  });

  return dashboardWindow;
}

// ─── BotManager → Renderer event forwarding ─────────────────

function sendToDashboard(channel, data) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send(channel, data);
  }
}

function wireBotEvents() {
  botManager.on("status", (status) => {
    sendToRenderer("bot:status", status);
    // Also forward to dashboard for connected/disconnected state
    sendToDashboard("aimc:dashboard-status", status);
  });

  botManager.on("output", (output) => {
    sendToRenderer("bot:output", output);
  });

  botManager.on("chat-response", (msg) => {
    sendToRenderer("bot:chat-response", msg);
  });

  botManager.on("ui-state", (state) => {
    sendToDashboard("aimc:dashboard-state", state);
  });
}

// ─── IPC Handlers ───────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle("config:load", () => loadConfig());

  ipcMain.handle("config:save", (_event, config) => {
    const { apiKey, ...safeConfig } = config;
    return saveConfig(safeConfig);
  });

  ipcMain.handle("bot:start", (_event, config) => {
    const { apiKey, ...safeConfig } = config;
    saveConfig(safeConfig);
    return startBot(config);
  });

  ipcMain.handle("bot:stop", () => stopBot());

  ipcMain.handle("bot:status", () => {
    return { running: botManager.running };
  });

  ipcMain.handle("chat:send", (_event, message) => {
    return botManager.sendChat(message);
  });

  ipcMain.handle("dashboard:open", () => {
    createDashboard();
    return { success: true };
  });

  ipcMain.handle("dashboard:status", () => {
    return {
      open: !!(dashboardWindow && !dashboardWindow.isDestroyed()),
    };
  });
}

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(() => {
  wireBotEvents();
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  botManager.stop();
  app.quit();
});

app.on("before-quit", () => {
  botManager.stop();
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  }
});
