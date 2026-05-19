/**
 * BotRuntimeManager — ensures the bot process NEVER exits on its own.
 *
 * The bot process is a CONTAINER, not a script. It must stay alive until
 * explicitly killed. This module provides:
 *
 *   - Event loop guard (prevents natural exit)
 *   - Heartbeat (proves liveness)
 *   - Crash guard (uncaughtException, unhandledRejection)
 *   - Lifecycle hooks (init → running → stopping → dead)
 *   - Diagnostics (state snapshot)
 *
 * Usage:
 *   const runtime = require('./bot-runtime-manager.cjs');
 *   runtime.crashGuard();
 *   runtime.keepAlive();
 *   runtime.bootstrap(async () => {
 *     await initModules();
 *     runtime.startHeartbeat(5000);
 *   });
 *   // process will NOT exit after bootstrap completes
 */

const state = {
  phase: "init",        // init | booting | running | stopping | dead
  bootTime: Date.now(),
  heartbeatInterval: null,
  keepAliveInterval: null,
  activeHandles: [],
  lastError: null,
  exitCode: null,
};

// ─── Event loop guard ──────────────────────────────────────

/**
 * Prevent the Node.js event loop from draining.
 * Without this, the process exits with code 0 once all async ops complete.
 *
 * Uses a permanent setInterval as the last-resort event loop keeper.
 * This is NOT a hack — it's the standard pattern for long-running daemons.
 */
function keepAlive() {
  if (state.keepAliveInterval) return;

  state.keepAliveInterval = setInterval(() => {
    // This empty callback is intentional — it keeps the event loop alive.
    // Do NOT remove it or add process.exit() here.
  }, 1000);

  // Allow the timer to not prevent process exit if we explicitly want to stop
  if (state.keepAliveInterval && state.keepAliveInterval.unref) {
    // Do NOT unref — we WANT this to keep the process alive
  }

  console.log("[Runtime] keepAlive lock engaged — process will not auto-exit.");
}

/**
 * Release the event loop guard. Only call this when intentionally shutting down.
 */
function releaseKeepAlive() {
  if (state.keepAliveInterval) {
    clearInterval(state.keepAliveInterval);
    state.keepAliveInterval = null;
    console.log("[Runtime] keepAlive lock released.");
  }
}

// ─── Heartbeat ─────────────────────────────────────────────

/**
 * Start a visible heartbeat that proves the process is alive.
 * Outputs to stdout so the parent process can monitor it.
 *
 * @param {number} intervalMs — heartbeat interval in milliseconds
 */
function startHeartbeat(intervalMs = 5000) {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
  }

  state.heartbeatInterval = setInterval(() => {
    const uptime = Math.round((Date.now() - state.bootTime) / 1000);
    const mem = process.memoryUsage();
    console.log(
      `[Runtime] ♥ heartbeat — uptime: ${uptime}s, ` +
      `phase: ${state.phase}, ` +
      `rss: ${(mem.rss / 1024 / 1024).toFixed(0)}MB`
    );
    // Also emit on stdout for parent process monitoring
    try {
      process.stdout.write(
        `AIMC_MSG:${JSON.stringify({
          type: "heartbeat",
          uptime,
          phase: state.phase,
          rss_mb: Math.round(mem.rss / 1024 / 1024),
        })}\n`
      );
    } catch (_) {
      // stdout may be closed — ignore
    }
  }, intervalMs);

  console.log(`[Runtime] Heartbeat started — every ${intervalMs}ms.`);
}

// ─── Crash guard ───────────────────────────────────────────

/**
 * Register global error handlers so the process never dies silently.
 * Logs the error and keeps running.
 */
function crashGuard() {
  process.on("uncaughtException", (err) => {
    state.lastError = { type: "uncaughtException", message: err.message, stack: err.stack, time: Date.now() };
    console.error("[Runtime] ⚡ UNCAUGHT EXCEPTION:", err.message);
    console.error(err.stack);
    // Do NOT exit — keep running
  });

  process.on("unhandledRejection", (reason, promise) => {
    state.lastError = { type: "unhandledRejection", message: String(reason), time: Date.now() };
    console.error("[Runtime] ⚡ UNHANDLED REJECTION:", reason);
    // Do NOT exit — keep running
  });

  process.on("exit", (code) => {
    state.phase = "dead";
    state.exitCode = code;
    console.log(`[Runtime] ⚡ Process exit triggered — code: ${code}, phase was: ${state.phase}`);
    console.log(`[Runtime] Uptime: ${Math.round((Date.now() - state.bootTime) / 1000)}s`);
  });

  process.on("beforeExit", (code) => {
    console.log(`[Runtime] ⚡ beforeExit event fired — code: ${code}. Event loop may be draining!`);
  });

  // Catch SIGTERM/SIGINT — log but don't exit (parent sends these to stop us)
  process.on("SIGTERM", () => {
    console.log("[Runtime] Received SIGTERM — shutting down gracefully.");
    state.phase = "stopping";
    shutdown();
  });

  process.on("SIGINT", () => {
    console.log("[Runtime] Received SIGINT — shutting down gracefully.");
    state.phase = "stopping";
    shutdown();
  });

  console.log("[Runtime] Crash guard installed.");
}

