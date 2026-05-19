/**
 * AIMC Build System
 *
 * Features:
 *   - Auto-detect locked app.asar and switch to timestamped output dir
 *   - Clean old build artifacts
 *   - TypeScript compilation + electron-builder packaging
 *   - Post-build diagnostics (exe path, modules, cwd)
 *   - Optional smoke test
 *
 * Usage:
 *   node scripts/build.cjs              # full build (tsc + pack)
 *   node scripts/build.cjs --pack-only  # skip tsc
 *   node scripts/build.cjs --no-pack    # tsc only
 *   node scripts/build.cjs --clean      # clean only
 *   node scripts/build.cjs --smoke      # build + smoke test
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, "package.json");

// ─── Helpers ────────────────────────────────────────────────

function log(level, ...args) {
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const prefix = { info: "📦", ok: "✅", warn: "⚠️", err: "❌" }[level] || "•";
  console.log(`[${ts}] ${prefix}`, ...args);
}

function isDirLocked(dirPath) {
  if (!fs.existsSync(dirPath)) return false;

  const winUnpacked = path.join(dirPath, "win-unpacked");
  if (!fs.existsSync(winUnpacked)) return false;

  // Try to delete the win-unpacked directory.
  // If deletion fails (file locked), we consider it locked.
  try {
    fs.rmSync(winUnpacked, { recursive: true, force: true });
    return false; // Cleaned successfully — not locked
  } catch (_) {
    return true; // Could not delete — locked
  }
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

// ─── Steps ──────────────────────────────────────────────────

async function stepClean() {
  log("info", "Cleaning old build artifacts...");

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const baseOutput = pkg.build?.directories?.output || "release";

  // Remove all timestamped release dirs (release-*)
  const entries = fs.readdirSync(PROJECT_ROOT);
  let removed = 0;
  for (const entry of entries) {
    const full = path.join(PROJECT_ROOT, entry);
    if (!fs.statSync(full).isDirectory()) continue;

    // Match: "release" exactly, or "release-YYYYMMDD-HHMM"
    if (entry === baseOutput || /^release-\d{8}-\d{4}$/.test(entry)) {
      if (isDirLocked(full)) {
        log("warn", `Skipping locked directory: ${entry}`);
        continue;
      }
      try {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
      } catch (e) {
        log("warn", `Failed to remove ${entry}: ${e.message}`);
      }
    }
  }
  log("ok", `Cleaned ${removed} old build directories.`);
}

async function stepArchGuard() {
  log("info", "Running architecture guard scan...");
  await run("node", ["scripts/arch-guard-scan.cjs"]);
  log("ok", "Architecture guard scan passed — single execution chain verified.");
}

async function stepArchDriftScan() {
  log("info", "Running architecture drift scan...");
  await run("node", ["scripts/arch-drift-scan.cjs"]);
  log("ok", "Architecture drift scan passed — no drift detected.");
}

async function stepTypecheck() {
  log("info", "Running typecheck (tsc --noEmit)...");
  await run("npx", ["tsc", "--noEmit"]);
  log("ok", "Typecheck passed.");
}

async function stepCompile() {
  log("info", "Compiling TypeScript (tsc)...");
  await run("npx", ["tsc"]);
  log("ok", "TypeScript compiled.");
}

async function stepPreReleaseCheck() {
  log("info", "Running pre-release validation...");
  await run("node", ["scripts/pre-release-check.cjs"]);
  log("ok", "Pre-release check passed — all runtime assets verified.");
}

// Track the actual output directory used (may differ from config due to timestamping)
let _actualOutputDir = null;

function getActualOutputDir() {
  if (_actualOutputDir) return _actualOutputDir;

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const baseOutput = pkg.build?.directories?.output || "release";

  // Find most recent timestamped dir with a real exe
  const entries = fs.readdirSync(PROJECT_ROOT);
  let latest = null;
  let latestTime = "";
  for (const entry of entries) {
    if (/^release-\d{8}-\d{4}$/.test(entry)) {
      const ts = entry.replace("release-", "");
      if (ts > latestTime) {
        const exeDir = path.join(PROJECT_ROOT, entry, "win-unpacked");
        if (fs.existsSync(exeDir)) {
          // Verify it has an exe
          const hasExe = fs.readdirSync(exeDir).some(f => f.endsWith(".exe"));
          if (hasExe) {
            latestTime = ts;
            latest = entry;
          }
        }
      }
    }
  }
  if (latest) return latest;

  // Fallback: check standard location with exe verification
  const standard = path.join(PROJECT_ROOT, baseOutput, "win-unpacked");
  if (fs.existsSync(standard)) {
    const hasExe = fs.readdirSync(standard).some(f => f.endsWith(".exe"));
    if (hasExe) return baseOutput;
  }

  return baseOutput;
}

/**
 * Build the Electron app.
 * Auto-detects locked output directories and switches to timestamped ones.
 */
