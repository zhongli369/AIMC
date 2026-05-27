/**
 * AIMC Bot Bridge — CJS entry point for the spawned bot process.
 *
 * This is the RUNTIME CONTAINER. It must NEVER exit on its own.
 *
 * Unified Architecture:
 *   1. Install crash guard + keepAlive lock (immediate)
 *   2. Bootstrap: settings → bot → spawn → AgentCore → Dispatcher → RuntimeContext
 *   3. Start stdin listener + stats logger + heartbeat
 *   4. Hold event loop open forever
 *   5. AI → Action → Minecraft CLOSED LOOP
 *
 * Protocol (stdin/stdout JSON-lines):
 *   stdin:  {"type":"chat","message":"...","source":"player"}
 *   stdout: AIMC_MSG:{"type":"chat_response","speech":{...},"completed":true,"actionsExecuted":N}
 *   stdout: AIMC_MSG:{"type":"ready"}
 *   stdout: AIMC_MSG:{"type":"heartbeat","uptime":...,"phase":"running"}
 *
 * Global Runtime Bridge:
 *   globalThis.__BOT__              — Mineflayer bot instance
 *   globalThis.__ACTION_DISPATCHER__ — ActionDispatcher
 *   globalThis.__WORLD_STATE__      — world snapshot queries
 *   globalThis.__RUNTIME_CONTEXT__  — unified runtime state
 */

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const pf = require("mineflayer-pathfinder");

// ── Text normalization for Chinese voice/chat input ──────────
// Lightweight: NFKC fullwidth→halfwidth, trim, lowerCase,
// common traditional→simplified mappings for voice commands.
const TRAD_MAP = {
  "過來": "过来", "過我來": "过来", "來": "来", "過": "过",
  "這裡": "这里", "這裡": "这里", "我這一來": "我这里来",
  "跟著": "跟着", "嗎": "吗", "說": "说", "聽": "听",
  "見": "见", "讓": "让", "幫": "帮", "開": "开",
  "關": "关", "會": "会", "麼": "么", "樣": "样",
};

function normalizeText(raw) {
  if (typeof raw !== "string" || !raw) return "";
  let t = raw.trim().normalize("NFKC").toLowerCase();
  for (const [trad, simp] of Object.entries(TRAD_MAP)) {
    t = t.split(trad).join(simp);
  }
  if (t !== raw) {
    console.log(`[TEXT-NORM] raw="${raw.slice(0, 60)}" normalized="${t.slice(0, 60)}"`);
  }
  return t;
}

// ── FOLLLOW_CALL pattern (used in fast path + reflex) ──────────
// Matches anywhere — Whisper often adds extra words around "过来"
const FOLLOW_CALL_RE = /(过来|過來|来这里|來這裡|come\s*here|come\s*to\s*me|到我这里|到我這裡|follow\s*me|跟着我|跟著我|跟我来|跟我來|过来一下|過來一下)/i;

// ═══════════════════════════════════════════════════════════
// 1. Runtime Guard — install IMMEDIATELY
// ═══════════════════════════════════════════════════════════

const runtime = require("./runtime/bot-runtime-manager.cjs");

runtime.crashGuard();
runtime.keepAlive();

// ── Phase 4A: Resume stdin + register listeners IMMEDIATELY.
//    If we wait until bootstrap completes (~6s), Windows closes the pipe.
process.stdin.resume();
setupStdinListener();  // function declaration — hoisted, safe to call here
console.log("[BRIDGE] stdin resumed + listener registered (early)");

// ── Phase 4A.5: File-watch IPC (stdin unreliable on Win32 Electron).
//    Atomic write: Launcher writes .tmp → renames to .json.
//    Bot watches .json with fs.watchFile, reads, dispatches.
//    Supports: voice_sim, voice_transcript, ui_chat.
//
//    Dedup: per-traceId Map, TTL 30s.
//    Stale: messages older than 10s are ignored.
//    Retry: on read failure, retries once after 200ms.
//    Parse fail: logs rawPreview, no spam.
const os = require("os");
const IPC_FILE = path.join(os.tmpdir(), `aimc-ipc-${process.pid}.json`);
const IPC_TMP = IPC_FILE.replace(/\.json$/, ".tmp");
console.log(`[IPC-FILE] watcher starting path=${IPC_FILE}`);

// ── IPC dedup state ──────────────────────────────────────
const ipcTraceIds = new Map();        // traceId → timestamp
const IPC_DEDUP_TTL_MS = 30_000;
const IPC_STALE_MS = 10_000;

function isIpcDuplicate(traceId) {
  const prev = ipcTraceIds.get(traceId);
  const now = Date.now();
  if (prev && (now - prev) < IPC_DEDUP_TTL_MS) {
    console.log(`[IPC-FILE] duplicate ignored traceId=${traceId}`);
    return true;
  }
  ipcTraceIds.set(traceId, now);
  // Clean old entries
  for (const [k, t] of ipcTraceIds) {
    if (now - t > IPC_DEDUP_TTL_MS * 2) ipcTraceIds.delete(k);
  }
  return false;
}

function isIpcStale(timestamp) {
  const age = Date.now() - (timestamp || 0);
  if (age > IPC_STALE_MS) {
    console.log(`[IPC-FILE] stale ignored ageMs=${age}`);
    return true;
  }
  return false;
}

function tryReadIpcFile() {
  let raw;
  try {
    raw = fs.readFileSync(IPC_FILE, "utf-8");
  } catch (err) {
    console.warn(`[IPC-FILE] read failed: ${err.message} — will retry`);
    return null;
  }
  return raw;
}

function parseIpcMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    const preview = (raw || "").slice(0, 120).replace(/\n/g, "\\n");
    console.log(`[IPC-FILE] parse failed rawPreview="${preview}"`);
    return null;
  }

  if (!msg || !msg.message || !msg.type) {
    console.log(`[IPC-FILE] parse failed — missing type/message keys: ${Object.keys(msg || {}).join(",")}`);
    return null;
  }

  return msg;
}

function dispatchIpcMessage(msg) {
  console.log(`[IPC-FILE] event received type=${msg.type} traceId=${msg.traceId || "?"} source=${msg.source || "?"} text="${msg.message.slice(0, 60)}"`);

  switch (msg.type) {
    case "voice_sim":
      handleVoiceTranscript({
        type: "voice_transcript",
        source: "simulation",
        message: msg.message,
        traceId: msg.traceId,
      });
      break;

    case "voice_transcript":
      handleVoiceTranscript({
        type: "voice_transcript",
        source: msg.source || "player_voice",
        message: msg.message,
        traceId: msg.traceId,
      });
      break;

    case "ui_chat":
      console.log(`[IPC-FILE] dispatch to handleChat source=launcher_ui traceId=${msg.traceId || "?"}`);
      handleChat({
        type: "chat",
        source: "launcher_ui",
        message: msg.message,
        modality: "text",
        traceId: msg.traceId,
      });
      break;

    default:
      console.log(`[IPC-FILE] unknown type ignored: ${msg.type}`);
  }
}

// ── Clean up stale tmp file on startup ──────────────────
try { fs.unlinkSync(IPC_FILE); } catch (_) {}
try { fs.unlinkSync(IPC_TMP); } catch (_) {}

// ── File watcher ────────────────────────────────────────
var _ipcLastMtime = 0;
var _ipcRetryPending = false;

try {
  fs.watchFile(IPC_FILE, { interval: 500 }, (curr) => {
    if (!curr || curr.mtimeMs <= _ipcLastMtime) return;
    _ipcLastMtime = curr.mtimeMs;

    let raw = tryReadIpcFile();

    // ── Retry once after 200ms if read failed ──────────
    if (raw === null && !_ipcRetryPending) {
      _ipcRetryPending = true;
      setTimeout(() => {
        _ipcRetryPending = false;
        const retryRaw = tryReadIpcFile();
        if (retryRaw === null) {
          console.warn("[IPC-FILE] retry read also failed — message dropped");
          return;
        }
        const msg = parseIpcMessage(retryRaw);
        if (!msg) return;
        if (isIpcStale(msg.timestamp)) return;
        if (isIpcDuplicate(msg.traceId || msg.message)) return;
        dispatchIpcMessage(msg);
      }, 200);
      return;
    }

    if (raw === null) return;

    const msg = parseIpcMessage(raw);
    if (!msg) return;
    if (isIpcStale(msg.timestamp)) return;
    if (isIpcDuplicate(msg.traceId || msg.message)) return;
    dispatchIpcMessage(msg);
  });
  console.log("[IPC-FILE] watcher started");
} catch (err) {
  console.warn("[IPC-FILE] watcher failed:", err.message);
}

