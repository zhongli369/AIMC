/**
 * AIMC Architecture Guard Scan — Build-Time Enforcement
 *
 * Scans source files for architecture violations before compilation.
 * Any violation causes the build to FAIL.
 *
 * Phase 2.6: Final Architecture Lock
 *
 * Single Execution Chain:
 *   AgentCore → RuntimeCore(validate-only) → SkillRouter → ActionDispatcher → Mineflayer
 *
 * Usage:
 *   node scripts/arch-guard-scan.js           # scan and report
 *   node scripts/arch-guard-scan.js --strict  # strict mode (default)
 *   node scripts/arch-guard-scan.js --json    # JSON output for CI
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const ELECTRON_DIR = path.join(PROJECT_ROOT, "electron");

// ═══════════════════════════════════════════════════════════════
// Rule Definitions
// ═══════════════════════════════════════════════════════════════

const RULES = {
  direct_dispatcher_import: {
    severity: "critical",
    description: "ActionDispatcher imported outside authorized files (SkillRouter, runtime/index, legacy-bridge)",
    scan: (filePath, content) => {
      const normalized = filePath.replace(/\\/g, "/");
      // Authorized files that may import ActionDispatcher directly
      const authorized = [
        "skill-router.ts",
        "runtime/index.ts",
        "legacy-bridge.cjs",
        "bot-runtime-manager.cjs",
      ];
      if (authorized.some((f) => normalized.endsWith(f))) return [];
      if (normalized.endsWith("arch-guard-scan.cjs")) return [];

      const violations = [];
      // Check for ActionDispatcher import
      if (/import\s*\{[^}]*ActionDispatcher[^}]*\}\s*from/.test(content)) {
        violations.push({
          file: filePath,
          line: findLine(content, "ActionDispatcher"),
          code: "direct_dispatcher_import",
          message: "Direct ActionDispatcher import outside authorized chain. Route through SkillRouter.",
        });
      }
      // Check for require of ActionDispatcher in CJS files
      if (/require\s*\([^)]*action-dispatcher/.test(content)) {
        violations.push({
          file: filePath,
          line: findLine(content, "action-dispatcher"),
          code: "direct_dispatcher_import",
          message: "Direct ActionDispatcher require outside authorized chain. Route through SkillRouter.",
        });
      }
      return violations;
    },
  },

  removed_api_process_output: {
    severity: "critical",
    description: "Call to removed API RuntimeCore.processAgentOutput() — use RuntimeCore.validate() instead",
    scan: (filePath, content) => {
      const normalized = filePath.replace(/\\/g, "/");
      // Skip this file itself and legacy comments
      if (normalized.endsWith("arch-guard-scan.cjs")) return [];
      if (normalized.endsWith("arch-guard-scan.js")) return [];

      const violations = [];
      // Check for the removed method call (not in comments)
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment lines
        if (/^\s*(\/\/|\*|\/\*\*)/.test(line.trim())) continue;
        if (line.includes("processAgentOutput")) {
          violations.push({
            file: filePath,
            line: i + 1,
            code: "removed_api_process_output",
            message: `Line ${i + 1}: Call to removed RuntimeCore.processAgentOutput(). Use RuntimeCore.validate() for validation, SkillRouter.route() for execution.`,
          });
        }
      }
      return violations;
    },
  },

  legacy_bot_control: {
    severity: "critical",
    description: "Direct mineflayer bot control outside legacy boundary and ActionDispatcher",
    scan: (filePath, content) => {
      // Normalize path for cross-platform matching
      const normalized = filePath.replace(/\\/g, "/");

      // Authorized files
      const authorized = [
        "action-dispatcher.ts",
        "legacy-bridge.cjs",
        "runtime-context.cjs",
      ];
      // Files in src/legacy/ are allowed (skill provider only, grandfathered)
      if (authorized.some((f) => normalized.endsWith(f))) return [];
      if (normalized.includes("src/legacy/")) return [];
      // Test files are allowed
      if (normalized.includes("test-")) return [];
      // This scan script
      if (normalized.endsWith("arch-guard-scan.cjs")) return [];

      const violations = [];
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(\/\/|\*|\/\*\*)/.test(line.trim())) continue;

        // Check for direct bot property access patterns that modify state
        // e.g. this.bot.chat(, this.bot.dig(, this.bot.activateBlock(, etc.
        const dangerousPatterns = [
          /\bbot\.chat\s*\(/,
          /\bbot\.dig\s*\(/,
          /\bbot\.activateBlock\s*\(/,
          /\bbot\.placeBlock\s*\(/,
          /\bbot\.sleep\s*\(/,
          /\bbot\.equip\s*\(/,
          /\bbot\.consume\s*\(/,
          /\bbot\.toss\s*\(/,
          /\bbot\.whisper\s*\(/,
          /\bbot\.lookAt\s*\(/,
          /\bbot\.pathfinder\.goto\s*\(/,
          /\bbot\.collectBlock\.collect\s*\(/,
          /\bbot\.pvp\.attack\s*\(/,
        ];
        for (const pattern of dangerousPatterns) {
          if (pattern.test(line)) {
            violations.push({
              file: filePath,
              line: i + 1,
              code: "legacy_bot_control",
              message: `Line ${i + 1}: Direct bot API call outside ActionDispatcher. All bot control must go through ActionDispatcher.dispatch().`,
            });
            break; // One violation per line is enough
          }
        }
      }
      return violations;
    },
  },

  token_manipulation: {
    severity: "critical",
    description: "Manipulation of __AIMC_SKILLROUTER_TOKEN__ outside authorized files",
    scan: (filePath, content) => {
      const normalized = filePath.replace(/\\/g, "/");
      const authorized = [
        "skill-router.ts",
        "action-dispatcher.ts",
        "legacy-bridge.cjs",
      ];
      if (authorized.some((f) => normalized.endsWith(f))) return [];
      if (normalized.endsWith("arch-guard-scan.cjs")) return [];
      if (normalized.endsWith("arch-guard-scan.js")) return [];

      const violations = [];
      if (content.includes("__AIMC_SKILLROUTER_TOKEN__")) {
        violations.push({
          file: filePath,
          line: findLine(content, "__AIMC_SKILLROUTER_TOKEN__"),
          code: "token_manipulation",
          message: "Unauthorized manipulation of __AIMC_SKILLROUTER_TOKEN__. Only SkillRouter may set/clear this token.",
        });
      }
      return violations;
    },
  },

  runtime_execution: {
    severity: "critical",
    description: "RuntimeCore used for execution (not validation-only)",
    scan: (filePath, content) => {
      const normalized = filePath.replace(/\\/g, "/");
      // Authorized: runtime-core.ts itself, agent-core.ts (calls validate()), test files
      const authorized = [
        "runtime-core.ts",
        "agent-core.ts",
        "legacy-bridge.cjs",
        "legacy/agent/agent.js",
      ];
      if (authorized.some((f) => normalized.endsWith(f))) return [];
      if (normalized.includes("test-")) return [];
      if (normalized.endsWith("arch-guard-scan.cjs")) return [];
      if (normalized.endsWith("arch-guard-scan.js")) return [];

      const violations = [];
      // Check for direct dispatcher usage from RuntimeCore context
      if (/runtimeCore\s*\.\s*setDispatcher/.test(content)) {
        violations.push({
          file: filePath,
          line: findLine(content, "setDispatcher"),
          code: "runtime_execution",
          message: "RuntimeCore.setDispatcher() called outside authorized files. RuntimeCore is validation-only (Phase 2.5).",
        });
      }
      return violations;
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function findLine(content, search) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(search)) return i + 1;
  }
  return -1;
}

function collectSourceFiles(dir, extensions = [".ts", ".js", ".cjs"]) {
  const files = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    // Skip dist/, node_modules/, .git/
    if (d.includes("node_modules") || d.includes(".git")) return;

    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        // Skip dist directory
        if (entry.name === "dist") continue;
        walk(full);
      } else if (extensions.some((ext) => full.endsWith(ext))) {
        files.push(full);
      }
    }
  }
  walk(dir);
  return files;
}

function relativePath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
}

// ═══════════════════════════════════════════════════════════════
// Scan
// ═══════════════════════════════════════════════════════════════

function scan() {
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  AIMC Architecture Guard Scan           ║");
  console.log("║  Phase 2.6 — Final Architecture Lock    ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");

  // Collect all source files
  const srcFiles = collectSourceFiles(SRC_DIR);
  const electronFiles = collectSourceFiles(ELECTRON_DIR);
  const allFiles = [...srcFiles, ...electronFiles];

  console.log(`Scanning ${allFiles.length} source files...`);
  console.log(`  src/:      ${srcFiles.length} files`);
  console.log(`  electron/: ${electronFiles.length} files`);
  console.log("");

  // Run all rules
  const allViolations = [];
  const ruleNames = Object.keys(RULES);

  for (const ruleName of ruleNames) {
    const rule = RULES[ruleName];
    let ruleViolations = 0;

    for (const file of allFiles) {
      try {
        const content = fs.readFileSync(file, "utf8");
        const violations = rule.scan(file, content);
        allViolations.push(...violations.map((v) => ({ ...v, rule: ruleName })));
        ruleViolations += violations.length;
      } catch (e) {
        console.error(`  ERROR reading ${relativePath(file)}: ${e.message}`);
      }
    }

    if (ruleViolations > 0) {
      console.log(`  ❌ ${ruleName}: ${ruleViolations} violation(s) — ${rule.description}`);
    } else {
      console.log(`  ✅ ${ruleName}: PASSED`);
    }
  }

  console.log("");

  // Report all violations
  if (allViolations.length > 0) {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║  ARCHITECTURE VIOLATIONS DETECTED       ║");
    console.log("╠══════════════════════════════════════════╣");

    // Group by file
    const byFile = {};
    for (const v of allViolations) {
      const rel = relativePath(v.file);
      if (!byFile[rel]) byFile[rel] = [];
      byFile[rel].push(v);
    }

    for (const [file, violations] of Object.entries(byFile)) {
      console.log(`║`);
      console.log(`║  File: ${file}`);
      for (const v of violations) {
        console.log(`║    [${v.code}] L${v.line}: ${v.message}`);
      }
    }

    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  Total: ${allViolations.length} violation(s)`);
    console.log("║");
    console.log("║  REQUIRED FIX:");
    console.log("║  All actions must flow through:");
    console.log("║  AgentCore → SkillRouter → ActionDispatcher → Mineflayer");
    console.log("╚══════════════════════════════════════════╝");
    console.log("");

    console.log("❌ BUILD FAILED: Architecture guard scan detected violations.");
    console.log("");
    return false;
  }

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Architecture Guard Scan: PASSED        ║");
  console.log("║  Single Execution Chain: VERIFIED       ║");
  console.log("║  AgentCore→SkillRouter→Dispatcher→Bot   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");

  const passed = scan();

  if (jsonOutput) {
    console.log(JSON.stringify({ passed, timestamp: new Date().toISOString() }));
  }

  if (!passed) {
    process.exit(1);
  }
}

main();
