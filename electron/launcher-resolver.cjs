/**
 * LauncherResolver — dynamic path discovery and validation.
 *
 * Resolves the Electron executable, bridge script, and working directory
 * across all environments: dev (npm run electron), packaged (electron-builder),
 * and portable (copied release folder).
 *
 * Key invariant: cwd passed to spawn() MUST be a real filesystem path.
 * Windows CreateProcessW cannot navigate into ASAR virtual filesystems.
 */

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

// ─── Path resolution ───────────────────────────────────────

/**
 * Resolve the Node.js/Electron executable used to spawn the bot process.
 *
 * Priority:
 *   1. process.execPath — the running Electron exe (works in both dev & packaged)
 *   2. app.getPath("exe") — fallback
 *
 * In packaged builds, this is e.g. "C:\...\release\win-unpacked\AIMC Launcher.exe"
 * In dev, this is e.g. "C:\...\node_modules\electron\dist\electron.exe"
 */
function resolveExePath() {
  const candidates = [process.execPath];

  try {
    candidates.push(app.getPath("exe"));
  } catch (_) {
    // app.getPath may throw before app.whenReady
  }

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

/**
 * Resolve the bridge script path.
 *
 * The bridge is always in the same directory as main.cjs (electron/).
 * In packaged builds, __dirname is inside app.asar — Electron's module
 * loader can read from ASAR, so this is fine as a spawn argument.
 */
function resolveBridgePath() {
  const bridgePath = path.join(__dirname, "legacy-bridge.cjs");
  return bridgePath;
}

/**
 * Resolve the working directory for the spawned bot process.
 *
 * CRITICAL: Must be a REAL filesystem path — NOT inside an ASAR archive.
 * Windows CreateProcessW cannot resolve a cwd inside virtual filesystems,
 * which causes ENOENT even when the executable itself exists.
 *
 * Strategy:
 *   - Use path.dirname(process.execPath) — the directory containing the exe.
 *     This is always a real filesystem path in both dev and packaged builds.
 */
function resolveCwd() {
  // In dev mode (not packaged), the project root is parent of __dirname.
  // The exe lives in node_modules/electron/dist/ — which has no package.json.
  // We must point to the directory that contains our "main": "electron/main.cjs".
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, "..");
    if (fs.existsSync(path.join(projectRoot, "package.json"))) {
      return projectRoot;
    }
  }

  // Packaged mode: the exe is next to resources/app.asar, so exe dir is the right cwd.
  const exePath = resolveExePath();
  if (!exePath) return null;

  const dir = path.dirname(exePath);

  // Sanity check: the directory must exist on the real filesystem
  if (!fs.existsSync(dir)) {
    return null;
  }

  return dir;
}

// ─── Validation ─────────────────────────────────────────────

/**
 * Result of validation. Contains resolved paths and any errors.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string|null} exePath
 * @property {string|null} bridgePath
 * @property {string|null} cwd
 * @property {string[]} errors
 * @property {string[]} warnings
 */

/**
 * Run pre-flight validation and return resolved paths.
 * Logs detailed diagnostics to console for debugging.
 *
 * @returns {ValidationResult}
 */
function validate() {
  const result = {
    valid: true,
    exePath: null,
    bridgePath: null,
    cwd: null,
    errors: [],
    warnings: [],
  };

  // ── Resolve paths ──────────────────────────────
  result.exePath = resolveExePath();
  result.bridgePath = resolveBridgePath();
  result.cwd = resolveCwd();

  // ── Log diagnostics ────────────────────────────
  console.log("[LauncherResolver] Environment diagnostics:");
  console.log("  process.execPath:", process.execPath);
  console.log("  __dirname:", __dirname);
  console.log("  app.isPackaged:", app.isPackaged);
  console.log("  resolved exePath:", result.exePath);
  console.log("  resolved bridgePath:", result.bridgePath);
  console.log("  resolved cwd:", result.cwd);

  // ── Validate exePath ───────────────────────────
  if (!result.exePath) {
    result.valid = false;
    result.errors.push("Could not resolve executable path");
  } else if (typeof result.exePath !== "string" || result.exePath.length === 0) {
    result.valid = false;
    result.errors.push("Resolved executable path is empty");
  } else if (!fs.existsSync(result.exePath)) {
    result.valid = false;
    result.errors.push(
      `Executable does not exist: ${result.exePath}`
    );
  } else {
    // Check if it looks executable (basic heuristic: .exe or has execute permission)
    try {
      const stat = fs.statSync(result.exePath);
      if (!stat.isFile()) {
        result.valid = false;
        result.errors.push(`Executable path is not a file: ${result.exePath}`);
      }
      if (stat.size === 0) {
        result.valid = false;
        result.errors.push(`Executable file is empty: ${result.exePath}`);
      }
    } catch (err) {
      result.valid = false;
      result.errors.push(
        `Cannot stat executable: ${result.exePath} — ${err.message}`
      );
    }
  }

  // Check for illegal characters in path
  if (result.exePath && /[\x00-\x1f]/.test(result.exePath)) {
    result.valid = false;
    result.errors.push("Executable path contains illegal control characters");
  }

  // ── Validate bridgePath ────────────────────────
  if (!result.bridgePath) {
    result.valid = false;
    result.errors.push("Could not resolve bridge script path");
  } else if (!fs.existsSync(result.bridgePath)) {
    result.valid = false;
    result.errors.push(
      `Bridge script does not exist: ${result.bridgePath}`
    );
  }

  // ── Validate cwd ───────────────────────────────
  if (!result.cwd) {
    result.valid = false;
    result.errors.push("Could not resolve working directory (cwd)");
  } else if (!fs.existsSync(result.cwd)) {
    result.valid = false;
    result.errors.push(`Working directory does not exist: ${result.cwd}`);
  } else {
    try {
      const stat = fs.statSync(result.cwd);
      if (!stat.isDirectory()) {
        result.valid = false;
        result.errors.push(`Working directory is not a directory: ${result.cwd}`);
      }
    } catch (err) {
      result.valid = false;
      result.errors.push(
        `Cannot stat working directory: ${result.cwd} — ${err.message}`
      );
    }
  }

  // ── Detect ASAR in cwd (fatal) ────────────────
  if (result.cwd && result.cwd.includes(".asar")) {
    result.valid = false;
    result.errors.push(
      `Working directory is inside ASAR archive — Windows cannot use this as cwd: ${result.cwd}. ` +
      `This is a bug: cwd must be a real filesystem path.`
    );
  }

  // ── Log result ─────────────────────────────────
  if (result.valid) {
    console.log("[LauncherResolver] All checks passed. Ready to spawn.");
  } else {
    console.error("[LauncherResolver] VALIDATION FAILED:");
    result.errors.forEach((e) => console.error("  ERROR:", e));
    result.warnings.forEach((w) => console.warn("  WARN:", w));
  }

  return result;
}