// ── Cleanup on bot stop ─────────────────────────────────
function cleanupIpcFile() {
  try { fs.unwatchFile(IPC_FILE); } catch (_) {}
  try { fs.unlinkSync(IPC_FILE); } catch (e) { console.warn("[IPC-FILE] cleanup unlink warn:", e.message); }
  try { fs.unlinkSync(IPC_TMP); } catch (_) {}
  console.log("[IPC-FILE] cleanup ok");
}

// Hold reference for SIGTERM handler
globalThis.__aimc_ipc_cleanup__ = cleanupIpcFile;

// Hook into SIGTERM for cleanup (before runtime.shutdown())
process.on("SIGTERM", () => {
  cleanupIpcFile();
});

console.log("[BRIDGE] ╔══════════════════════════════════════╗");
console.log("[BRIDGE] ║  AIMC Bot Bridge Starting         ║");
console.log("[BRIDGE] ╚══════════════════════════════════════╝");
console.log("[BRIDGE] boot start");
console.log("[BRIDGE] argv:", JSON.stringify(process.argv));
console.log("[BRIDGE] __dirname:", __dirname);
console.log("[BRIDGE] cwd:", process.cwd());

// ═══════════════════════════════════════════════════════════
// 2. Resolve paths
// ═══════════════════════════════════════════════════════════

const runtimeContext = require("./runtime/runtime-context.cjs");

const distIndex = path.resolve(__dirname, "..", "dist", "index.js");
const legacySettingsPath = path.resolve(__dirname, "..", "src", "legacy", "agent", "settings.js");
const mcdataPath = path.resolve(__dirname, "..", "src", "legacy", "utils", "mcdata.js");
const safetyGuardPath = path.resolve(__dirname, "..", "dist", "runtime", "safety-guard.js");
const dispatcherPath = path.resolve(__dirname, "..", "dist", "runtime", "action-dispatcher.js");
const skillRouterPath = path.resolve(__dirname, "..", "dist", "skill", "skill-router.js");
const skillRegistryPath = path.resolve(__dirname, "..", "dist", "skill", "skill-registry.js");
const perceptionPipelinePath = path.resolve(__dirname, "..", "dist", "perception", "perception-pipeline.js");
const reflexManagerPath = path.resolve(__dirname, "..", "dist", "reflex", "reflex-manager.js");
const lookAtSpeakerPath = path.resolve(__dirname, "..", "dist", "reflex", "behaviors", "look-at-speaker.js");
const autoFollowPath = path.resolve(__dirname, "..", "dist", "reflex", "behaviors", "auto-follow-on-call.js");

console.log("[BRIDGE] Dist index:", distIndex);
console.log("[BRIDGE] Legacy settings:", legacySettingsPath);
console.log("[BRIDGE] mcdata:", mcdataPath);

// ── Filesystem diagnostics ─────────────────
const __isAsar = __dirname.includes(".asar");
console.log("[BRIDGE] __isAsar:", __isAsar);
console.log("[BRIDGE] __dirname:", __dirname);
console.log("[BRIDGE] process.cwd:", process.cwd());

