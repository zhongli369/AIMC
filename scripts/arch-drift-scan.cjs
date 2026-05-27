/**
 * AIMC Architecture Drift Scanner — Phase 3-C Build-Time Enforcement
 *
 * Scans source files for architectural drift patterns that the
 * existing arch-guard-scan.cjs does not cover.
 *
 * Rule Groups:
 *   A — Execution Chain Integrity
 *   B — Bot Control Access
 *   C — AI Pipeline Integrity
 *   D — Skill System Integrity
 *
 * Usage:
 *   node scripts/arch-drift-scan.cjs              # scan and report
 *   node scripts/arch-drift-scan.cjs --json       # JSON output for CI
 *   node scripts/arch-drift-scan.cjs --no-composites  # skip composite checks
 *
 * This is a STATIC ANALYSIS tool only. No runtime overhead.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const ELECTRON_DIR = path.join(PROJECT_ROOT, "electron");

// ═══════════════════════════════════════════════════════════════
// Rule Definitions
// ═══════════════════════════════════════════════════════════════

/**
 * Each rule has:
 *   - id, group, description, severity
 *   - check(filePath, content): returns DriftViolation[] or []
 *   - exempt: files to skip
 */

const RULES = {
  // ─── GROUP A — Execution Chain Integrity ──────────

  A1_direct_dispatcher_import: {
    id: "A1",
    group: "A",
    severity: "CRITICAL",
    description: "Direct ActionDispatcher import outside authorized chain",
    explanation:
      "Only SkillRouter may import ActionDispatcher. Direct imports create bypass paths.",
    suggestedFix:
      "Route through SkillRouter.route(). Do not import ActionDispatcher directly.",
    exempt: [
      "skill-router.ts",
      "runtime/index.ts",
      "legacy-bridge.cjs",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
      "architecture-rules.ts",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      if (/import\s*\{[^}]*ActionDispatcher[^}]*\}\s*from/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "ActionDispatcher"))];
      }
      return [];
    },
  },

  A2_unknown_setDispatcher: {
    id: "A2",
    group: "A",
    severity: "HIGH",
    description: "setDispatcher() called outside authorized modules",
    explanation:
      "setDispatcher() wires SkillRouter to ActionDispatcher. Only legacy-bridge.cjs should call this.",
    suggestedFix:
      "All dispatch wiring must happen in legacy-bridge.cjs bootstrap only.",
    exempt: [
      "skill-router.ts",
      "legacy-bridge.cjs",
      "action-dispatcher.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
      "architecture-rules.ts",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      if (/\bsetDispatcher\s*\(/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "setDispatcher"))];
      }
      return [];
    },
  },

  A3_dispatch_loop_outside_router: {
    id: "A3",
    group: "A",
    severity: "HIGH",
    description: "IntentAction dispatch loop outside SkillRouter",
    explanation:
      "Dispatching IntentActions in a loop outside SkillRouter creates a bypass path.",
    suggestedFix:
      "Return IntentAction[] and let SkillRouter.route() dispatch them.",
    exempt: [
      "skill-router.ts",
      "action-dispatcher.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      // Pattern: for loop over actions calling dispatch
      if (/for\s*\(.*actions.*\)\s*\{[^}]*dispatch\s*\(/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "dispatch"))];
      }
      return [];
    },
  },

  // ─── GROUP B — Bot Control Access ──────────────────

  B1_direct_bot_calls: {
    id: "B1",
    group: "B",
    severity: "CRITICAL",
    description: "Direct bot API calls outside ActionDispatcher",
    explanation:
      "Direct bot.*() calls bypass ActionDispatcher and the token gate.",
    suggestedFix:
      "Create an IntentAction and dispatch through SkillRouter → ActionDispatcher.",
    exempt: [
      "action-dispatcher.ts",
      "legacy-bridge.cjs",       // Speech relay edge — bot.chat() for AI output delivery
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
      "architecture-rules.ts",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      // Skip legacy/ entirely (already covered by arch-guard-scan)
      if (normalized.includes("src/legacy/")) return [];
      // Skip reflex/ behaviors (sanctioned pre-AgentCore fast-reaction layer)
      if (normalized.includes("src/reflex/")) return [];
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      const botCallPattern = /\bbot\.(chat|dig|activateBlock|placeBlock|sleep|equip|consume|toss|whisper|lookAt|pathfinder\.goto|collectBlock\.collect|pvp\.attack)\s*\(/;
      if (botCallPattern.test(content)) {
        return [makeViolation(this, filePath, findLineRegex(content, botCallPattern))];
      }
      return [];
    },
  },

  B2_mineflayer_import_outside_auth: {
    id: "B2",
    group: "B",
    severity: "CRITICAL",
    description: "Mineflayer import outside authorized boundary",
    explanation:
      "Importing mineflayer outside authorized boundary enables creating secondary bot instances.",
    suggestedFix:
      "Use the existing bot instance via __RUNTIME_CONTEXT__ or ActionDispatcher.",
    exempt: [
      "mcdata.js",
      "action-dispatcher.ts",
      "legacy-bridge.cjs",
      "bot-runtime-manager.cjs",
      "runtime-context.cjs",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
      "minecraft.ts", // type-only import for BotRef interface
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      // Legacy mcdata.js is authorized (initBot factory)
      if (normalized.includes("src/legacy/")) return [];
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      if (/(import|require)\s*.*['"]mineflayer['"]/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "mineflayer"))];
      }
      return [];
    },
  },

  B3_direct_global_bot_usage: {
    id: "B3",
    group: "B",
    severity: "MEDIUM",
    description: "Direct globalThis.__BOT__ method calls outside bridge",
    explanation:
      "Calling methods on globalThis.__BOT__ directly bypasses the token gate.",
    suggestedFix:
      "Route through SkillRouter → ActionDispatcher. Do not call bot methods directly.",
    exempt: [
      "legacy-bridge.cjs",
      "action-dispatcher.ts",
      "runtime-context.cjs",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      if (/globalThis\.__BOT__\s*\.\s*\w+\s*\(/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "__BOT__"))];
      }
      return [];
    },
  },

  // ─── GROUP C — AI Pipeline Integrity ────────────────

  C1_new_llm_import: {
    id: "C1",
    group: "C",
    severity: "CRITICAL",
    description: "New LLM/SDK import outside authorized AI directories",
    explanation:
      "New LLM SDK imports suggest a second AI reasoning system. Only AgentCore may invoke LLMs.",
    suggestedFix:
      "All LLM invocation must go through AgentCore. Do not create secondary reasoning engines.",
    exempt: [
      "deepseek-v4-pro.ts",
      "agent-core.ts",
      "index.ts",
      "legacy-bridge.cjs",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
      "architecture-rules.ts",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      // Legacy model files are grandfathered (dead code but exist)
      if (normalized.includes("src/legacy/models/")) return [];
      // Exempt entire llm/ and agent/ directories for LLM imports
      if (normalized.includes("src/llm/") || normalized.includes("src/agent/")) return [];
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];

      const llmPattern = /(import|require)\s*.*(openai|anthropic|deepseek|groq|gemini|mistral|ollama|azure)/i;
      if (llmPattern.test(content)) {
        return [makeViolation(this, filePath, findLineRegex(content, llmPattern))];
      }
      return [];
    },
  },

  C2_new_ai_interval: {
    id: "C2",
    group: "C",
    severity: "HIGH",
    description: "New setInterval loop resembling an AI tick",
    explanation:
      "New async setInterval callbacks may indicate a parallel AI loop.",
    suggestedFix:
      "AI-driven loops must go through AgentCore.proactiveTick() or AgentCore.think().",
    exempt: [
      "bot-runtime-manager.cjs",
      "runtime-context.cjs",
      "legacy-bridge.cjs",
      "action-dispatcher.ts",
      "agent-core.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      // Look for async setInterval callbacks (potential AI loops)
      if (/setInterval\s*\(\s*async\s*\(/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "setInterval"))];
      }
      return [];
    },
  },

  C3_llm_plus_bot_control: {
    id: "C3",
    group: "C",
    severity: "CRITICAL",
    description: "Module imports both LLM SDK AND calls bot.*()",
    explanation:
      "A module combining LLM invocation and bot control is an independent AI agent — single brain violation.",
    suggestedFix:
      "Separate AI reasoning (AgentCore) from bot control (ActionDispatcher).",
    exempt: [
      "agent-core.ts",
      "action-dispatcher.ts",
      "legacy-bridge.cjs",
      "deepseek-v4-pro.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (normalized.includes("src/legacy/")) return [];
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];

      const hasLLM = /(import|require)\s*.*(openai|anthropic|deepseek|groq|gemini|mistral|ollama|azure)/i.test(content);
      const hasBotCall = /\bbot\.(chat|dig|activateBlock|placeBlock|sleep|equip|consume|toss|whisper|lookAt|pathfinder\.goto|collectBlock\.collect|pvp\.attack)\s*\(/.test(content);

      if (hasLLM && hasBotCall) {
        return [makeViolation(this, filePath, 1)];
      }
      return [];
    },
  },

  C4_autonomous_exec_loop: {
    id: "C4",
    group: "C",
    severity: "HIGH",
    description: "Autonomous plan execution loop outside SkillRouter",
    explanation:
      "An infinite loop dispatching actions outside SkillRouter is a parallel execution pipeline.",
    suggestedFix:
      "Use SkillRouter.executePlan() for multi-step plan execution.",
    exempt: [
      "action-dispatcher.ts",
      "skill-router.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      if (/while\s*\(\s*(true|!aborted|!stopped|running)\s*\).*dispatch/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "while"))];
      }
      return [];
    },
  },

  // ─── GROUP D — Skill System Integrity ────────────────

  D1_skill_imports_dispatcher: {
    id: "D1",
    group: "D",
    severity: "CRITICAL",
    description: "Skill file imports ActionDispatcher",
    explanation:
      "Skill definitions must NOT import ActionDispatcher. Skills return IntentAction[].",
    suggestedFix:
      "Remove ActionDispatcher import. Return IntentAction[] instead.",
    exempt: [
      "skill-router.ts",
      "architecture-rules.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      // Only check files in src/skill/
      if (!normalized.includes("src/skill/")) return [];
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      if (/import\s*\{[^}]*ActionDispatcher[^}]*\}\s*from/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "ActionDispatcher"))];
      }
      return [];
    },
  },

  D2_skill_calls_bot: {
    id: "D2",
    group: "D",
    severity: "CRITICAL",
    description: "Skill definition calls bot.*() directly",
    explanation:
      "Skills are action planners, not executors. Calling bot.*() bypasses the entire execution chain.",
    suggestedFix:
      "Replace bot.*() calls with IntentAction objects.",
    exempt: [
      "skill-router.ts",
      "architecture-rules.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      // Only check files in src/skill/
      if (!normalized.includes("src/skill/")) return [];
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      const botCallPattern = /\bbot\.(chat|dig|activateBlock|placeBlock|sleep|equip|consume|toss|whisper|lookAt|pathfinder\.goto|collectBlock\.collect|pvp\.attack)\s*\(/;
      if (botCallPattern.test(content)) {
        return [makeViolation(this, filePath, findLineRegex(content, botCallPattern))];
      }
      return [];
    },
  },

  D3_bypass_registry: {
    id: "D3",
    group: "D",
    severity: "HIGH",
    description: "Direct skill collection manipulation outside SkillRegistry",
    explanation:
      "Skills must be registered through SkillRegistry.register().",
    suggestedFix:
      "Use skillRegistry.register(skillDefinition) to add new skills.",
    exempt: [
      "skill-registry.ts",
      "skill-definitions.ts",
      "skill-router.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
      "architecture-rules.ts",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      if (/skills\s*\.\s*(set|push|add)\s*\(/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "skills"))];
      }
      return [];
    },
  },

  D4_skill_outside_dir: {
    id: "D4",
    group: "D",
    severity: "MEDIUM",
    description: "Skill-like export outside src/skill/ directory",
    explanation:
      "Skill definitions outside src/skill/ may not be properly registered.",
    suggestedFix:
      "Move skill definitions to src/skill/ and register in SkillRegistry.",
    exempt: [
      "skill-definitions.ts",
      "skill-registry.ts",
      "skill-router.ts",
      "task-planner.ts",
      "agent-core.ts",
      "proactive-engine.ts",
      "architecture-rules.ts",
      "arch-guard-scan.cjs",
      "arch-drift-scan.cjs",
    ],
    check(filePath, content) {
      const normalized = filePath.replace(/\\/g, "/");
      // Skip files already in src/skill/ (except exempt)
      if (normalized.includes("src/skill/")) return [];
      if (normalized.includes("src/legacy/")) return [];
      if (this.exempt.some((f) => normalized.endsWith(f))) return [];
      // Look for exported objects that look like skill definitions
      if (/export\s+(const|function)\s+\w*[Ss]kill/.test(content) &&
          /plan\s*\(/.test(content)) {
        return [makeViolation(this, filePath, findLine(content, "export"))];
      }
      return [];
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function makeViolation(rule, filePath, line) {
  return {
    ruleId: rule.id,
    group: rule.group,
    severity: rule.severity,
    file: relativePath(filePath),
    line,
    explanation: rule.explanation,
    suggestedFix: rule.suggestedFix,
  };
}

function findLine(content, search) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(search)) return i + 1;
  }
  return -1;
}

