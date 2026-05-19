/**
 * BotProcessManager — encapsulated bot process lifecycle.
 *
 * Responsibilities:
 *   - Spawn the bot process with validated paths and safe options
 *   - Stream stdout/stderr with AIMC_MSG protocol parsing
 *   - Classify and surface errors with actionable messages
 *   - Expose start/stop/restart/healthCheck lifecycle
 *
 * Does NOT import from LauncherResolver — paths are injected.
 * Does NOT touch IPC directly — emits events for main.cjs to forward.
 */

const { spawn } = require("child_process");
const { EventEmitter } = require("events");

// ─── Error classification ──────────────────────────────────

/**
 * Classify a spawn error into a user-readable category.
 * @param {Error} err
 * @returns {{ category: string, suggestion: string }}
 */
function classifyError(err) {
  const code = err.code || "";
  const msg = err.message || "";

  if (code === "ENOENT") {
    if (msg.includes(".asar")) {
      return {
        category: "ASAR_CWD_ERROR",
        suggestion:
          "Working directory resolved inside ASAR archive. " +
          "This is a path resolution bug — cwd must be a real filesystem path.",
      };
    }
    return {
      category: "FILE_NOT_FOUND",
      suggestion:
        "The launcher executable was not found. " +
        "The release may be incomplete or the executable was moved/deleted.",
    };
  }

  if (code === "EACCES" || code === "EPERM") {
    return {
      category: "PERMISSION_DENIED",
      suggestion:
        "Permission denied when spawning the bot process. " +
        "Check antivirus settings or file permissions.",
    };
  }

  if (code === "EBUSY") {
    return {
      category: "FILE_BUSY",
      suggestion:
        "The executable file is locked by another process. " +
        "Close other instances and try again.",
    };
  }

  return {
    category: "SPAWN_FAILED",
    suggestion: `Unexpected spawn error (${code}): ${msg}`,
  };
}

// ─── Manager ────────────────────────────────────────────────

class BotProcessManager extends EventEmitter {
  constructor() {
    super();
    /** @type {import('child_process').ChildProcess|null} */
    this._process = null;
    /** @type {boolean} */
    this._running = false;
    /** @type {number|null} */
    this._exitCode = null;
    /** @type {string|null} */
    this._lastError = null;
  }

  // ── Public API ───────────────────────────────────────

  /** Whether the bot process is currently running. */
  get running() {
    return this._running && this._process !== null;
  }

  /** Exit code from the last run (null if still running or never started). */
  get exitCode() {
    return this._exitCode;
  }

  /** Last error message, if any. */
  get lastError() {
    return this._lastError;
  }

  /**
   * Start the bot process.
   *
   * @param {Object} opts
   * @param {string} opts.exePath       — resolved executable path
   * @param {string} opts.bridgePath    — resolved bridge script path (argument)
   * @param {string} opts.cwd           — working directory (must be real filesystem)
   * @param {Object} opts.env           — environment variables
   * @param {string[]} [opts.electronFlags] — Electron CLI flags (e.g., --user-data-dir, --disable-gpu)
   * @returns {{ success: boolean, error?: string }}
   */
  start({ exePath, bridgePath, cwd, env, electronFlags }) {
    // ── Pre-condition checks ─────────────────────────
    if (this.running) {
      return { success: false, error: "Bot process is already running." };
    }

    if (!exePath || typeof exePath !== "string") {
      return { success: false, error: "Invalid exePath: must be a non-empty string." };
    }
    if (!bridgePath || typeof bridgePath !== "string") {
      return { success: false, error: "Invalid bridgePath: must be a non-empty string." };
    }
    if (!cwd || typeof cwd !== "string") {
      return { success: false, error: "Invalid cwd: must be a non-empty string." };
    }

    const flags = Array.isArray(electronFlags) ? electronFlags : [];

    // Build spawn args: Electron flags first, then bridge script
    const spawnArgs = [...flags, bridgePath];

    // Log spawn configuration
    console.log("[BotProcessManager] Spawn configuration:");
    console.log("  exePath:", exePath);
    console.log("  bridgePath:", bridgePath);
    console.log("  cwd:", cwd);
    console.log("  cwd is real dir:", require("fs").existsSync(cwd));
    console.log("  electronFlags:", flags);
    console.log("  spawnArgs:", spawnArgs);

    // ── Spawn ────────────────────────────────────────
    const fs = require("fs");

    try {
      this._process = spawn(exePath, spawnArgs, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
        shell: false,
        windowsHide: false,
      });
    } catch (err) {
      this._lastError = err.message;
      console.error("[BotProcessManager] spawn() threw synchronously:", err.message);
      return { success: false, error: `Spawn failed: ${err.message}` };
    }