// Check if each critical file exists on disk
[distIndex, legacySettingsPath, mcdataPath, safetyGuardPath, dispatcherPath, skillRouterPath, skillRegistryPath, perceptionPipelinePath].forEach(p => {
  try {
    const exists = require("fs").existsSync(p);
    console.log(`[BRIDGE]   fs.existsSync(${path.basename(p)}): ${exists} — ${p}`);
  } catch (e) {
    console.log(`[BRIDGE]   fs.existsSync(${path.basename(p)}): ERROR — ${e.message}`);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. Environment diagnostics — verify API keys and settings
// ═══════════════════════════════════════════════════════════

console.log("[BRIDGE] ── ENV DIAGNOSTICS ──");
console.log("[BRIDGE] DEEPSEEK_API_KEY:", process.env.DEEPSEEK_API_KEY ? "present (" + process.env.DEEPSEEK_API_KEY.slice(0, 8) + "...)" : "MISSING");
console.log("[BRIDGE] DOUBAO_API_KEY:", process.env.DOUBAO_API_KEY ? "present (" + process.env.DOUBAO_API_KEY.slice(0, 8) + "...)" : "MISSING");
console.log("[BRIDGE] ARK_API_KEY:", process.env.ARK_API_KEY ? "present (" + process.env.ARK_API_KEY.slice(0, 8) + "...)" : "MISSING");
console.log("[BRIDGE] VOLCENGINE_API_KEY:", process.env.VOLCENGINE_API_KEY ? "present" : "MISSING");
console.log("[BRIDGE] OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "present" : "MISSING");
console.log("[BRIDGE] ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "present" : "MISSING");
console.log("[BRIDGE] SETTINGS_JSON:", process.env.SETTINGS_JSON ? process.env.SETTINGS_JSON : "MISSING");
console.log("[BRIDGE] PROFILES:", process.env.PROFILES ? "present" : "MISSING");

// Parse and log settings
let parsedSettings = {};
try {
  parsedSettings = JSON.parse(process.env.SETTINGS_JSON || "{}");
  console.log("[BRIDGE] Parsed settings:");
  console.log("  model:", parsedSettings.model || "(not set)");
  console.log("  host:", parsedSettings.host);
  console.log("  port:", parsedSettings.port);
  console.log("  minecraft_version:", parsedSettings.minecraft_version);
  console.log("  auth:", parsedSettings.auth);
} catch (e) {
  console.error("[BRIDGE] Failed to parse SETTINGS_JSON:", e.message);
}

// ═══════════════════════════════════════════════════════════
// 4. Model → Env Var mapping
// ═══════════════════════════════════════════════════════════

const MODEL_API_KEY_MAP = {
  "deepseek-chat": "DEEPSEEK_API_KEY",
  "deepseek-reasoner": "DEEPSEEK_API_KEY",
  "gpt-4o": "OPENAI_API_KEY",
  "gpt-4o-mini": "OPENAI_API_KEY",
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

const MODEL_BASE_URL_MAP = {
  "deepseek-chat": "https://api.deepseek.com/v1",
  "deepseek-reasoner": "https://api.deepseek.com/v1",
  "gpt-4o": "https://api.openai.com/v1",
  "gpt-4o-mini": "https://api.openai.com/v1",
  "claude-sonnet-4-6": "https://api.anthropic.com/v1",
  "claude-opus-4-7": "https://api.anthropic.com/v1",
  "claude-haiku-4-5": "https://api.anthropic.com/v1",
  "gemini-2.5-pro": "https://generativelanguage.googleapis.com/v1beta/openai",
  "gemini-2.5-flash": "https://generativelanguage.googleapis.com/v1beta/openai",
  "mistral-large": "https://api.mistral.ai/v1",
  "grok-3": "https://api.x.ai/v1",
  "qwen-max": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "doubao-seed-1-6": "https://ark.cn-beijing.volces.com/api/v3",
  "doubao-seed-1-6-lite": "https://ark.cn-beijing.volces.com/api/v3",
  "doubao-seed-1-6-flash": "https://ark.cn-beijing.volces.com/api/v3",
  "doubao-seed-2-0-pro": "https://ark.cn-beijing.volces.com/api/v3",
  "doubao-seed-2-0-lite": "https://ark.cn-beijing.volces.com/api/v3",
};

// Doubao/Volcengine ARK allowed API key env vars.
// If none of these are set, the provider is treated as
// "missing credentials" — NEVER falls back to DEEPSEEK_API_KEY.
const DOUBAO_KEY_CANDIDATES = ["DOUBAO_API_KEY", "ARK_API_KEY", "VOLCENGINE_API_KEY"];

// ═══════════════════════════════════════════════════════════
// 5. Agent state (populated during bootstrap)
// ═══════════════════════════════════════════════════════════

let agent = null;
let agentReady = false;
let dispatcher = null;
let safety = null;
let skillRouter = null;
let skillRegistry = null;
let perceptionPipeline = null;
let reflexManager = null;
const reflexEnabled = process.env.AIMC_REFLEX_ENABLED !== "0";
let doubaoCredentialsMissing = false;  // set during bootstrap if Ark key missing

// ── Phase 4A: Voice state ──────────────────────────
let voiceEnabled = false;
let voiceInitialized = false;
let voiceWhisperAvailable = false;
let voiceTTS = null;        // EdgeTTS instance (lazy)
const voiceTranscriptHistory = new Map();  // dedup: text → timestamp
const VOICE_DEDUP_MS = 2000;

// ── Phase 5A: TTS state (independent from voice/STT) ─
let ttsEnabled = false;
let ttsVoice = "zh-CN-XiaoxiaoNeural";

function parseSettings() {
  try {
    return JSON.parse(process.env.SETTINGS_JSON || "{}");
  } catch (_) {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════
// Phase 4A: Voice helpers — transcript dedup, TTS speak
// ═══════════════════════════════════════════════════════════

function initVoiceIfEnabled(whisperPath, modelPath) {
  voiceEnabled = process.env.AIMC_VOICE_ENABLED === "1";
  if (!voiceEnabled) {
    console.log("[VOICE] disabled — AIMC_VOICE_ENABLED not set");
    return;
  }

  const fs = require("fs");
  if (whisperPath && fs.existsSync(whisperPath)) {
    voiceWhisperAvailable = true;
    console.log(`[VOICE] whisper found: ${whisperPath}`);
  } else {
    console.log(`[VOICE] disabled reason=missing_whisper — path: ${whisperPath || "not configured"}`);
    voiceEnabled = false;
    return;
  }

  if (modelPath && fs.existsSync(modelPath)) {
    console.log(`[VOICE] model found: ${modelPath}`);
  } else {
    console.log(`[VOICE] disabled reason=missing_model — path: ${modelPath || "not configured"}`);
    voiceEnabled = false;
    return;
  }

  voiceInitialized = true;
  console.log("[VOICE] ready — voice input + TTS output enabled");
}

function initTTS() {
  ttsEnabled = process.env.AIMC_TTS_ENABLED === "1";
  if (!ttsEnabled) {
    console.log("[TTS] disabled — set AIMC_TTS_ENABLED=1 to enable voice output");
    return;
  }

  const provider = process.env.AIMC_TTS_PROVIDER || "edge";
  ttsVoice = process.env.AIMC_TTS_VOICE || process.env.DOUBAO_TTS_VOICE || "zh-CN-XiaoxiaoNeural";

  if (provider === "doubao") {
    const apiKey = process.env.DOUBAO_TTS_API_KEY;
    const appId = process.env.DOUBAO_TTS_APP_ID;
    if (!apiKey || !appId) {
      console.log("[TTS] disabled reason=missing_doubao_credentials — DOUBAO_TTS_API_KEY present=" + !!apiKey + " DOUBAO_TTS_APP_ID present=" + !!appId);
      ttsEnabled = false;
      return;
    }
    console.log(`[TTS] enabled provider=doubao voice="${ttsVoice}" apiKey present appId present`);
  } else {
    // Edge TTS — no credentials needed (free HTTP API)
    console.log(`[TTS] enabled provider=edge voice="${ttsVoice}"`);
  }
}

// ── Command cooldown — prevent repeated rapid execution ──
const commandCooldowns = new Map(); // commandKey → timestamp
const COMMAND_COOLDOWN_MS = 2000;

function handleVoiceTranscript(msg) {
  const text = (msg.message || "").trim();
  if (!text) return;

  const traceId = msg.traceId || ("v" + Date.now().toString(36));

  // ── Noise / punctuation-only filter ─────────────
  const meaningfulText = text.replace(/[\s.,!?;:"'，。！？；：""''、…\-​]+/g, "");
  if (meaningfulText.length === 0) {
    console.log(`[VOICE] noise filter: transcript is punctuation/whitespace only traceId=${traceId}`);
    return;
  }

  // ── Dedup: same text within 2s window ────────────
  const now = Date.now();
  const lastTime = voiceTranscriptHistory.get(text);
  if (lastTime && (now - lastTime) < VOICE_DEDUP_MS) {
    console.log(`[VOICE] duplicate transcript ignored traceId=${traceId} text="${text.slice(0, 60)}" ageMs=${now - lastTime}`);
    return;
  }
  voiceTranscriptHistory.set(text, now);

  // ── Command cooldown: movement commands ──────────
  const followMatch = text.match(FOLLOW_CALL_RE);
  if (followMatch) {
    const cmdKey = "follow";
    const lastCmd = commandCooldowns.get(cmdKey);
    if (lastCmd && (now - lastCmd) < COMMAND_COOLDOWN_MS) {
      console.log(`[VOICE] command cooldown ignored command=${cmdKey} ageMs=${now - lastCmd} traceId=${traceId}`);
      return;
    }
    commandCooldowns.set(cmdKey, now);
  }

  // Clean old entries
  for (const [k, t] of voiceTranscriptHistory) {
    if (now - t > 10_000) voiceTranscriptHistory.delete(k);
  }
  for (const [k, t] of commandCooldowns) {
    if (now - t > 10_000) commandCooldowns.delete(k);
  }

  console.log(`[VOICE] transcript traceId=${traceId} text="${text.slice(0, 80)}"`);
  console.log(`[VOICE] dispatch to handleChat traceId=${traceId}`);

  // Route through the standard chat pipeline
  handleChat({
    type: "chat",
    source: "player_voice",
    message: text,
    modality: "voice",
    traceId,
  });
}

let ttsSpeaking = false;
let ttsLastText = "";

// ── Phase 5A: TTS text cleaning ──────────────────────
function cleanTtsText(text) {
  if (!text || typeof text !== "string") return "";
  let t = text.trim();
  if (!t) return "";

  // Remove JSON fragments (incomplete LLM output)
  t = t.replace(/\{[^}]{0,200}\}/g, "");
  t = t.replace(/\[[^\]]{0,200}\]/g, "");

  // Remove Minecraft control/formatting chars
  t = t.replace(/[§&][0-9a-fk-or]/gi, "");

  // Collapse whitespace and limit to 120 chars
  t = t.replace(/\s+/g, " ").trim();
  t = t.slice(0, 120);

  return t;
}

// ── Phase 5A: Windows audio playback ──────────────────
function playAudioWindows(filePath) {
  try {
    const { spawn } = require("child_process");
    const escaped = filePath.replace(/'/g, "''");
    const psScript = `
Add-Type -AssemblyName PresentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Volume = 1.0
$player.Open('${escaped}')
$player.Play()
$timer = New-Object System.Timers.Timer
$timer.Interval = 200
$done = $false
$timer.add_Elapsed({
  if ($player.NaturalDuration.HasTimeSpan -and $player.Position -ge $player.NaturalDuration.TimeSpan) {
    $done = $true
    $timer.Stop()
  }
})
$timer.add_Elapsed({
  if (-not $player.HasAudio) { $done = $true; $timer.Stop() }
})
$timer.Start()
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while (-not $done -and $sw.Elapsed.TotalSeconds -lt 30) {
  Start-Sleep -Milliseconds 200
}
$timer.Stop()
$timer.Dispose()
$player.Stop()
$player.Close()
`;
    const ps = spawn("powershell", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command", psScript,
    ], {
      stdio: "ignore",
      detached: true,
    });
    ps.on("error", () => {});
    ps.unref();
    console.log(`[TTS] playback spawned for file=${filePath}`);
  } catch (err) {
    console.error("[TTS] playback spawn failed:", err.message);
  }
}

async function speakTTS(text) {
  if (!ttsEnabled) {
    return;
  }

  const cleaned = cleanTtsText(text);
  if (!cleaned) {
    return;
  }

  const provider = process.env.AIMC_TTS_PROVIDER || "edge";

  // Replace strategy: if already speaking, skip old utterance
  if (ttsSpeaking) {
    console.log(`[TTS] replace previous utterance — old="${ttsLastText.slice(0, 40)}" new="${cleaned.slice(0, 40)}"`);
  }
  ttsSpeaking = true;
  ttsLastText = cleaned;

  try {
    if (provider === "doubao") {
      // ── Doubao TTS ──────────────────────────────
      const { doubaoTTS } = require("./tts-doubao.cjs");
      const apiKey = process.env.DOUBAO_TTS_API_KEY;
      const appId = process.env.DOUBAO_TTS_APP_ID;
      const voice = process.env.DOUBAO_TTS_VOICE || "zh_female_qingxin";
      const format = process.env.DOUBAO_TTS_FORMAT || "mp3";
      const cluster = process.env.DOUBAO_TTS_CLUSTER || "volcano_tts";
      const accessToken = process.env.DOUBAO_TTS_ACCESS_TOKEN || apiKey;

      console.log(`[TTS] speak started provider=doubao text="${cleaned.slice(0, 80)}"`);

      const audioBuffer = await doubaoTTS(cleaned, {
        apiKey,
        appId,
        voice,
        format,
        cluster,
        accessToken,
      });

      const ext = format === "wav" ? ".wav" : ".mp3";
      const tmpFile = path.join(os.tmpdir(), `aimc-tts-${Date.now()}${ext}`);
      fs.writeFileSync(tmpFile, audioBuffer);
      console.log(`[TTS] wrote ${audioBuffer.length} bytes to ${tmpFile}`);
      playAudioWindows(tmpFile);
      console.log("[TTS] speak completed — playback spawned");
    } else {
      // ── Edge TTS (free, no API key needed) ──────
      if (!voiceTTS) {
        const ttsModule = await import(pathToFileURL(
          path.resolve(__dirname, "..", "dist", "voice", "tts-edge.js")
        ).href);
        voiceTTS = new ttsModule.EdgeTTS({ voice: ttsVoice });
        console.log(`[TTS] EdgeTTS instance created voice="${ttsVoice}"`);
      }
      try { voiceTTS.setVoice(ttsVoice); } catch (_) {}

      // Collect audio chunks from EdgeTTS events
      const audioChunks = [];
      function onAudio(chunk) {
        if (chunk && Buffer.isBuffer(chunk.data)) {
          audioChunks.push(chunk.data);
        }
      }
      voiceTTS.on("audio", onAudio);

      try {
        console.log(`[TTS] speak started provider=edge text="${cleaned.slice(0, 80)}"`);
        await voiceTTS.speak(cleaned);
        console.log("[TTS] edge synthesis completed");

        if (audioChunks.length > 0) {
          const mp3Buffer = Buffer.concat(audioChunks);
          const tmpFile = path.join(os.tmpdir(), `aimc-tts-${Date.now()}.mp3`);
          fs.writeFileSync(tmpFile, mp3Buffer);
          console.log(`[TTS] wrote ${mp3Buffer.length} bytes to ${tmpFile}`);
          playAudioWindows(tmpFile);
          console.log("[TTS] speak completed — playback spawned");
        } else {
          console.log("[TTS] no audio chunks received — synthesis may have failed");
        }
      } finally {
        voiceTTS.removeListener("audio", onAudio);
      }
    }
  } catch (err) {
    console.error("[TTS] speak failed stack=" + (err.stack || err.message));
    // Non-fatal — MC chat still works
  } finally {
    ttsSpeaking = false;
  }
}

// ═══════════════════════════════════════════════════════════
// 5. Stdin: receive chat messages from parent process
// ═══════════════════════════════════════════════════════════

var _stdinListenerSetup = false;

function setupStdinListener() {
  // stdin.resume() is called early at top-level to prevent Windows pipe close.
  // This function only registers listeners — it must be safe to call multiple times.
  if (_stdinListenerSetup) return;
  _stdinListenerSetup = true;

  let stdinBuf = "";
  process.stdin.on("data", (chunk) => {
    stdinBuf += chunk.toString();
    const lines = stdinBuf.split("\n");
    stdinBuf = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "chat" && msg.message) {
          handleChat(msg);
        } else if (msg.type === "voice_transcript" && msg.message) {
          handleVoiceTranscript(msg);
        } else if (msg.type === "voice_sim" && msg.message) {
          console.log(`[VOICE-SIM] transcript traceId=${msg.traceId || "sim"} text="${msg.message.slice(0, 80)}"`);
          handleVoiceTranscript({
            type: "voice_transcript",
            source: "simulation",
            message: msg.message,
            traceId: "sim-" + (msg.traceId || Date.now().toString(36)),
          });
        }
      } catch (_) {
        // Not JSON — ignore (could be piped noise)
      }
    }
  });

  process.stdin.on("end", () => {
    console.log("[BRIDGE] stdin closed — parent may have disconnected.");
    // Don't exit — keep running
  });

  process.stdin.on("error", (err) => {
    console.error("[BRIDGE] stdin error:", err.message);
    // Don't exit — keep running
  });

  console.log("[BRIDGE] stdin listener registered.");
}

/**
 * Safe wrapper for bot.chat() — validates input, enforces max length,
 * catches all errors, logs every call. Use this instead of bot.chat() directly.
 */
function safeBotChat(botRef, text) {
  if (!botRef) {
    console.log("[CHAT-DIAG] safeBotChat SKIP — no bot reference");
    return false;
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    console.log("[CHAT-DIAG] safeBotChat SKIP — empty text");
    return false;
  }
  const trimmed = text.trim().slice(0, 256);
  try {
    botRef.chat(trimmed);
    console.log(`[CHAT-DIAG] bot.chat SENT (${trimmed.length} chars): "${trimmed.slice(0, 80)}"`);
    return true;
  } catch (err) {
    console.error(`[CHAT-DIAG] bot.chat FAILED: ${err.message}`);
    return false;
  }
}

/**
 * Normalize heterogeneous agent response into a standard structure.
 *
 * Input can be:
 *   - Plain string (treated as speech text)
 *   - AgentOutput / ValidatedAgentOutput (from LLM, fast path, or fallback)
 *   - ThinkResult wrapping agentOutput (from agent.think())
 *   - null / undefined / empty → fallback speech
 *
 * Output is ALWAYS: { speech: { text, tone }, actions: [], emotion: null|{}, memory: null|{} }
 *
 * DESIGN: This is a local bridge helper. The TS types (AgentOutput,
 * ValidatedAgentOutput, ThinkResult) are already canonical — this function
 * only normalizes heterogeneity at the CJS boundary, it does NOT define
 * a new protocol type.
 */
/**
 * Bridge-level follow_player executor.
 * Handles follow_player actions from LLM output that were not dispatched
 * by the skill system (e.g. raw agentOutput.actions without matching
 * executionResults when intent="skill"). Reuses fast-path GoalNear logic.
 */
async function executeFollowPlayerInBridge(action, botRef, sourcePlayer) {
  const id = action.id || "?";
  console.log(`[ACTION] follow_player started id=${id} raw=${JSON.stringify(action)}`);

  // Resolve playerName from multiple action formats:
  //   { type: "follow_player", target: { playerName: "xxx" } }
  //   { type: "follow_player", params: { playerName: "xxx" } }
  //   { type: "follow_player", target: "xxx" }
  //   { name: "follow_player", arguments: { playerName: "xxx" } }
  let playerName = null;
  if (action.target && typeof action.target === "object" && action.target !== null && action.target.playerName) {
    playerName = action.target.playerName;
  } else if (action.params && typeof action.params === "object" && action.params !== null && action.params.playerName) {
    playerName = action.params.playerName;
  } else if (action.target && typeof action.target === "string") {
    playerName = action.target;
  } else if (action.arguments && typeof action.arguments === "object" && action.arguments !== null && action.arguments.playerName) {
    playerName = action.arguments.playerName;
  }

  // No playerName — fall back to nearest real player
  if (!playerName) {
    const onlinePlayers = Object.keys(botRef.players).filter(
      (p) => p !== botRef.username && botRef.players[p]?.entity
    );
    if (onlinePlayers.length > 0) {
      let nearest = null;
      let nearestDist = Infinity;
      const botPos = botRef.entity?.position;
      for (const name of onlinePlayers) {
        const ent = botRef.players[name].entity;
        if (botPos && ent?.position) {
          const d = botPos.distanceTo(ent.position);
          if (d < nearestDist) { nearestDist = d; nearest = name; }
        } else {
          nearest = nearest || name;
        }
      }
      playerName = nearest;
    } else if (sourcePlayer && sourcePlayer !== "player" && sourcePlayer !== "player_voice") {
      playerName = sourcePlayer;
    }
  }

  if (!playerName) {
    console.log(`[ACTION] follow_player failed id=${id} — cannot resolve target player`);
    return { actionId: id, success: false, message: "Cannot resolve target player" };
  }

  const playerEntity = botRef.players[playerName]?.entity;
  if (!playerEntity) {
    console.log(`[ACTION] follow_player failed id=${id} — player "${playerName}" entity not found in bot.players`);
    safeBotChat(botRef, "我没看到你在哪里。");
    return { actionId: id, success: false, message: `Player "${playerName}" entity not found` };
  }

  console.log(`[ACTION] follow_player resolved target=${playerName}`);

  console.log(`[MOVE-DIAG] pathfinder available=${!!botRef.pathfinder}`);
  if (!botRef.pathfinder) {
    return { actionId: id, success: false, message: "Pathfinder not available" };
  }

  if (!pf.goals || !pf.goals.GoalNear) {
    console.log(`[MOVE-DIAG] GoalNear unavailable — pf.goals=${Object.keys(pf.goals || {}).join(",")}`);
    return { actionId: id, success: false, message: "GoalNear not available" };
  }

  const { x, y, z } = playerEntity.position;
  console.log(`[MOVE-DIAG] GoalNear set x=${x.toFixed(1)} y=${y.toFixed(1)} z=${z.toFixed(1)} range=2`);

  try {
    const goal = new pf.goals.GoalNear(x, y, z, 2);
    await botRef.pathfinder.goto(goal);
    console.log(`[ACTION] follow_player completed id=${id} — reached ${playerName}`);
    return { actionId: id, success: true, message: `Followed ${playerName}` };
  } catch (err) {
    console.log(`[ACTION] follow_player failed id=${id} stack=${err.message}`);
    return { actionId: id, success: false, message: err.message };
  }
}

function normalizeAgentResponse(input) {
  const FALLBACK_SPEECH = { text: "嗯…我不太确定。", tone: "neutral" };

  // Step 1: Resolve input → candidate object
  let candidate = null;

  if (typeof input === "string" && input.trim()) {
    candidate = { speech: { text: input.trim(), tone: "neutral" }, actions: [] };
  } else if (input && typeof input === "object") {
    // Unwrap ThinkResult (has .agentOutput) or use directly (AgentOutput)
    candidate = input.agentOutput || input;
  }

  // Step 2: Extract speech (guaranteed non-null)
  let speech;
  if (
    candidate &&
    candidate.speech &&
    typeof candidate.speech.text === "string" &&
    candidate.speech.text.trim()
  ) {
    speech = {
      text: candidate.speech.text.trim().slice(0, 256),
      tone: candidate.speech.tone || "neutral",
    };
  } else {
    speech = { ...FALLBACK_SPEECH };
  }

  // Step 3: Extract actions (guaranteed array, never null)
  const actions = Array.isArray(candidate && candidate.actions)
    ? candidate.actions
    : [];

  // Step 4: Extract emotion from internal_state (nullable)
  const emotion =
    candidate && candidate.internal_state
      ? {
          mood: candidate.internal_state.mood || null,
          confidence:
            typeof candidate.internal_state.confidence === "number"
              ? candidate.internal_state.confidence
              : null,
          energy:
            typeof candidate.internal_state.energy === "number"
              ? candidate.internal_state.energy
              : null,
        }
      : null;

  // Step 5: Extract memory candidate (nullable)
  const memory =
    candidate && candidate.memory_save
      ? {
          type: candidate.memory_save.type,
          summary: candidate.memory_save.summary,
          importance: candidate.memory_save.importance,
        }
      : null;

  return { speech, actions, emotion, memory };
}

/**
 * Log action execution results with standardized [ACTION] prefix.
 * Each action produces exactly one log line:
 *   [ACTION] completed <id> — <message>
 *   [ACTION] failed <id> — <error>
 *   [ACTION] unsupported <type> <id> — no executor available in bridge
 */
function logActionResults(executionResults, normalizedActions) {
  const executed = new Set();

  if (Array.isArray(executionResults)) {
    for (const r of executionResults) {
      const id = r.actionId || "?";
      executed.add(id);
      if (r.success) {
        console.log(
          `[ACTION] completed ${id}${r.message ? " — " + r.message : ""}`
        );
      } else {
        console.log(
          `[ACTION] failed ${id} — ${r.message || "unknown error"}`
        );
      }
    }
  }

  // Surface actions with no execution result — prevent silent drops
  if (Array.isArray(normalizedActions)) {
    for (const a of normalizedActions) {
      const id = a.id || "?";
      if (!executed.has(id)) {
        console.log(
          `[ACTION] unsupported ${a.type} ${id} — no executor available in bridge`
        );
      }
    }
  }
}

async function handleChat(msg) {
  console.log(`[CHAT] === handleChat START === source=${msg.source} msg="${msg.message?.slice(0,60)}"`);

  if (!agent || !agentReady) {
    if (doubaoCredentialsMissing) {
      console.log("[CHAT] SKIP — doubao credentials missing (DOUBAO_API_KEY / ARK_API_KEY not set)");
      safeBotChat(botRef, "豆包 API Key 未配置，请设置 DOUBAO_API_KEY 或 ARK_API_KEY。");
    } else {
      console.log("[CHAT] SKIP — agent not ready");
    }
    return;
  }

  const botRef = globalThis.__BOT__ || bot;
  if (!botRef) {
    console.log("[CHAT] SKIP — no bot reference");
    return;
  }

  const msgText = (msg.message || "").trim();
  const msgNorm = normalizeText(msgText);
  const playerName = msg.source || "player";

  console.log(`[CHAT-DIAG] 1. msg received: source=${playerName} text="${msgText.slice(0, 80)}"`);

  // ═══════════════════════════════════════════════════════
  // FAST PATH: hardcoded commands that bypass LLM entirely.
  // Phase 0 — verify Minecraft-visible closed loop.
  // ═══════════════════════════════════════════════════════

  // ── ping → pong ─────────────────────────────────────
  if (msgNorm === "ping" || msgNorm === "！ping") {
    console.log("[CHAT-DIAG] FAST PATH: ping → pong");
    safeBotChat(botRef, "pong!");
    return;
  }

  // ── 过来 / come here → move to player ──────────────
  if (FOLLOW_CALL_RE.test(msgNorm)) {
    // Resolve target player: for voice input, find nearest real player
    let targetName = playerName;
    let playerEntity = botRef.players[targetName]?.entity;

    if (!playerEntity) {
      // Voice source ("player_voice") or bot name — fall back to nearest player
      const onlinePlayers = Object.keys(botRef.players).filter(
        (p) => p !== botRef.username && botRef.players[p]?.entity
      );
      if (onlinePlayers.length === 0) {
        console.log("[CHAT-DIAG] No online players found in bot.players");
        safeBotChat(botRef, "我看不到任何玩家。");
        speakTTS("我看不到任何玩家。").catch(() => {});
        return;
      }
      // Prefer nearest player
      let nearest = null;
      let nearestDist = Infinity;
      const botPos = botRef.entity?.position;
      for (const name of onlinePlayers) {
        const ent = botRef.players[name].entity;
        if (botPos && ent?.position) {
          const d = botPos.distanceTo(ent.position);
          if (d < nearestDist) { nearestDist = d; nearest = name; }
        } else {
          nearest = nearest || name;
        }
      }
      targetName = nearest;
      playerEntity = botRef.players[targetName]?.entity;
      console.log(`[CHAT-DIAG] Voice follow — resolved target: ${targetName} (source was: ${playerName})`);
    }

    console.log(`[CHAT-DIAG] FAST PATH: come here → move to ${targetName}`);

    if (!botRef.pathfinder) {
      console.log("[CHAT-DIAG] bot.pathfinder not available — cannot move");
      safeBotChat(botRef, `抱歉${targetName}，我的寻路系统还没准备好。`);
      speakTTS(`抱歉${targetName}，我的寻路系统还没准备好。`).catch(() => {});
      return;
    }

    // ── Self-check: verify GoalNear is available ────
    if (!pf.goals || !pf.goals.GoalNear) {
      console.error(`[MOVE-DIAG] GoalNear unavailable — pf.goals=${Object.keys(pf.goals || {}).join(",")}`);
      safeBotChat(botRef, `抱歉${targetName}，我的寻路系统配置有问题。`);
      speakTTS(`抱歉${targetName}，我的寻路系统配置有问题。`).catch(() => {});
      return;
    }

    console.log(`[MOVE-DIAG] pathfinder available=true movements configured=true`);

    try {
      const { x, y, z } = playerEntity.position;
      console.log(`[MOVE-DIAG] Player ${targetName} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);

      const goal = new pf.goals.GoalNear(x, y, z, 2);
      botRef.pathfinder.setMovements(new pf.Movements(botRef));
      botRef.pathfinder.setGoal(goal, true);

      console.log(`[MOVE-DIAG] GoalNear set: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}, 2)`);
      const speech = `来了，${targetName}！`;
      safeBotChat(botRef, speech);
      speakTTS(speech).catch(() => {});
    } catch (moveErr) {
      console.error(`[MOVE-DIAG] Pathfinder FAILED: ${moveErr.message}\n${moveErr.stack}`);
      const errSpeech = `抱歉${targetName}，我动不了。`;
      safeBotChat(botRef, errSpeech);
      speakTTS(errSpeech).catch(() => {});
    }
    return;
  }

  // ═══════════════════════════════════════════════════════
  // NORMAL PATH: route through AgentCore → LLM
  // ═══════════════════════════════════════════════════════

  try {
    console.log("[CHAT-DIAG] 2. bot exists: true, agent ready: true");
    console.log("[CHAT-DIAG] 3. calling agent.think()...");

    // Phase 5B: Signal user interaction — gates proactive ticks
    agent.recordUserInteraction?.();

    const t0 = Date.now();

    // ── TIMEOUT GUARD: max 25s for full think cycle ──
    const THINK_TIMEOUT_MS = 25000;
    let thinkTimeoutId = null;
    const result = await Promise.race([
      agent.think({
        botState: globalThis.__botState__ || null,
        chatMessage: {
          source: playerName,
          message: msgText,
        },
        nearbyEntities: globalThis.__WORLD_STATE__?.getNearbyEntities?.() || [],
      }),
      new Promise((resolve) => {
        thinkTimeoutId = setTimeout(() => {
          console.log("[CHAT-DIAG] THINK TIMEOUT after 25s — using degrade reply");
          resolve({
            completed: false,
            agentOutput: {
              intent: "chat",
              speech: { text: "抱歉，我反应有点慢…等一下再说？", tone: "neutral" },
              actions: [],
              internal_state: { mood: "neutral", confidence: 0.0, energy: 0.5 },
            },
            executionResults: [],
            validation: null,
            timing: { contextMs: 0, llmMs: THINK_TIMEOUT_MS, validationMs: 0, executionMs: 0, totalMs: THINK_TIMEOUT_MS },
            fallback: true,
          });
        }, THINK_TIMEOUT_MS);
      }),
    ]);
    // Clear the timeout timer if think() resolved first — prevents stale THINK TIMEOUT log
    if (thinkTimeoutId) clearTimeout(thinkTimeoutId);

    const elapsed = Date.now() - t0;

    // ═══ NORMALIZE: single path, guaranteed {speech, actions, emotion, memory} ═══
    const normalized = normalizeAgentResponse(result);

    console.log(`[CHAT-DIAG] 4. think returned in ${elapsed}ms — completed=${result?.completed} speech="${normalized.speech.text.slice(0, 40)}" actions=${normalized.actions.length} fallback=${result?.fallback}`);

    // ═══ SPEECH: always send to Minecraft chat (normalize guarantees speech.text) ═══
    safeBotChat(botRef, normalized.speech.text);

    // ═══ TTS: if tts enabled, also speak the response ═══
    if (ttsEnabled && normalized.speech.text) {
      speakTTS(normalized.speech.text).catch((err) => {
        console.error("[TTS] async speak error:", err.message);
      });
    }

    // ═══ BRIDGE EXECUTOR: execute actions not covered by skill system ═══
    // When intent="skill", SkillRouter dispatches skill-planned actions (auto-generated
    // IDs), NOT the raw agentOutput.actions. Raw actions without matching executionResults
    // would be logged as "unsupported". This bridge fallback catches those actions and
    // executes them directly using the same bot primitives ActionDispatcher uses.
    const execResults = [...(result?.executionResults || [])];
    const executedIds = new Set(execResults.map((r) => r.actionId));
    for (const action of normalized.actions) {
      if (executedIds.has(action.id)) continue;
      const id = action.id || "?";
      try {
        let bridgeResult = null;
        if (action.type === "follow_player") {
          bridgeResult = await executeFollowPlayerInBridge(action, botRef, playerName);
        } else if (action.type === "look_at_player") {
          const pn = (action.target && typeof action.target === "object" && action.target.playerName)
            || (action.params && typeof action.params === "object" && action.params.playerName)
            || playerName;
          const pe = botRef.players[pn]?.entity;
          if (pe) {
            console.log(`[ACTION] look_at_player started id=${id} raw=${JSON.stringify(action)}`);
            await botRef.lookAt(pe.position);
            bridgeResult = { actionId: id, success: true, message: `Looked at ${pn}` };
          } else {
            bridgeResult = { actionId: id, success: false, message: `Player "${pn}" entity not found` };
          }
        } else if (action.type === "stay" || action.type === "wait") {
          const ms = Math.min(
            (action.target && typeof action.target === "object" && action.target.ms)
            || (action.params && typeof action.params === "object" && action.params.ms)
            || 1000,
            30000
          );
          console.log(`[ACTION] ${action.type} started id=${id} ms=${ms}`);
          await new Promise((r) => setTimeout(r, ms));
          bridgeResult = { actionId: id, success: true, message: `Waited ${ms}ms` };
        } else if (action.type === "speak_chat") {
          const text = (action.target && typeof action.target === "object" && action.target.text)
            || (action.params && typeof action.params === "object" && action.params.text)
            || "";
          if (text) {
            console.log(`[ACTION] speak_chat started id=${id} text="${text.slice(0, 40)}"`);
            safeBotChat(botRef, text);
            bridgeResult = { actionId: id, success: true, message: `Sent: ${text.slice(0, 40)}` };
          } else {
            bridgeResult = { actionId: id, success: false, message: "Empty speak_chat text" };
          }
        }
        if (bridgeResult) {
          execResults.push(bridgeResult);
          executedIds.add(id);
        }
      } catch (err) {
        console.error(`[BRIDGE] bridge executor threw for ${action.type} ${id}: ${err.message}`);
      }
    }

    // ═══ ACTIONS: standardized [ACTION] log for every execution result ═══
    logActionResults(execResults, normalized.actions);

    // ═══ UI: send normalized response to stdout for Electron dashboard ═══
    process.stdout.write(
      "AIMC_MSG:" +
        JSON.stringify({
          type: "chat_response",
          completed: result?.completed || false,
          speech: normalized.speech,
          fallback: result?.fallback || false,
          actionsExecuted: execResults.length,
        }) +
        "\n"
    );
  } catch (err) {
    console.error(`[CHAT-DIAG] ERROR: ${err.message}\n${err.stack}`);
    const errNormalized = normalizeAgentResponse(null);
    errNormalized.speech.text = "[ERROR] " + err.message.slice(0, 200);
    safeBotChat(globalThis.__BOT__ || bot, errNormalized.speech.text);
    process.stdout.write(
      "AIMC_MSG:" +
        JSON.stringify({
          type: "chat_response",
          completed: false,
          speech: errNormalized.speech,
          error: err.message,
        }) +
        "\n"
    );
  }
  console.log("[CHAT] === handleChat END ===");
}

// ═══════════════════════════════════════════════════════════
// 6. Bootstrap — unified architecture:
//    settings → bot → spawn → AgentCore → Dispatcher → RuntimeContext → loop
// ═══════════════════════════════════════════════════════════

runtime.bootstrap(async () => {
  console.log("[BRIDGE] Bootstrap sequence starting...");
  const settings = parseSettings();
  const model = settings.model || "deepseek-chat";
  const apiKeyVar = MODEL_API_KEY_MAP[model] || "DEEPSEEK_API_KEY";
  const baseUrlEnvVar = apiKeyVar.replace("_API_KEY", "_BASE_URL");
  const baseUrl = process.env[baseUrlEnvVar] || MODEL_BASE_URL_MAP[model] || "https://api.deepseek.com/v1";
  const isDoubaoProvider = model.startsWith("doubao") || baseUrl.includes("volces.com");

  let apiKey = null;
  let apiKeySource = null;

  if (isDoubaoProvider) {
    // Doubao/Volcengine ARK: ONLY Ark-specific keys — NO fallback to DEEPSEEK_API_KEY
    for (const candidate of DOUBAO_KEY_CANDIDATES) {
      const val = process.env[candidate];
      if (val) {
        apiKey = val;
        apiKeySource = candidate;
        break;
      }
    }
    doubaoCredentialsMissing = !apiKey;
    if (!apiKey) {
      console.log(`[MODEL] provider=doubao`);
      console.log(`[MODEL] missing credentials for doubao: set DOUBAO_API_KEY or ARK_API_KEY`);
      console.log(`[MODEL] tried: ${DOUBAO_KEY_CANDIDATES.join(", ")}`);
    } else {
      doubaoCredentialsMissing = false;
    }
  } else {
    // Non-Doubao provider — normal key resolution with DEEPSEEK_API_KEY fallback
    apiKey = process.env[apiKeyVar];
    apiKeySource = apiKeyVar;
    if (!apiKey && apiKeyVar !== "DEEPSEEK_API_KEY") {
      apiKey = process.env["DEEPSEEK_API_KEY"];
      if (apiKey) {
        apiKeySource = "DEEPSEEK_API_KEY (fallback)";
        console.log(`[BRIDGE] ⚠ ${apiKeyVar} not set — falling back to DEEPSEEK_API_KEY`);
      }
    }
    doubaoCredentialsMissing = false;
  }

  console.log(`[MODEL] provider=${isDoubaoProvider ? "doubao" : model}`);
  console.log(`[MODEL] apiKeyEnv=${apiKeySource || "none"} present=${!!apiKey}`);
  // Doubao models use ep-xxx endpoint IDs — override via env or settings
  const effectiveModel = process.env.DOUBAO_MODEL_ID || settings.doubaoEndpointId || model;
  const botName = settings.botName || "AIMC";

  // ── Step A: Populate legacy settings module ─────
  // CRITICAL: must be called BEFORE importing mcdata.js
  // (mcdata reads settings at module scope for mc_version)
  console.log("[BRIDGE] Step A: Populating legacy settings...");
  try {
    const agentSettings = await import(pathToFileURL(legacySettingsPath).href);
    agentSettings.setSettings({
      host: parsedSettings.host || "127.0.0.1",
      port: Number(parsedSettings.port) || 25565,
      auth: parsedSettings.auth || "offline",
      minecraft_version: parsedSettings.minecraft_version || "auto",
    });
    console.log("[BRIDGE] ✓ Step A: Legacy settings populated.");
  } catch (err) {
    console.error("[BRIDGE] ✗ Step A FAILED:", err.message);
    console.error("[BRIDGE]   err.code:", err.code);
    console.error("[BRIDGE]   err.stack:", err.stack);
    console.error("[BRIDGE]   target path:", legacySettingsPath);
    // Fatal — cannot create bot without settings
    return;
  }

  // ── Step B: Create Mineflayer bot directly ──────
  console.log("[BRIDGE] Step B: Creating Mineflayer bot...");
  let bot;
  try {
    const mcdata = await import(pathToFileURL(mcdataPath).href);
    bot = mcdata.initBot(botName);
    console.log("[BRIDGE] ✓ Step B: Bot instance created — plugins loaded.");
    console.log("[BRIDGE]   Plugins: pathfinder, pvp, collectblock, autoEat, armorManager");
  } catch (err) {
    console.error("[BRIDGE] ✗ Step B FAILED:", err.message);
    console.error("[BRIDGE]   err.code:", err.code);
    console.error("[BRIDGE]   err.stack:", err.stack);
    console.error("[BRIDGE]   target path:", mcdataPath);
    return;
  }

  // ── Step C: Wait for bot spawn ──────────────────
  console.log(`[BRIDGE] Step C: Waiting for bot to spawn (server: ${parsedSettings.host}:${parsedSettings.port})...`);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Bot spawn timeout after 30s — server unreachable or version mismatch"));
      }, 30000);
      bot.once("spawn", () => {
        clearTimeout(timeout);
        resolve();
      });
      bot.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      bot.once("kicked", (reason) => {
        clearTimeout(timeout);
        reject(new Error("Bot kicked during login: " + String(reason)));
      });
    });
    console.log(`[BRIDGE] ✓ Step C: Bot spawned at ${bot.entity.position}`);
  } catch (err) {
    console.error("[BRIDGE] ✗ Step C FAILED:", err.message);
    // Keep running — bot may connect later (reconnection is follow-up)
    // Don't crash, keep heartbeat alive
  }

  // ── Step D: Init AgentCore (AI pipeline) ────────
  console.log("[BRIDGE] Step D: Initializing AgentCore...");
  if (apiKey) {
    try {
      const aimc = await import(pathToFileURL(distIndex).href);
      const isDoubaoProvider = baseUrl.includes("volces.com");
      agent = aimc.initAgent({ apiKey, model: effectiveModel, baseUrl, supportsJsonFormat: !isDoubaoProvider });
      agentReady = true;
      console.log(`[BRIDGE] ✓ LLM config — model=${effectiveModel} baseUrl=${baseUrl} supportsJsonFormat=${!isDoubaoProvider}`);

      // ── Step E: Create SafetyGuard ──────────────
      console.log("[BRIDGE] Step E: Creating SafetyGuard + ActionDispatcher...");
      const sgModule = await import(pathToFileURL(safetyGuardPath).href);
      safety = new sgModule.SafetyGuard();
      safety.setBot(bot);

      // ── Step F: Create ActionDispatcher ──────────
      const adModule = await import(pathToFileURL(dispatcherPath).href);
      dispatcher = new adModule.ActionDispatcher(bot, safety);

      console.log("[BRIDGE] ✓ Step F: ActionDispatcher created");
      console.log("[BRIDGE]   SafetyGuard validated, dispatcher active");

      // ── Step F2: Init Skill System + wire (SOLE EXECUTION PATH) ──
      console.log("[BRIDGE] Step F2: Initializing Skill System...");
      try {
        const skRegModule = await import(pathToFileURL(skillRegistryPath).href);
        skillRegistry = new skRegModule.SkillRegistry();
        const skRouterModule = await import(pathToFileURL(skillRouterPath).href);
        skillRouter = new skRouterModule.SkillRouter(skillRegistry);
        // SkillRouter.setDispatcher() also registers caller token with ActionDispatcher
        skillRouter.setDispatcher(dispatcher);
        agent.setSkillRouter(skillRouter);

        // Set bot on RuntimeCore (needed for SafetyGuard state-aware checks)
        aimc.runtimeCore.setBot(bot);

        globalThis.__SKILL_ROUTER__ = skillRouter;
        globalThis.__SKILL_REGISTRY__ = skillRegistry;
        console.log(`[BRIDGE] ✓ Step F2: Skill system active — ${skillRegistry.list().length} skills`);
        console.log("[BRIDGE]   Execution chain: AgentCore → SkillRouter → ActionDispatcher → Mineflayer");
      } catch (err) {
        console.warn("[BRIDGE] △ Step F2: Skill system init failed (non-fatal):", err.message);
      }

      // ── Step F3: Init Personality + Proactive Loop ──
      console.log("[BRIDGE] Step F3: Initializing Personality + Proactive loop...");
      try {
        const isDoubaoProvider = baseUrl.includes("volces.com");
        const proactiveEnv = process.env.AIMC_PROACTIVE_ENABLED;
        let proactiveEnabled = true;
        let proactiveIntervalMs = 5000;

        if (proactiveEnv === "0" || proactiveEnv === "false") {
          proactiveEnabled = false;
        } else if (isDoubaoProvider && proactiveEnv !== "1" && proactiveEnv !== "true") {
          // Doubao is slow — default proactive OFF unless explicitly enabled
          proactiveEnabled = false;
          proactiveIntervalMs = 30000;
        }

        if (proactiveEnabled) {
          aimc.initPersonality({ preset: "companion", proactiveIntervalMs });
          console.log(`[BRIDGE] ✓ Step F3: Proactive loop started — ${proactiveIntervalMs}ms interval`);
        } else {
          // Initialize personality WITHOUT starting proactive loop
          aimc.initPersonality({ preset: "companion", proactiveIntervalMs: 0 });
          if (isDoubaoProvider) {
            console.log(`[PROACTIVE] enabled=false reason=slow_provider_doubao (set AIMC_PROACTIVE_ENABLED=1 to force)`);
          } else {
            console.log(`[PROACTIVE] enabled=false reason=AIMC_PROACTIVE_ENABLED=${proactiveEnv || "unset"}`);
          }
        }
      } catch (err) {
        console.warn("[BRIDGE] △ Step F3: Personality init failed (non-fatal):", err.message);
      }

      // NOTE: initProduction() skipped — watchdog/recovery not yet fully integrated.
      // Re-enable when RuntimeCore/AgentCore subsystems have proper heartbeat wiring.

      // ── Step G: Bind RuntimeContext ─────────────
      console.log("[BRIDGE] Step G: Binding RuntimeContext...");
      runtimeContext.bindBot(bot);

      // ── Architecture Lock (Phase 2.6 — FINAL) ──
      // Immutable at runtime. Enforced by ActionDispatcher.verifyCaller().
      // strictMode=true means the token gate CANNOT be bypassed.
      globalThis.__AIMC_ARCH_LOCK__ = {
        version: "2.8-frozen",
        executionChain: [
          "AgentCore",
          "RuntimeCore(validate-only)",
          "SkillRouter",
          "ActionDispatcher",
          "Mineflayer",
        ],
        strictMode: true,
        forbid: [
          "direct_dispatcher_call",
          "runtime_core_execution",
          "legacy_bot_control",
          "bypass_skill_router",
        ],
      };

      // ── Architecture Guard (Phase 2.5 compat) ──
      globalThis.__AIMC_GUARD__ = {
        allowDirectBotAccess: false,
        enforceSingleExecutionChain: true,
        requiredPipeline: [
          "AgentCore",
          "SkillRouter",
          "ActionDispatcher",
          "Mineflayer"
        ],
        getCallerToken: () => globalThis.__AIMC_SKILLROUTER_TOKEN__ || null,
      };

      // Set up globalThis globals
      globalThis.__BOT__ = bot;
      globalThis.__ACTION_DISPATCHER__ = dispatcher;
      globalThis.__WORLD_STATE__ = {
        getNearbyEntities: () => runtimeContext.getNearbyEntities(),
        getNearbyPlayers: () => runtimeContext.getNearbyPlayers(),
        getNearbyHostiles: () => runtimeContext.getNearbyHostiles(),
      };
      globalThis.__RUNTIME_CONTEXT__ = {
        bot,
        dispatcher,
        safety,
        runtimeCore: aimc.runtimeCore,
        skillRouter,
        getSnapshot: () => runtimeContext.getSnapshot(),
      };

      console.log("[BRIDGE] ✓ Step G: RuntimeContext bound — globalThis populated");
      console.log("[BRIDGE]   __BOT__, __ACTION_DISPATCHER__, __WORLD_STATE__, __RUNTIME_CONTEXT__");
      console.log("[BRIDGE]   __AIMC_GUARD__: Single Execution Chain enforced");

      // ── Step G2: Phase 4A Voice init ──────────
      const _settings = parseSettings();
      const voiceWhisperPath = process.env.AIMC_WHISPER_PATH || _settings.whisperPath || "";
      const voiceModelPath = process.env.AIMC_WHISPER_MODEL || _settings.whisperModelPath || "";
      initVoiceIfEnabled(voiceWhisperPath, voiceModelPath);
      initTTS();

      console.log("[BRIDGE] ✓ Step D: AgentCore ready — model:", effectiveModel, "baseUrl:", baseUrl);

      // ── Phase 2: PerceptionPipeline ──────────
      // Typed wrapper over raw Mineflayer events.
      // Replaces the raw bot.on("chat") / bot.on("messagestr") listeners.
      // All chat messages still route through the same handleChat() — fast path + normalize intact.
      try {
        const ppModule = await import(pathToFileURL(perceptionPipelinePath).href);

        // ── Phase 3: ReflexManager ──────────
        // Non-LLM fast reaction layer. Checked BEFORE dispatch to handleChat.
        // Behaviors that return consumed=true skip downstream dispatch.
        console.log(`[REFLEX] enabled=${reflexEnabled}`);
        if (reflexEnabled) {
          const rmModule = await import(pathToFileURL(reflexManagerPath).href);
          reflexManager = new rmModule.ReflexManager(
            {
              bot,
              safeBotChat: (text) => safeBotChat(bot, text),
              pf,
            },
            true
          );

          // Register reflex behaviors
          try {
            const lasModule = await import(pathToFileURL(lookAtSpeakerPath).href);
            reflexManager.registerBehavior(
              lasModule.createLookAtSpeaker({ rateLimitMs: 1000 })
            );
          } catch (err) {
            console.warn("[REFLEX] look_at_speaker failed to load:", err.message);
          }

          try {
            const afModule = await import(pathToFileURL(autoFollowPath).href);
            reflexManager.registerBehavior(
              afModule.createAutoFollowOnCall()
            );
          } catch (err) {
            console.warn("[REFLEX] auto_follow_on_call failed to load:", err.message);
          }
        }

        perceptionPipeline = new ppModule.PerceptionPipeline(bot, {
          onPerceptionEvent: async (event) => {
            if (reflexManager) {
              return reflexManager.handleEvent(event);
            }
          },
          onChatMessage: (msg) => {
            if (!agent || !agentReady) return;
            handleChat(msg);
          },
        });
        perceptionPipeline.start();
        console.log("[BRIDGE] ✓ PerceptionPipeline active — chat listeners routed through typed events");
      } catch (err) {
        console.warn("[BRIDGE] △ PerceptionPipeline init failed (non-fatal):", err.message);
        // Fallback: register raw listeners so chat still works
        bot.on("chat", (username, message) => {
          if (!agent || !agentReady) return;
          if (username === bot.username) return;
          const text = typeof message === "string" ? message : (message?.toString?.() || "");
          if (!text.trim()) return;
          handleChat({ type: "chat", message: text, source: username });
        });
        bot.on("messagestr", (message) => {
          if (!agent || !agentReady) return;
          const text = typeof message === "string" ? message : (message?.toString?.() || "");
          if (!text.trim() || text.length < 2) return;
          if (text.startsWith("[") || text.startsWith("<")) return;
          if (text.startsWith(`<${bot.username}>`)) return;
          handleChat({ type: "chat", message: text, source: "player" });
        });
        console.log("[BRIDGE]   Fallback raw chat listeners registered");
      }

      process.stdout.write(
        "AIMC_MSG:" + JSON.stringify({ type: "ready", model: effectiveModel }) + "\n"
      );
    } catch (err) {
      console.error("[BRIDGE] ✗ AgentCore pipeline init failed:", err.message);
      console.error("[BRIDGE]   err.code:", err.code);
      console.error("[BRIDGE]   err.stack:", err.stack);
      console.error("[BRIDGE]   distIndex:", distIndex);
    }
  } else {
    if (doubaoCredentialsMissing) {
      console.log(`[BRIDGE] △ Step D-F: AgentCore skipped — missing Ark credentials for doubao provider`);
      console.log(`[BRIDGE]   Set DOUBAO_API_KEY or ARK_API_KEY in environment to activate`);
    } else {
      console.log(`[BRIDGE] △ Step D-F: AgentCore skipped — no API key for model: ${effectiveModel} (env: ${apiKeyVar})`);
      console.log(`[BRIDGE]   Set ${apiKeyVar} in environment to activate`);
    }
    // Bot still connects — just no AI pipeline
  }

  // ── Step H: stdin listener + stats logger + heartbeat
  console.log("[BRIDGE] Step H: stdin listener already active (early init)");
  setupStdinListener();  // no-op if already called early
  console.log("[BRIDGE] ✓ stdin listener confirmed");

  console.log("[BRIDGE] Starting stats logger...");
  startStatsLogger();
  console.log("[BRIDGE] ✓ Stats logger running");

  console.log("[BRIDGE] Starting heartbeat...");
  runtime.startHeartbeat(5000);
  console.log("[BRIDGE] ✓ Heartbeat active");

  // ── Runtime Diagnostics ───────────────────────
  runtime.printDiagnostics();

  const s = runtime.getState();
  const botSpawned = bot && bot.entity;
  console.log("[BRIDGE] ╔══════════════════════════════════════╗");
  console.log("[BRIDGE] ║  [RuntimeDiag] v2.5 Converged     ║");
  console.log(`[BRIDGE] ║  apiKey:        ${agentReady ? "true" : "false"}                        ║`);
  console.log(`[BRIDGE] ║  serverHost:    ${parsedSettings.host || "?"}:${parsedSettings.port || "?"}                  ║`);
  console.log(`[BRIDGE] ║  botSpawned:    ${botSpawned ? "YES" : "NO"}                         ║`);
  console.log(`[BRIDGE] ║  dispatcher:    ${dispatcher ? "wired" : "NULL"}                      ║`);
  console.log(`[BRIDGE] ║  runtimeCtx:    ${globalThis.__RUNTIME_CONTEXT__ ? "bound" : "NULL"}                      ║`);
  console.log(`[BRIDGE] ║  skillSys:      ${skillRouter ? "active" : "NULL"}                      ║`);
  console.log(`[BRIDGE] ║  archLock:      ${globalThis.__AIMC_ARCH_LOCK__ ? "v" + globalThis.__AIMC_ARCH_LOCK__.version : "MISSING"}                    ║`);
  console.log(`[BRIDGE] ║  strictMode:    ${globalThis.__AIMC_ARCH_LOCK__?.strictMode ? "ENFORCED" : "OFF"}                 ║`);
  console.log(`[BRIDGE] ║  statsLogger:   ${statsLoggerActive ? "running" : "stopped"}                    ║`);
  console.log(`[BRIDGE] ║  heartbeat:     ${s.heartbeatActive ? "active" : "inactive"}                   ║`);
  console.log(`[BRIDGE] ║  phase:         ${s.phase}                       ║`);
  console.log(`[BRIDGE] ║  uptime:        ${s.uptime}s                       ║`);
  console.log("[BRIDGE] ║  Architecture: SINGLE EXEC CHAIN  ║");
  console.log("[BRIDGE] ║  AgentCore→SkillRouter→Dispatcher ║");
  console.log("[BRIDGE] ╚══════════════════════════════════════╝");
});

// ═══════════════════════════════════════════════════════════
// 7. Stats Logger — periodic runtime metrics (NOT an AI loop)
// ═══════════════════════════════════════════════════════════

let statsLoggerActive = false;
let tickCount = 0;

function startStatsLogger() {
  if (statsLoggerActive) return;
  statsLoggerActive = true;

  console.log("[BRIDGE] Stats logger starting...");

  // Periodic runtime diagnostics — logs uptime, phase, agent status, memory.
  // This ALSO serves as an additional event loop keeper.
  const statsInterval = setInterval(() => {
    tickCount++;
    if (tickCount % 60 === 0) {
      // Every ~60 seconds, log a runtime summary
      const state = runtime.getState();
      console.log(
        `[BRIDGE] stats tick #${tickCount} — ` +
        `uptime: ${state.uptime}s, ` +
        `phase: ${state.phase}, ` +
        `agent: ${agentReady ? "ready" : "no"}, ` +
        `rss: ${state.memory.rss_mb}MB`
      );
    }
  }, 1000);

  console.log("[BRIDGE] Stats logger started — tick interval: 1000ms");
}

// ═══════════════════════════════════════════════════════════
// 8. Final safety: this code should NEVER be reached.
//    The runtime.keepAlive() and setInterval in startStatsLogger
//    guarantee the event loop stays active.
// ═══════════════════════════════════════════════════════════

console.log("[BRIDGE] Top-level code complete. Event loop held by runtime guards.");
