/**
 * AIMC Electron Launcher — Main Process
 *
 * Architecture:
 *   LauncherResolver → path discovery + validation
 *   BotProcessManager → spawn, lifecycle, error classification
 *   main.cjs → window, IPC, config, glue
 *
 * Two modes:
 *   NORMAL (default):  Launcher UI window
 *   BOT (AIMC_BOT_MODE=1): Directly loads legacy-bridge.cjs, no window
 *
 * All paths are dynamically resolved. No hardcoded paths.
 * cwd is guaranteed to be a real filesystem path (never inside ASAR).
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// ═══ .env loader (secrets stay OUT of source control) ═══
// Reads a gitignored `.env` file so double-click launch still works
// without hardcoding credentials. Real environment variables always win.
function loadDotEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf-8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      console.log(`[main.cjs] loaded env from ${file}`);
      return;
    } catch (err) {
      console.error(`[main.cjs] failed to load ${file}:`, err.message);
    }
  }
}
loadDotEnv();

// ═══════════════════════════════════════════════════════════════
// BOT MODE — runs before any Electron app initialization
// When AIMC_BOT_MODE=1, directly execute the bridge script as a
// headless bot container. No windows, no renderer, no IPC.
// ═══════════════════════════════════════════════════════════════

if (process.env.AIMC_BOT_MODE === "1") {
  console.log("[main.cjs] AIMC_BOT_MODE=1 detected — entering bot container mode.");
  console.log("[main.cjs] __dirname:", __dirname);
  console.log("[main.cjs] Loading legacy-bridge.cjs...");

  // Directly require the bridge — it will keep the event loop alive.
  // No app.whenReady(), no BrowserWindow, no IPC.
  require("./legacy-bridge.cjs");

  // require() returns after bootstrap() is scheduled (async, fire-and-forget).
  // The bridge's keepAlive() setInterval holds the event loop open.
  // We must NOT return to the caller — we stay here forever.
  // If require() returns synchronously, the event loop stays alive via the bridge.
  return;
}

// ═══════════════════════════════════════════════════════════════
// NORMAL MODE — Launcher UI
// ═══════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain } = require("electron");

const {
  validate: validatePaths,
  resolveBotProfileDir,
  buildBotElectronFlags,
} = require("./launcher-resolver.cjs");
const { BotProcessManager } = require("./bot-process-manager.cjs");

// ── Default env vars for double-click launch (no shell needed) ───
// These are set in the Launcher process so voice/TTS work in the UI.
// They are also forwarded to the bot process via startBot().
(function applyDefaults() {
  const DEFAULTS = {
    AIMC_TTS_ENABLED: "1",
    AIMC_TTS_PROVIDER: "doubao",
    // DOUBAO_TTS_* credentials are NOT hardcoded — load from `.env` or system env.
    // See `.env.example`. The bridge disables TTS gracefully when they are absent.
    AIMC_VOICE_ENABLED: "1",
    AIMC_WHISPER_LANGUAGE: "zh",
    AIMC_WHISPER_MODEL: "tiny",
  };
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!process.env[k]) process.env[k] = v;
  }
})();

// ─── Paths ──────────────────────────────────────────────────

const CONFIG_PATH = path.join(app.getPath("userData"), "aimc-config.json");
const TEMP_PROFILE_PATH = path.join(app.getPath("temp"), "aimc-temp-profile.json");
const VOICE_TEMP_DIR = path.join(app.getPath("temp"), "aimc-voice");

// ─── Voice / Whisper STT helpers ──────────────────────────

function detectWhisperMode(modelPath) {
  // .bin / .ggml → whisper.cpp; anything else → openai-whisper (model name)
  if (modelPath && (modelPath.endsWith(".bin") || modelPath.endsWith(".ggml"))) {
    return "cpp";
  }
  return "python";
}

function checkVoiceReadiness() {
  const voiceEnabled = process.env.AIMC_VOICE_ENABLED === "1";
  if (!voiceEnabled) {
    return { ready: false, reason: "disabled", message: "Voice is disabled. Set AIMC_VOICE_ENABLED=1." };
  }

  const whisperPath = process.env.AIMC_WHISPER_PATH;
  const modelPath = process.env.AIMC_WHISPER_MODEL;

  if (!modelPath) {
    return { ready: false, reason: "missing_model", message: "AIMC_WHISPER_MODEL not configured." };
  }

  const mode = detectWhisperMode(modelPath);

  if (mode === "cpp") {
    if (!whisperPath || !fs.existsSync(whisperPath)) {
      return { ready: false, reason: "missing_whisper", message: `Whisper binary not found: ${whisperPath || "not configured"}` };
    }
    if (!fs.existsSync(modelPath)) {
      return { ready: false, reason: "missing_model", message: `Whisper model file not found: ${modelPath}` };
    }
  } else {
    // openai-whisper: check for Python availability (lazy, checked at transcribe time)
    console.log(`[VOICE-STT] openai-whisper mode — model name: ${modelPath}`);
  }

  return { ready: true, mode };
}

function writeWavFile(filePath, pcmBuffer, sampleRate, channels) {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.byteLength;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.createWriteStream(filePath);
  fd.write(header);
  fd.write(Buffer.from(pcmBuffer));
  fd.end();
}

// ── Active whisper child process (for cancel support) ──
let activeWhisperProcess = null;
let activeWhisperTraceId = null;
const cancelledTraceIds = new Set(); // TTL cleaned in transcribe handler

function cancelActiveWhisper() {
  if (activeWhisperProcess) {
    const pid = activeWhisperProcess.pid;
    const tid = activeWhisperTraceId;
    cancelledTraceIds.add(tid);
    try { activeWhisperProcess.kill("SIGTERM"); } catch (_) {}
    console.log(`[VOICE-STT] cancelled traceId=${tid} pid=${pid}`);
    activeWhisperProcess = null;
    activeWhisperTraceId = null;
    return true;
  }
  console.log("[VOICE-STT] cancel — no active whisper process");
  return false;
}

function runWhisper(whisperPath, modelPath, wavPath, traceId) {
  const mode = detectWhisperMode(modelPath);
  if (mode === "python") {
    return runWhisperPython(modelPath, wavPath, traceId);
  }
  return runWhisperCpp(whisperPath, modelPath, wavPath, traceId);
}

function runWhisperCpp(whisperPath, modelPath, wavPath, traceId) {
  return new Promise((resolve, reject) => {
    console.log(`[VOICE-STT] whisper.cpp started traceId=${traceId}`);

    const lang = process.env.AIMC_WHISPER_LANGUAGE || "zh";

    const child = spawn(whisperPath, [
      "-m", modelPath,
      "-f", wavPath,
      "-t", "2",
      "-l", lang,
      "--no-timestamps",
      "--no-prints",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Track for cancel support
    activeWhisperProcess = child;
    activeWhisperTraceId = traceId;

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      console.log(`[VOICE-STT] timeout traceId=${traceId} pid=${child.pid}`);
      child.kill("SIGTERM");
      activeWhisperProcess = null;
      activeWhisperTraceId = null;
      reject(new Error("Whisper timed out after 30s"));
    }, 30000);

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      clearTimeout(timeout);
      activeWhisperProcess = null;
      activeWhisperTraceId = null;

      if (code !== 0 && code !== null) {
        console.error(`[VOICE-STT] whisper.cpp exited with code ${code} traceId=${traceId}`);
        reject(new Error(`Whisper exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      const cleaned = stdout
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
        .replace(/^whisper_.*\n/gm, "")
        .replace(/^\[BLANK_AUDIO\].*/gm, "")
        .trim();

      if (!cleaned || /^\[BLANK_AUDIO\]$/i.test(cleaned)) {
        console.log(`[VOICE-STT] transcript empty or blank audio traceId=${traceId}`);
        resolve(null);
        return;
      }

      console.log(`[VOICE-STT] transcript traceId=${traceId} text="${cleaned.slice(0, 80)}"`);
      resolve(cleaned);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      activeWhisperProcess = null;
      activeWhisperTraceId = null;
      reject(new Error(`whisper.cpp spawn failed: ${err.message}`));
    });
  });
}