    this._running = true;
    this._exitCode = null;
    this._lastError = null;

    // ── Error handler ────────────────────────────────
    this._process.on("error", (err) => {
      const { category, suggestion } = classifyError(err);
      this._running = false;
      this._process = null;
      this._lastError = err.message;

      console.error(`[BotProcessManager] Spawn error [${category}]:`, err.message);
      console.error("  Suggestion:", suggestion);

      this.emit("status", {
        running: false,
        error: err.message,
        errorCategory: category,
        errorSuggestion: suggestion,
      });
    });

    // ── Stdout handler ───────────────────────────────
    let stdoutBuf = "";
    this._process.stdout.on("data", (chunk) => {
      const raw = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      stdoutBuf += raw;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("AIMC_MSG:")) {
          try {
            const msg = JSON.parse(line.slice(9));
            this.emit("chat-response", msg);
          } catch (_) {
            // Malformed JSON — ignore
          }
        } else if (line.startsWith("AIMC_UI_STATE:")) {
          try {
            const state = JSON.parse(line.slice(15));
            this.emit("ui-state", state);
          } catch (_) {
            // Malformed JSON — ignore
          }
        } else {
          this.emit("output", { type: "stdout", text: line + "\n" });
        }
      }
    });

    // ── Stderr handler ───────────────────────────────
    this._process.stderr.on("data", (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      this.emit("output", { type: "stderr", text });
    });

    // ── Exit handler ─────────────────────────────────
    this._process.on("exit", (code) => {
      this._running = false;
      this._exitCode = code;
      this._process = null;

      console.log(`[BotProcessManager] Bot process exited with code ${code}`);

      this.emit("status", {
        running: false,
        exitCode: code,
      });
    });

    this.emit("status", { running: true });

    return { success: true };
  }

  /**
   * Stop the bot process gracefully (SIGTERM), then forcefully if needed.
   * @returns {{ success: boolean, error?: string }}
   */
  stop() {
    if (!this.running || !this._process) {
      return { success: false, error: "Bot process is not running." };
    }

    try {
      const killed = this._process.kill("SIGTERM");

      // Fallback: force kill after 2 seconds if still alive
      const proc = this._process;
      setTimeout(() => {
        if (proc && !proc.killed) {
          console.warn("[BotProcessManager] SIGTERM did not stop the process, sending SIGKILL.");
          proc.kill("SIGKILL");
        }
      }, 2000);

      if (!killed) {
        return { success: false, error: "Failed to send kill signal." };
      }

      return { success: true };
    } catch (err) {
      this._lastError = err.message;
      return { success: false, error: err.message };
    }
  }

  /**
   * Restart the bot process.
   * @param {Object} opts — same as start()
   * @returns {{ success: boolean, error?: string }}
   */
  restart(opts) {
    const stopResult = this.stop();
    // Don't block restart if stop fails (process may already be dead)
    if (!stopResult.success && this.running) {
      return stopResult;
    }

    // Small delay to let the OS release file handles
    return this.start(opts);
  }

  /**
   * Check if the bot process is healthy.
   * @returns {{ healthy: boolean, details: Object }}
   */
  healthCheck() {
    if (!this._process) {
      return {
        healthy: false,
        details: {
          reason: "no_process",
          running: false,
          exitCode: this._exitCode,
        },
      };
    }

    const killed = this._process.killed;
    const exitCode = this._process.exitCode;
    const pid = this._process.pid;

    // Auto-recovery: if the flag is set but process is dead
    if (this._running && (killed || exitCode !== null)) {
      this._running = false;
      this._exitCode = exitCode;
      this._process = null;
      return {
        healthy: false,
        details: {
          reason: "state_mismatch",
          running: false,
          exitCode: this._exitCode,
          message: "Process died but state flag was still true — auto-corrected.",
        },
      };
    }

    return {
      healthy: this._running && !killed && exitCode === null,
      details: {
        running: this._running,
        pid,
        killed,
        exitCode,
      },
    };
  }

  /**
   * Send a chat message to the bot process via stdin.
   * @param {string} message
   * @returns {{ success: boolean, error?: string }}
   */
  sendChat(message) {
    if (!this.running || !this._process || !this._process.stdin.writable) {
      return {
        success: false,
        error: "Bot is not running or stdin is closed.",
      };
    }

    try {
      this._process.stdin.write(
        JSON.stringify({
          type: "chat",
          message: String(message).trim(),
          source: "player",
        }) + "\n"
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = { BotProcessManager, classifyError };
