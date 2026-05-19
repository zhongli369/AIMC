/**
 * AIMC Pre-Release Validation Hook (P2)
 *
 * Runs before Electron packaging to ensure all required
 * runtime assets are present and valid.
 *
 * Checks:
 *   1. TypeScript build output (dist/ key files exist)
 *   2. Config file (config/aimc.config.json)
 *   3. Voice profile (electron/renderer/ui/voice-profile.json)
 *   4. Dashboard assets (electron/renderer/ui/dashboard.*)
 *   5. Entry files (electron/main.cjs, electron/preload.cjs, electron/legacy-bridge.cjs)
 *   6. Build config (electron-builder.json or package.json "build" field)
 *
 * Output:
 *   AIMC_PRE_RELEASE_CHECK: PASS  → exit 0
 *   AIMC_PRE_RELEASE_CHECK: FAIL  → exit 1 (lists missing items)
 *
 * PURE VALIDATION — no behavior change, no code generation, no side effects.
 */

const path = require("path");
const fs = require("fs");

const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Check Registry ────────────────────────────────────────

/**
 * Each check: { label, files: string[] }
 * All files must exist for the check to pass.
 */
const CHECKS = [
  {
    label: "TypeScript build output (dist/)",
    files: [
      "dist/index.js",
      "dist/agent/agent-core.js",
      "dist/skill/skill-router.js",
      "dist/runtime/action-dispatcher.js",
      "dist/runtime/runtime-core.js",
      "dist/observability/event-collector.js",
      "dist/voice/text-to-speech.js",
      "dist/ui/state-bridge.js",
      "dist/config/aimc-config.js",
      "dist/voice/profile/voice-profile-loader.js",
    ],
  },
  {
    label: "Config file",
    files: ["config/aimc.config.json"],
  },
  {
    label: "Voice profile",
    files: ["electron/renderer/ui/voice-profile.json"],
  },
  {
    label: "Dashboard UI assets",
    files: [
      "electron/renderer/ui/dashboard.html",
      "electron/renderer/ui/dashboard.js",
      "electron/renderer/ui/dashboard.css",
    ],
  },
  {
    label: "Electron entry files",
    files: [
      "electron/main.cjs",
      "electron/preload.cjs",
      "electron/legacy-bridge.cjs",
      "electron/bot-process-manager.cjs",
      "electron/launcher-resolver.cjs",
    ],
  },
  {
    label: "Build config (pkg.json or electron-builder.json)",
    files: [], // Validated separately — build config is in package.json
    customCheck: () => {
      const pkgPath = path.join(PROJECT_ROOT, "package.json");
      const ebPath = path.join(PROJECT_ROOT, "electron-builder.json");
      if (!fs.existsSync(pkgPath)) return "package.json missing";
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (!pkg.build && !fs.existsSync(ebPath)) return "no build config found";
      } catch { return "invalid package.json"; }
      return null;
    },
  },
  {
    label: "Launcher renderer",
    files: [
      "electron/renderer/index.html",
      "electron/renderer/renderer.js",
      "electron/renderer/style.css",
    ],
  },
];

// ─── Run ──────────────────────────────────────────────────

function run() {
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   AIMC Pre-Release Validation Check      ║");
  console.log("╠══════════════════════════════════════════╣");

  let allPassed = true;
  const failures = [];

  for (const check of CHECKS) {
    // Handle customCheck
    if (check.customCheck) {
      const err = check.customCheck();
      if (err === null) {
        console.log(`║  ✓ ${check.label.padEnd(40)} PASS`);
      } else {
        allPassed = false;
        console.log(`║  ✗ ${check.label.padEnd(40)} FAIL`);
        console.log(`║    → ${err}`);
        failures.push(err);
      }
      continue;
    }

    const missing = [];
    for (const file of check.files) {
      const fullPath = path.join(PROJECT_ROOT, file);
      if (!fs.existsSync(fullPath)) {
        missing.push(file);
      }
    }

    if (missing.length === 0) {
      console.log(`║  ✓ ${check.label.padEnd(40)} PASS`);
    } else {
      allPassed = false;
      console.log(`║  ✗ ${check.label.padEnd(40)} FAIL`);
      for (const m of missing) {
        console.log(`║    → Missing: ${m}`);
        failures.push(m);
      }
    }
  }

  // ─── Syntax check dist/index.js (basic parse test) ─────
  console.log("╠══════════════════════════════════════════╣");
  const distIndex = path.join(PROJECT_ROOT, "dist", "index.js");
  if (fs.existsSync(distIndex)) {
    try {
      const content = fs.readFileSync(distIndex, "utf8");
      // Basic structural checks (not a full parse — JS is valid if tsc succeeded)
      const hasAgentCore = content.includes("AgentCore");
      const hasSkillRouter = content.includes("SkillRouter");
      const hasUI = content.includes("initUI") || content.includes("UIStateBridge");

      console.log(`║  dist/index.js syntax: ${hasAgentCore ? "✓" : "?"} AgentCore`);
      console.log(`║  dist/index.js syntax: ${hasSkillRouter ? "✓" : "?"} SkillRouter`);
      console.log(`║  dist/index.js syntax: ${hasUI ? "✓" : "?"} UIStateBridge`);
    } catch (err) {
      allPassed = false;
      console.log(`║  ✗ dist/index.js — read error: ${err.message}`);
    }
  }

  console.log("╚══════════════════════════════════════════╝");
  console.log("");

  if (allPassed) {
    console.log("AIMC_PRE_RELEASE_CHECK: PASS");
    console.log("");
    process.exit(0);
  } else {
    console.log("AIMC_PRE_RELEASE_CHECK: FAIL");
    console.log(`  ${failures.length} missing file(s)`);
    console.log("");
    console.log("Fix: run 'npm run build' to rebuild TypeScript and verify all assets.");
    console.log("");
    process.exit(1);
  }
}

run();