function runWhisperPython(modelName, wavPath, traceId) {
  return new Promise((resolve, reject) => {
    console.log(`[VOICE-STT] openai-whisper started traceId=${traceId} model=${modelName}`);

    const child = spawn("py", [
      "-m", "whisper",
      wavPath,
      "--model", modelName,
      "--threads", "2",
      "--output_format", "txt",
      "--output_dir", VOICE_TEMP_DIR,
      "--language", process.env.AIMC_WHISPER_LANGUAGE || "zh",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "",
        no_proxy: "*", NO_PROXY: "*",
      },
    });

    // Track for cancel support
    activeWhisperProcess = child;
    activeWhisperTraceId = traceId;

    let stderr = "";

    const timeout = setTimeout(() => {
      console.log(`[VOICE-STT] timeout traceId=${traceId} pid=${child.pid}`);
      child.kill("SIGTERM");
      activeWhisperProcess = null;
      activeWhisperTraceId = null;
      reject(new Error("Whisper timed out after 60s"));
    }, 60000); // openai-whisper first run downloads model, needs more time

    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      clearTimeout(timeout);
      activeWhisperProcess = null;
      activeWhisperTraceId = null;

      if (code !== 0 && code !== null) {
        console.error(`[VOICE-STT] openai-whisper exited with code ${code} traceId=${traceId}`);
        reject(new Error(`Whisper exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      // openai-whisper writes transcript to <wav_basename>.txt in output_dir
      const baseName = path.basename(wavPath, ".wav");
      const txtPath = path.join(VOICE_TEMP_DIR, `${baseName}.txt`);

      try {
        const text = fs.readFileSync(txtPath, "utf-8").trim();
        try { fs.unlinkSync(txtPath); } catch (_) {}
        // Also clean up .srt/.vtt if produced
        try { fs.unlinkSync(path.join(VOICE_TEMP_DIR, `${baseName}.srt`)); } catch (_) {}
        try { fs.unlinkSync(path.join(VOICE_TEMP_DIR, `${baseName}.vtt`)); } catch (_) {}

        if (!text || /^\[BLANK_AUDIO\]$/i.test(text)) {
          console.log(`[VOICE-STT] transcript empty or blank audio traceId=${traceId}`);
          resolve(null);
          return;
        }

        console.log(`[VOICE-STT] transcript traceId=${traceId} text="${text.slice(0, 80)}"`);
        resolve(text);
      } catch (err) {
        console.error(`[VOICE-STT] failed to read transcript file traceId=${traceId}`, err.message);
        resolve(null);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      activeWhisperProcess = null;
      activeWhisperTraceId = null;
      reject(new Error(`openai-whisper spawn failed: ${err.message}`));
    });
  });
}

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
  "doubao-seed-1-6": "DOUBAO_API_KEY",
  "doubao-seed-1-6-lite": "DOUBAO_API_KEY",
  "doubao-seed-1-6-flash": "DOUBAO_API_KEY",
  "doubao-seed-2-0-pro": "DOUBAO_API_KEY",
  "doubao-seed-2-0-lite": "DOUBAO_API_KEY",
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
    model: config.model || "deepseek-chat",
    doubaoEndpointId: config.doubaoEndpointId || "",
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

  // ── Passthrough env vars ──────────────────────────
  // Forward all AIMC_* / DOUBAO_* / ARK_* / VOLCENGINE_* to bot process.
  // These control TTS, voice, model routing, and other runtime features.
  const passthroughEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AIMC_") || key.startsWith("DOUBAO_") || key.startsWith("ARK_") || key.startsWith("VOLCENGINE_")) {
      passthroughEnv[key] = process.env[key];
    }
  }

  // ── Spawn via BotProcessManager ───────────────────
  // BotProcessManager emits its own "status" events — do NOT duplicate them here.
  const result = botManager.start({
    exePath: validation.exePath,
    bridgePath: validation.bridgePath,
    cwd: validation.cwd,
    electronFlags,
    env: {
      // ── TTS/Voice defaults (double-click launch, no shell needed) ──
      // DOUBAO_TTS_* credentials are NOT hardcoded — forwarded via passthroughEnv
      // (from `.env` or system env) only. TTS disables gracefully when absent.
      AIMC_TTS_ENABLED: "1",
      AIMC_TTS_PROVIDER: "doubao",
      AIMC_VOICE_ENABLED: "1",
      AIMC_WHISPER_LANGUAGE: "zh",
      AIMC_WHISPER_MODEL: "tiny",
      // Passthrough env vars (overrides defaults when set in shell)
      ...passthroughEnv,
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
    // Echo to main console for debugging
    const prefix = output.type === "stderr" ? "[BOT-ERR]" : "[BOT]";
    process.stdout.write(prefix + " " + output.text);
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

  ipcMain.handle("voice:sim", (_event, message, traceId) => {
    console.log("[main.cjs] voice:sim IPC received — message:", message?.slice(0, 60), "traceId:", traceId);
    const result = botManager.sendVoiceSim(message, traceId);
    console.log("[main.cjs] voice:sim result:", JSON.stringify(result));
    return result;
  });

  ipcMain.handle("voice:cancel", (_event, traceId) => {
    console.log(`[VOICE-STT] cancel requested traceId=${traceId}`);
    const killed = cancelActiveWhisper();
    return { success: true, cancelled: killed };
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

  // ── Voice Recording (Phase 4B) ───────────────────────

  ipcMain.handle("voice:check-ready", () => {
    const result = checkVoiceReadiness();
    // Notify renderer of voice status
    sendToRenderer("voice:result", { status: result.ready ? "ready" : result.reason, message: result.message });
    return result;
  });

  ipcMain.handle("voice:transcribe", async (_event, pcmBuffer, metadata) => {
    const traceId = metadata?.traceId || ("mic-" + Date.now().toString(36));
    const sampleRate = metadata?.sampleRate || 16000;
    const channels = metadata?.channels || 1;
    const durationMs = metadata?.durationMs || 0;

    // ── Validate payload ─────────────────────────────
    if (!pcmBuffer || pcmBuffer.byteLength === 0) {
      console.error(`[VOICE-STT] empty audio data traceId=${traceId}`);
      return { success: false, error: "empty_audio", message: "Audio data is empty." };
    }
    if (sampleRate !== 16000) {
      console.error(`[VOICE-STT] unsupported sample rate traceId=${traceId} sampleRate=${sampleRate}`);
      return { success: false, error: "bad_sample_rate", message: `Sample rate must be 16000, got ${sampleRate}.` };
    }
    if (durationMs < 300) {
      console.log(`[VOICE-STT] audio too short traceId=${traceId} durationMs=${durationMs}`);
      return { success: false, error: "too_short", message: `Audio too short: ${durationMs}ms. Minimum 300ms.` };
    }
    if (durationMs > 15000) {
      console.log(`[VOICE-STT] audio too long traceId=${traceId} durationMs=${durationMs}`);
      return { success: false, error: "too_long", message: `Audio too long: ${durationMs}ms. Maximum 15000ms.` };
    }

    // ── Check voice readiness ─────────────────────────
    const ready = checkVoiceReadiness();
    if (!ready.ready) {
      console.log(`[VOICE-STT] voice not ready traceId=${traceId} reason=${ready.reason}`);
      sendToRenderer("voice:result", { status: ready.reason, message: ready.message });
      return { success: false, error: ready.reason, message: ready.message };
    }

    const whisperPath = process.env.AIMC_WHISPER_PATH;
    const modelPath = process.env.AIMC_WHISPER_MODEL;

    // ── Write WAV ─────────────────────────────────────
    fs.mkdirSync(VOICE_TEMP_DIR, { recursive: true });
    const wavPath = path.join(VOICE_TEMP_DIR, `${traceId}.wav`);

    try {
      writeWavFile(wavPath, pcmBuffer, sampleRate, channels);
    } catch (err) {
      console.error(`[VOICE-STT] wav write failed traceId=${traceId}`, err.message);
      return { success: false, error: "wav_write_failed", message: err.message };
    }

    console.log(`[VOICE-STT] audio saved path=${wavPath} traceId=${traceId} samples=${pcmBuffer.byteLength / 2} sampleRate=${sampleRate} durationMs=${durationMs}`);

    // ── Run whisper ───────────────────────────────────
    let transcript = null;
    try {
      transcript = await runWhisper(whisperPath, modelPath, wavPath, traceId);
    } catch (err) {
      const wasCancelled = cancelledTraceIds.has(traceId);
      cancelledTraceIds.delete(traceId);
      console.error(`[VOICE-STT] failed stack=${err.stack || err.message} wasCancelled=${wasCancelled}`);
      try { fs.unlinkSync(wavPath); } catch (_) {}
      if (wasCancelled) {
        return { success: false, error: "cancelled", message: "Transcription cancelled." };
      }
      return { success: false, error: "whisper_failed", message: err.message };
    }

    // ── Cleanup WAV ───────────────────────────────────
    try { fs.unlinkSync(wavPath); } catch (e) {
      console.warn(`[VOICE-STT] cleanup warn path=${wavPath}`, e.message);
    }

    // ── Check if cancelled during whisper ─────────────
    if (cancelledTraceIds.has(traceId)) {
      cancelledTraceIds.delete(traceId);
      console.log(`[VOICE-STT] cancelled after whisper returned traceId=${traceId} — not sending IPC`);
      return { success: false, error: "cancelled", message: "Transcription cancelled." };
    }

    // ── Send transcript via file IPC ──────────────────
    if (!transcript) {
      console.log(`[VOICE-STT] transcript empty traceId=${traceId} — not sending`);
      return { success: false, error: "empty_transcript", message: "No speech detected." };
    }

    if (!botManager.running) {
      console.log(`[VOICE-STT] bot not running traceId=${traceId} — cannot send`);
      return { success: false, error: "bot_not_running", message: "Bot is not running." };
    }

    const ipcResult = botManager._writeIpcFile({
      type: "voice_transcript",
      traceId,
      message: transcript,
      timestamp: Date.now(),
      source: "player_voice",
    });

    if (!ipcResult.success) {
      console.error(`[VOICE-STT] file IPC write failed traceId=${traceId}`, ipcResult.error);
      return { success: false, error: "ipc_write_failed", message: ipcResult.error };
    }

    console.log(`[VOICE-STT] sent voice_transcript via file IPC traceId=${traceId}`);
    sendToRenderer("voice:result", { status: "sent", traceId, transcript });
    return { success: true, transcript };
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
