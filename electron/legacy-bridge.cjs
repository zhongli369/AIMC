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
const { pathToFileURL } = require("url");

// ═══════════════════════════════════════════════════════════
// 1. Runtime Guard — install IMMEDIATELY
// ═══════════════════════════════════════════════════════════

const runtime = require("./runtime/bot-runtime-manager.cjs");

runtime.crashGuard();
runtime.keepAlive();

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

console.log("[BRIDGE] Dist index:", distIndex);
console.log("[BRIDGE] Legacy settings:", legacySettingsPath);
console.log("[BRIDGE] mcdata:", mcdataPath);

// ═══════════════════════════════════════════════════════════
// 3. Environment diagnostics — verify API keys and settings
// ═══════════════════════════════════════════════════════════

console.log("[BRIDGE] ── ENV DIAGNOSTICS ──");
console.log("[BRIDGE] DEEPSEEK_API_KEY:", process.env.DEEPSEEK_API_KEY ? "present (" + process.env.DEEPSEEK_API_KEY.slice(0, 8) + "...)" : "MISSING");
console.log("[BRIDGE] OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "present" : "MISSING");
console.log("[BRIDGE] ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "present" : "MISSING");
console.log("[BRIDGE] SETTINGS_JSON:", process.env.SETTINGS_JSON ? process.env.SETTINGS_JSON : "MISSING");
console.log("[BRIDGE] PROFILES:", process.env.PROFILES ? "present" : "MISSING");

// Parse and log settings
let parsedSettings = {};
try {
  parsedSettings = JSON.parse(process.env.SETTINGS_JSON || "{}");
  console.log("[BRIDGE] Parsed settings:");
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
};

// ═══════════════════════════════════════════════════════════
// 5. Agent state (populated during bootstrap)
// ═══════════════════════════════════════════════════════════

let agent = null;
let agentReady = false;
let dispatcher = null;
let safety = null;
let skillRouter = null;
let skillRegistry = null;

function parseSettings() {
  try {
    return JSON.parse(process.env.SETTINGS_JSON || "{}");
  } catch (_) {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════
// 5. Stdin: receive chat messages from parent process
// ═══════════════════════════════════════════════════════════

function setupStdinListener() {
  // Resume stdin to ensure it keeps the event loop active
  process.stdin.resume();

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

async function handleChat(msg) {
  if (!agent || !agentReady) {
    console.log("[BRIDGE] Chat received but agent not ready — ignoring.");
    return;
  }

  try {
    const result = await agent.think({
      botState: globalThis.__botState__ || null,
      chatMessage: {
        source: msg.source || "player",
        message: msg.message,
      },
      nearbyEntities: globalThis.__WORLD_STATE__?.getNearbyEntities?.() || [],
    });

    process.stdout.write(
      "AIMC_MSG:" +
        JSON.stringify({
          type: "chat_response",
          completed: result.completed,
          speech: result.agentOutput?.speech || null,
          fallback: result.fallback || false,
          actionsExecuted: result.executionResults?.length || 0,
        }) +
        "\n"
    );
  } catch (err) {
    process.stdout.write(
      "AIMC_MSG:" +
        JSON.stringify({
          type: "chat_response",
          completed: false,
          speech: null,
          error: err.message,
        }) +
        "\n"
    );
  }
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
  const apiKey = process.env[apiKeyVar];
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
    console.error(err.stack);
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
      agent = aimc.initAgent({ apiKey, model });
      agentReady = true;

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

      console.log("[BRIDGE] ✓ Step D: AgentCore ready — model:", model);
      process.stdout.write(
        "AIMC_MSG:" + JSON.stringify({ type: "ready", model }) + "\n"
      );
    } catch (err) {
      console.error("[BRIDGE] ✗ AgentCore pipeline init failed:", err.message);
      console.error(err.stack);
    }
  } else {
    console.log(`[BRIDGE] △ Step D-F: AgentCore skipped — no API key for model: ${model}`);
    console.log(`[BRIDGE]   Env var checked: ${apiKeyVar}`);
    // Bot still connects — just no AI pipeline
  }

  // ── Step H: stdin listener + stats logger + heartbeat
  console.log("[BRIDGE] Step H: Starting stdin listener...");
  setupStdinListener();
  console.log("[BRIDGE] ✓ stdin listener active");

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