async function stepPack() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const originalOutput = pkg.build?.directories?.output || "release";
  const outputDir = path.join(PROJECT_ROOT, originalOutput);

  // Check for lock
  if (isDirLocked(outputDir)) {
    const ts = timestamp();
    const altOutput = `${originalOutput}-${ts}`;
    log("warn", `Output directory locked: ${outputDir}`);
    log("info", `Switching to timestamped output: ${altOutput}`);

    // Temporarily modify package.json output
    pkg.build.directories.output = altOutput;
    fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + "\n");

    try {
      await run("npx", ["electron-builder", "--dir"]);
      _actualOutputDir = altOutput;
    } finally {
      // Restore original output
      pkg.build.directories.output = originalOutput;
      fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + "\n");
    }
  } else {
    log("info", "Output directory is writable. Building...");
    await run("npx", ["electron-builder", "--dir"]);
    _actualOutputDir = originalOutput;
  }

  log("ok", "Electron packaging complete.");
}

async function stepDiagnostics() {
  log("info", "Running post-build diagnostics...");

  const outputDir = getActualOutputDir();
  const winUnpacked = path.join(PROJECT_ROOT, outputDir, "win-unpacked");

  if (!fs.existsSync(winUnpacked)) {
    log("err", `Build output not found: ${winUnpacked}`);
    return;
  }

  printBuildInfo(winUnpacked, outputDir);
}

function printBuildInfo(winUnpacked, label) {
  const resources = path.join(winUnpacked, "resources");
  const asarPath = path.join(resources, "app.asar");

  // Find exe
  let exePath = null;
  let exeName = null;
  try {
    const files = fs.readdirSync(winUnpacked);
    for (const f of files) {
      if (f.endsWith(".exe") && !/uninstall|update|setup/i.test(f)) {
        exePath = path.join(winUnpacked, f);
        exeName = f;
        break;
      }
    }
  } catch (_) {}

  console.log("");
  console.log("  ╔════════════════════════════════════════════╗");
  console.log("  ║        AIMC Build Diagnostics              ║");
  console.log("  ╠════════════════════════════════════════════╣");
  console.log(`  ║ Output dir:   ${label}`);
  console.log(`  ║ Exe name:     ${exeName || "NOT FOUND"}`);
  console.log(`  ║ Exe path:     ${exePath || "NOT FOUND"}`);
  console.log(`  ║ App.asar:     ${fs.existsSync(asarPath) ? asarPath : "NOT FOUND"}`);
  console.log(`  ║ Asar size:    ${fs.existsSync(asarPath) ? (fs.statSync(asarPath).size / 1024 / 1024).toFixed(0) + " MB" : "N/A"}`);
  console.log(`  ║ launcherPath: ${exePath || "NOT FOUND"}`);
  console.log(`  ║ spawn cwd:    ${winUnpacked}`);
  console.log(`  ║ cwd is real:  ${fs.existsSync(winUnpacked) ? "YES" : "NO"}`);
  console.log("  ╚════════════════════════════════════════════╝");
  console.log("");

  // Verify critical modules in asar
  if (fs.existsSync(asarPath)) {
    try {
      const result = execSync(
        `npx asar list "${asarPath}"`,
        { encoding: "utf8", cwd: PROJECT_ROOT, stdio: ["pipe", "pipe", "pipe"] }
      );
      const criticalModules = [
        "electron/launcher-resolver.cjs",
        "electron/bot-process-manager.cjs",
        "electron/main.cjs",
      ];
      const lines = result.split("\n");
      console.log("  Critical modules in app.asar:");
      criticalModules.forEach((mod) => {
        const found = lines.some((l) => l.includes(mod));
        if (found) {
          console.log(`    ✓ ${mod}`);
        } else {
          console.log(`    ✗ ${mod} — MISSING`);
        }
      });
    } catch (_) {
      log("warn", "Could not verify asar contents.");
    }
  }

  console.log("");
}