function shutdown() {
  releaseKeepAlive();
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }
  state.phase = "dead";
  // Allow process to exit naturally now that guards are released
  setTimeout(() => {
    process.exit(0);
  }, 500);
}

// ─── Bootstrap ─────────────────────────────────────────────

/**
 * Bootstrap the bot runtime. Calls the provided init function, then holds
 * the event loop open permanently.
 *
 * The init function should:
 *   1. Load modules (legacy bot, agent core, etc.)
 *   2. Connect to game server
 *   3. Start the AI loop
 *
 * After init completes, the runtime stays alive (keepAlive lock).
 *
 * @param {() => Promise<void>} initFn — async initialization function
 */
async function bootstrap(initFn) {
  state.phase = "booting";
  const bootStart = Date.now();

  console.log("[Runtime] ╔══════════════════════════════════╗");
  console.log("[Runtime] ║  Bot Runtime Starting          ║");
  console.log("[Runtime] ╠══════════════════════════════════╣");

  // Diagnostics
  console.log(`[Runtime] ║  argv:       ${process.argv.slice(0, 5).join(" ")}${process.argv.length > 5 ? "..." : ""}`);
  console.log(`[Runtime] ║  cwd:        ${process.cwd()}`);
  console.log(`[Runtime] ║  pid:        ${process.pid}`);
  console.log(`[Runtime] ║  node:       ${process.version}`);
  console.log(`[Runtime] ║  platform:   ${process.platform}`);

  const userDataIdx = process.argv.findIndex(a => a.startsWith("--user-data-dir="));
  const userDataDir = userDataIdx >= 0
    ? process.argv[userDataIdx].split("=")[1]
    : "default";
  console.log(`[Runtime] ║  userData:   ${userDataDir}`);

  const bridgeIdx = process.argv.findIndex(a => a.endsWith("legacy-bridge.cjs"));
  console.log(`[Runtime] ║  bridge:     ${bridgeIdx >= 0 ? `argv[${bridgeIdx}]` : "NOT FOUND"}`);

  console.log("[Runtime] ╚══════════════════════════════════╝");

  // Run user init
  try {
    console.log("[Runtime] Bootstrapping...");
    await initFn();
    const bootMs = Date.now() - bootStart;
    console.log(`[Runtime] Bootstrap complete — ${bootMs}ms.`);
  } catch (err) {
    console.error("[Runtime] Bootstrap FAILED:", err.message);
    console.error(err.stack);
    state.lastError = { type: "bootstrap", message: err.message, stack: err.stack, time: Date.now() };
    // Keep running even if bootstrap fails — don't exit
  }

  state.phase = "running";
  console.log("[Runtime] Phase: running — process will stay alive.");
}

// ─── Diagnostics ───────────────────────────────────────────

function getState() {
  const mem = process.memoryUsage();
  return {
    ...state,
    uptime: Math.round((Date.now() - state.bootTime) / 1000),
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
    },
    pid: process.pid,
    eventLoopAlive: state.keepAliveInterval !== null,
    heartbeatActive: state.heartbeatInterval !== null,
  };
}

function printDiagnostics() {
  const s = getState();
  console.log("[Runtime] ╔══════════════════════════════════╗");
  console.log(`[Runtime] ║  Phase:       ${s.phase}`);
  console.log(`[Runtime] ║  Uptime:      ${s.uptime}s`);
  console.log(`[Runtime] ║  PID:         ${s.pid}`);
  console.log(`[Runtime] ║  RSS:         ${s.memory.rss_mb}MB`);
  console.log(`[Runtime] ║  Heap:        ${s.memory.heap_mb}MB`);
  console.log(`[Runtime] ║  KeepAlive:   ${s.eventLoopAlive}`);
  console.log(`[Runtime] ║  Heartbeat:   ${s.heartbeatActive}`);
  console.log(`[Runtime] ║  Last Error:  ${s.lastError ? s.lastError.message : "none"}`);
  console.log("[Runtime] ╚══════════════════════════════════╝");
}

// ─── Exports ────────────────────────────────────────────────

module.exports = {
  keepAlive,
  releaseKeepAlive,
  startHeartbeat,
  crashGuard,
  bootstrap,
  getState,
  printDiagnostics,
  shutdown,
};