function findLineRegex(content, regex) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) return i + 1;
  }
  return -1;
}

function relativePath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
}

function collectSourceFiles(dir, extensions = [".ts", ".js", ".cjs"]) {
  const files = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    if (d.includes("node_modules") || d.includes(".git")) return;

    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
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

// ═══════════════════════════════════════════════════════════════
// Scan
// ═══════════════════════════════════════════════════════════════

function scan(options = {}) {
  const { skipComposites = false } = options;

  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  AIMC Architecture Drift Scanner         ║");
  console.log("║  Phase 3-C — Drift Prevention System    ║");
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

    // Skip composite rules if requested
    if (skipComposites && rule.id === "C3") continue;

    let ruleViolations = 0;

    for (const file of allFiles) {
      // Skip legacy/ entirely — sealed/shrink-wrapped dead code
      if (relativePath(file).startsWith("src/legacy/")) continue;

      try {
        const content = fs.readFileSync(file, "utf8");
        const violations = rule.check(file, content);
        allViolations.push(...violations);
        ruleViolations += violations.length;
      } catch (e) {
        console.error(`  ERROR reading ${relativePath(file)}: ${e.message}`);
      }
    }

    if (ruleViolations > 0) {
      console.log(`  ❌ ${rule.id} [${rule.group}]: ${ruleViolations} violation(s) — ${rule.description}`);
    } else {
      console.log(`  ✅ ${rule.id} [${rule.group}]: PASSED`);
    }
  }

  console.log("");

  // Group by severity for the report
  const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  for (const v of allViolations) {
    bySeverity[v.severity].push(v);
  }

  const hasBlockers = bySeverity.CRITICAL.length > 0 || bySeverity.HIGH.length > 0;
  const passed = allViolations.length === 0;

  // ─── Output ARCH_DRIFT_REPORT ─────────────────────
  if (allViolations.length > 0) {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║  ARCH_DRIFT_REPORT                      ║");
    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  CRITICAL: ${bySeverity.CRITICAL.length}  HIGH: ${bySeverity.HIGH.length}  MEDIUM: ${bySeverity.MEDIUM.length}  LOW: ${bySeverity.LOW.length}`);
    console.log("╠══════════════════════════════════════════╣");

    // Print violations grouped by file
    const byFile = {};
    for (const v of allViolations) {
      if (!byFile[v.file]) byFile[v.file] = [];
      byFile[v.file].push(v);
    }

    for (const [file, violations] of Object.entries(byFile)) {
      console.log("║");
      console.log(`║  File: ${file}`);
      for (const v of violations) {
        const loc = v.line && v.line > 0 ? `L${v.line}` : "?";
        console.log(`║    [${v.severity}] [${v.ruleId}] ${loc}: ${v.explanation}`);
        console.log(`║           Fix: ${v.suggestedFix}`);
      }
    }

    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  Total: ${allViolations.length} violation(s) in ${Object.keys(byFile).length} file(s)`);
    console.log("╚══════════════════════════════════════════╝");
    console.log("");

    if (hasBlockers) {
      console.log("❌ ARCH_DRIFT_SCAN FAILED: Architecture drift detected.");
      console.log("   CRITICAL/HIGH violations block the build.");
      console.log("");
    } else {
      console.log("⚠️  ARCH_DRIFT_SCAN WARNING: Low/Medium drift detected.");
      console.log("   Review before proceeding to Phase 4.");
      console.log("");
    }
  }

  // ─── Summary ─────────────────────────────────────
  if (passed) {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║  Architecture Drift Scan: PASSED        ║");
    console.log("║  No drift detected.                     ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log("");
  }

  return {
    timestamp: new Date().toISOString(),
    totalFilesScanned: allFiles.length,
    totalViolations: allViolations.length,
    violations: allViolations,
    passed,
    hasBlockers,
  };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const skipComposites = args.includes("--no-composites");

  const report = scan({ skipComposites });

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (report.hasBlockers && !jsonOutput) {
    process.exit(1);
  }
}

main();