async function stepSmokeTest() {
  log("info", "Running smoke test...");

  const outputDir = getActualOutputDir();
  const winUnpacked = path.join(PROJECT_ROOT, outputDir, "win-unpacked");

  if (!fs.existsSync(winUnpacked)) {
    log("err", "No build found for smoke test.");
    return false;
  }

  // Find exe
  let exePath = null;
  const files = fs.readdirSync(winUnpacked);
  for (const f of files) {
    if (f.endsWith(".exe") && !/uninstall|update|setup/i.test(f)) {
      exePath = path.join(winUnpacked, f);
      break;
    }
  }

  if (!exePath) {
    log("err", "No exe found for smoke test.");
    return false;
  }

  log("info", `Launching: ${exePath}`);

  // Launch the exe and wait briefly
  return new Promise((resolve) => {
    const child = spawn(exePath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    // Give it 10 seconds to start
    setTimeout(() => {
      // Check if process is still alive
      if (child.exitCode === null && !child.killed) {
        log("ok", "Smoke test PASSED — Launcher started successfully.");
        log("info", `PID: ${child.pid}`);
        child.kill();
        resolve(true);
      } else {
        log("err", `Launcher exited prematurely with code ${child.exitCode}`);
        resolve(false);
      }
    }, 10000);
  });
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const flags = {
    clean: args.includes("--clean"),
    packOnly: args.includes("--pack-only"),
    noPack: args.includes("--no-pack"),
    smoke: args.includes("--smoke"),
  };

  console.log("");
  log("info", "AIMC Build System");
  log("info", `Project: ${PROJECT_ROOT}`);
  console.log("AIMC_RELEASE_BUILD_START:" + JSON.stringify({
    timestamp: Date.now(),
    project: PROJECT_ROOT,
    flags,
  }));

  // --clean: clean only
  if (flags.clean && args.length === 1) {
    await stepClean();
    return;
  }

  // Build pipeline
  await stepClean();

  if (!flags.packOnly) {
    try {
      await stepArchGuard();
    } catch (e) {
      log("err", e.message);
      process.exit(1);
    }

    try {
      await stepArchDriftScan();
    } catch (e) {
      log("err", e.message);
      process.exit(1);
    }

    try {
      await stepTypecheck();
    } catch (e) {
      log("err", e.message);
      process.exit(1);
    }

    try {
      await stepCompile();
    } catch (e) {
      log("err", e.message);
      process.exit(1);
    }

    try {
      await stepPreReleaseCheck();
    } catch (e) {
      log("err", e.message);
      process.exit(1);
    }
  }

  if (!flags.noPack) {
    try {
      await stepPack();
    } catch (e) {
      log("err", e.message);
      process.exit(1);
    }
  }

  await stepDiagnostics();

  if (flags.smoke) {
    await stepSmokeTest();
  }

  console.log("AIMC_RELEASE_BUILD_SUCCESS:" + JSON.stringify({
    timestamp: Date.now(),
    outputDir: getActualOutputDir(),
  }));
  log("ok", "Build complete.");
  console.log("");
}

main().catch((err) => {
  console.log("AIMC_RELEASE_BUILD_FAIL:" + JSON.stringify({
    timestamp: Date.now(),
    error: err.message,
  }));
  log("err", err.message);
  process.exit(1);
});