// ─── Auto-discovery (future-proofing) ──────────────────────

/**
 * Scan a directory for the first valid launcher executable.
 * Excludes known non-launcher executables (uninstall, updater, etc.).
 *
 * @param {string} dir - Directory to scan
 * @returns {string|null} Path to the discovered executable, or null
 */
function discoverExeInDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;

  const excludePatterns = [
    /uninstall/i,
    /updater/i,
    /setup/i,
    /crashpad/i,
    /notification_helper/i,
    /elevated_service/i,
  ];

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }

  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (!lower.endsWith(".exe")) continue;
    if (excludePatterns.some((p) => p.test(lower))) continue;

    const fullPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && stat.size > 1024) {
        // > 1KB to filter out stubs
        return fullPath;
      }
    } catch (_) {
      continue;
    }
  }

  return null;
}

// ─── Bot Runtime Profile (Chromium isolation) ──────────────

/**
 * Resolve and create a unique user-data directory for a bot instance.
 *
 * This prevents Chromium cache conflicts between the main Electron process
 * and the spawned bot process. Without this, both processes compete for
 * GPUCache, Code Cache, Session Storage, etc., causing "Access denied"
 * and "Gpu Cache Creation failed" errors.
 *
 * Directory: <userData>/aimc-bots/<botId>/
 *
 * @param {string} botId - Unique bot identifier (e.g., bot name + timestamp)
 * @returns {{ profileDir: string, created: boolean, error?: string }}
 */
function resolveBotProfileDir(botId) {
  if (!botId || typeof botId !== "string") {
    return { profileDir: null, created: false, error: "Invalid botId: must be a non-empty string." };
  }

  // Sanitize botId: only allow alphanumeric, dash, underscore
  const safeId = botId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

  let userData;
  try {
    userData = app.getPath("userData");
  } catch (_) {
    // app.getPath may throw before app.whenReady
    userData = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || ".", "AIMC");
  }

  const profileDir = path.join(userData, "aimc-bots", safeId);

  console.log("[LauncherResolver] Bot profile:");
  console.log("  botId:", botId);
  console.log("  userData:", userData);
  console.log("  profileDir:", profileDir);

  // Create directory
  try {
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
      console.log("  created: true");
      return { profileDir, created: true };
    }
    console.log("  created: false (already exists)");
  } catch (err) {
    console.error("  ERROR creating profile dir:", err.message);
    return { profileDir, created: false, error: `Cannot create profile directory: ${err.message}` };
  }

  // Verify it's writable
  try {
    const probeFile = path.join(profileDir, ".write-test");
    fs.writeFileSync(probeFile, "ok", "utf8");
    fs.unlinkSync(probeFile);
    console.log("  writable: true");
  } catch (err) {
    console.error("  ERROR: profile dir not writable:", err.message);
    return { profileDir, created: false, error: `Profile directory is not writable: ${err.message}` };
  }

  return { profileDir, created: false };
}

/**
 * Build the Electron CLI flags for bot process isolation.
 *
 * These flags ensure the spawned bot process:
 *   - Uses an isolated Chromium profile (no cache conflicts)
 *   - Disables GPU acceleration (headless bot, no rendering needed)
 *   - Disables sandboxing (Electron child of Electron)
 *
 * @param {string} profileDir - Path to the bot's user-data directory
 * @returns {string[]} Array of CLI flags for spawn()
 */
function buildBotElectronFlags(profileDir) {
  return [
    `--user-data-dir=${profileDir}`,
    "--disable-gpu",
    "--disable-gpu-shader-disk-cache",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--disable-software-rasterizer",
  ];
}

module.exports = {
  resolveExePath,
  resolveBridgePath,
  resolveCwd,
  validate,
  discoverExeInDir,
  resolveBotProfileDir,
  buildBotElectronFlags,
};
