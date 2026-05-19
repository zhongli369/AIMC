/**
 * Architecture Rules Engine — Phase 3-C Drift Prevention System.
 *
 * Defines typed rule groups that detect architectural drift.
 * Rules are consumed by scripts/arch-drift-scan.cjs at build time.
 *
 * This module does NOT execute at runtime. It is a type-level
 * specification of what constitutes an architecture violation.
 *
 * Zero runtime overhead. Build-time static analysis only.
 */
// ─── Canonical Architecture ─────────────────────────
/**
 * The SINGLE valid execution chain.
 * Any deviation from this is a CRITICAL violation.
 */
export const CANONICAL_EXECUTION_CHAIN = [
    "AgentCore",
    "RuntimeCore.validate",
    "SkillRouter.route",
    "ActionDispatcher.dispatch",
    "Mineflayer",
];
/**
 * Modules authorized to import ActionDispatcher directly.
 */
export const AUTHORIZED_DISPATCHER_IMPORTERS = [
    "skill-router.ts",
    "runtime/index.ts",
    "legacy-bridge.cjs",
    "arch-guard-scan.cjs",
    "arch-drift-scan.cjs",
];
/**
 * Modules authorized to call bot.*() directly.
 * ONLY ActionDispatcher.
 */
export const AUTHORIZED_BOT_CALLERS = [
    "action-dispatcher.ts",
    "legacy-bridge.cjs", // only for passing bot ref, NOT calling bot.*
];
/**
 * Directories authorized for LLM/SDK imports.
 */
export const AUTHORIZED_LLM_DIRECTORIES = [
    "src/llm/",
    "src/agent/",
];
/**
 * Files that define the runtime entry point (allowed to wire globals).
 */
export const AUTHORIZED_GLOBAL_WRITERS = [
    "legacy-bridge.cjs",
    "runtime-context.cjs",
    "skill-router.ts",
    "index.ts",
];
// ─── Rule Groups ─────────────────────────────────────
/**
 * GROUP A — Execution Chain Integrity
 *
 * The system has exactly ONE execution chain:
 *   AgentCore → RuntimeCore.validate → SkillRouter → ActionDispatcher → Mineflayer
 *
 * Any alternative execution chain, bypass of SkillRouter, or direct
 * ActionDispatcher invocation outside authorized modules is a violation.
 */
export const RULE_GROUP_A = [
    {
        id: "A1",
        group: "A",
        description: "Direct ActionDispatcher import outside authorized chain",
        severity: "CRITICAL",
        pattern: {
            forbiddenImport: /import\s*\{[^}]*ActionDispatcher[^}]*\}\s*from/,
            exemptFiles: [
                "skill-router.ts",
                "runtime/index.ts",
                "legacy-bridge.cjs",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
                "architecture-rules.ts",
            ],
            explanation: "Only SkillRouter may import ActionDispatcher. Direct imports create bypass paths that circumvent the token gate.",
            suggestedFix: "Route through SkillRouter.route(). Do not import ActionDispatcher directly.",
        },
    },
    {
        id: "A2",
        group: "A",
        description: "New execution pipeline wiring (SkillRouter → unknown consumer)",
        severity: "HIGH",
        pattern: {
            contentMatch: /\bsetDispatcher\s*\(/,
            exemptFiles: [
                "skill-router.ts",
                "legacy-bridge.cjs",
                "action-dispatcher.ts",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
                "architecture-rules.ts",
            ],
            explanation: "setDispatcher() wires SkillRouter to ActionDispatcher. Only legacy-bridge.cjs should call this. Other callers suggest a parallel execution pipeline.",
            suggestedFix: "All dispatch wiring must happen in legacy-bridge.cjs bootstrap only.",
        },
    },
    {
        id: "A3",
        group: "A",
        description: "New IntentAction dispatch loop outside SkillRouter",
        severity: "HIGH",
        pattern: {
            contentMatch: /for\s*\(.*actions.*\)\s*\{[^}]*dispatch\s*\(/,
            exemptFiles: [
                "skill-router.ts",
                "action-dispatcher.ts",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
            ],
            explanation: "Dispatching IntentActions in a loop outside SkillRouter creates a bypass path. Only SkillRouter iterates and dispatches actions.",
            suggestedFix: "Return IntentAction[] and let SkillRouter.route() dispatch them.",
        },
    },
];
// ─────────────────────────────────────────────────────
/**
 * GROUP B — Bot Control Access
 *
 * ActionDispatcher is the ONLY module authorized to call bot.*().
 * Any other module calling Mineflayer API directly is a violation.
 */
export const RULE_GROUP_B = [
    {
        id: "B1",
        group: "B",
        description: "Direct bot API calls outside ActionDispatcher",
        severity: "CRITICAL",
        pattern: {
            contentMatch: /\bbot\.(chat|dig|activateBlock|placeBlock|sleep|equip|consume|toss|whisper|lookAt|pathfinder\.goto|collectBlock\.collect|pvp\.attack)\s*\(/,
            exemptFiles: [
                "action-dispatcher.ts",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
                "architecture-rules.ts",
            ],
            explanation: "Direct bot.*() calls bypass ActionDispatcher and the token gate. All bot control must go through ActionDispatcher.dispatch().",
            suggestedFix: "Create an IntentAction and dispatch through SkillRouter → ActionDispatcher.",
        },
    },
    {
        id: "B2",
        group: "B",
        description: "Mineflayer createBot import outside legacy/lib boundary",
        severity: "CRITICAL",
        pattern: {
            contentMatch: /(import|require)\s*.*mineflayer/,
            exemptFiles: [
                "mcdata.js",
                "action-dispatcher.ts",
                "legacy-bridge.cjs",
                "bot-runtime-manager.cjs",
                "runtime-context.cjs",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
            ],
            explanation: "Importing mineflayer outside the authorized boundary enables creating secondary bot instances, which would bypass ActionDispatcher.",
            suggestedFix: "Use the existing bot instance from __BOT__ (in bridge) or go through ActionDispatcher.",
        },
    },
    {
        id: "B3",
        group: "B",
        description: "Direct globalThis.__BOT__ usage outside bridge context",
        severity: "MEDIUM",
        pattern: {
            contentMatch: /globalThis\.__BOT__\s*\.\s*\w+\s*\(/,
            exemptFiles: [
                "legacy-bridge.cjs",
                "action-dispatcher.ts",
                "runtime-context.cjs",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
            ],
            explanation: "Calling methods on globalThis.__BOT__ directly bypasses the token gate. Use ActionDispatcher.dispatch() instead.",
            suggestedFix: "Route through SkillRouter → ActionDispatcher. Do not call bot methods directly.",
        },
    },
];
// ─────────────────────────────────────────────────────
/**
 * GROUP C — AI Pipeline Integrity
 *
 * AgentCore is the ONLY AI decision system. The system must have
 * exactly ONE LLM invocation path, ONE reasoning engine, and
 * ZERO parallel AI loops.
 */
export const RULE_GROUP_C = [
    {
        id: "C1",
        group: "C",
        description: "New LLM/SDK import outside authorized AI directories",
        severity: "CRITICAL",
        pattern: {
            contentMatch: /(import|require)\s*.*(openai|anthropic|deepseek|groq|gemini|mistral|ollama|azure)/i,
            exemptFiles: [
                "deepseek-v4-pro.ts",
                "agent-core.ts",
                "index.ts",
                "model_map.js",
                "legacy-bridge.cjs",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
                "deepseek.js",
                "claude.js",
                "gpt.js",
                "gemini.js",
                "groq.js",
                "mistral.js",
                "ollama.js",
                "azure.js",
                "prompter.js",
                "huggingface.js",
                "replicate.js",
                "vllm.js",
                "openrouter.js",
                "cerebras.js",
                "glhf.js",
                "hyperbolic.js",
                "lmstudio.js",
                "mercury.js",
                "novita.js",
                "qwen.js",
                "grok.js",
                "settings.js",
            ],
            explanation: "New LLM SDK imports outside src/llm/ or src/agent/ suggest a second AI reasoning system. Only AgentCore may invoke LLMs.",
            suggestedFix: "All LLM invocation must go through AgentCore. Do not create secondary reasoning engines.",
        },
    },
    {
        id: "C2",
        group: "C",
        description: "New setInterval loop that resembles an AI tick",
        severity: "HIGH",
        pattern: {
            contentMatch: /setInterval\s*\(\s*(async\s*)?\([^)]*\)\s*(:\s*\w+)?\s*=>\s*\{/,
            exemptFiles: [
                "bot-runtime-manager.cjs",
                "runtime-context.cjs",
                "legacy-bridge.cjs",
                "action-dispatcher.ts",
                "agent-core.ts",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
            ],
            explanation: "New setInterval callbacks that contain async logic may indicate a parallel AI loop. Only authorized infrastructure intervals are allowed.",
            suggestedFix: "All AI-driven loops must go through AgentCore.proactiveTick() or AgentCore.think(). Do not create standalone AI intervals.",
        },
    },
    {
        id: "C3",
        group: "C",
        description: "New module that both imports LLM SDK AND calls bot.*()",
        severity: "CRITICAL",
        pattern: {
            contentMatch: undefined, // Composite check: files match both LLM import and bot.* call
            explanation: "A module that both calls an LLM SDK AND directly controls the bot is an independent AI agent — a violation of the single brain rule.",
            suggestedFix: "Separate AI reasoning (AgentCore) from bot control (ActionDispatcher). Never combine them in one module.",
        },
    },
    {
        id: "C4",
        group: "C",
        description: "New autonomous plan execution loop",
        severity: "HIGH",
        pattern: {
            contentMatch: /while\s*\(\s*(true|!aborted|!stopped|running)\s*\).*dispatch/,
            exemptFiles: [
                "action-dispatcher.ts",
                "skill-router.ts",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
            ],
            explanation: "An infinite loop that dispatches actions outside SkillRouter is a parallel execution pipeline.",
            suggestedFix: "Use SkillRouter.executePlan() for multi-step plan execution.",
        },
    },
];
// ─────────────────────────────────────────────────────
/**
 * GROUP D — Skill System Integrity
 *
 * Skills are pure functions that return IntentAction[].
 * They MUST NOT:
 *   - Call bot.*() directly
 *   - Import ActionDispatcher
 *   - Execute side effects internally
 *   - Bypass SkillRegistry/SkillRouter
 */
export const RULE_GROUP_D = [
    {
        id: "D1",
        group: "D",
        description: "Skill definition file imports ActionDispatcher",
        severity: "CRITICAL",
        pattern: {
            contentMatch: undefined, // Applied only to files in src/skill/
            explanation: "Skill definitions must NOT import ActionDispatcher. Skills return IntentAction[] and SkillRouter dispatches them.",
            suggestedFix: "Remove ActionDispatcher import. Return IntentAction[] instead of dispatching directly.",
        },
    },
    {
        id: "D2",
        group: "D",
        description: "Skill definition calls bot.*() directly",
        severity: "CRITICAL",
        pattern: {
            contentMatch: undefined, // Applied only to files in src/skill/
            explanation: "Skills are action planners, not executors. Calling bot.*() inside a skill bypasses the entire execution chain.",
            suggestedFix: "Replace bot.*() calls with IntentAction objects. Let ActionDispatcher execute them.",
        },
    },
    {
        id: "D3",
        group: "D",
        description: "New skill registration that bypasses SkillRegistry",
        severity: "HIGH",
        pattern: {
            contentMatch: /skills\s*\.\s*(set|push|add)\s*\(/,
            exemptFiles: [
                "skill-registry.ts",
                "skill-definitions.ts",
                "skill-router.ts",
                "arch-guard-scan.cjs",
                "arch-drift-scan.cjs",
                "architecture-rules.ts",
            ],
            explanation: "Skills must be registered through SkillRegistry.register(). Direct manipulation of internal storage bypasses validation.",
            suggestedFix: "Use skillRegistry.register(skillDefinition) to add new skills.",
        },
    },
    {
        id: "D4",
        group: "D",
        description: "New skill file outside src/skill/ directory",
        severity: "MEDIUM",
        pattern: {
            contentMatch: /export\s+(const|function)\s+\w*[Ss]kill/,
            exemptFiles: [
                "skill-definitions.ts",
                "skill-registry.ts",
                "skill-router.ts",
                "task-planner.ts",
                "agent-core.ts",
                "proactive-engine.ts",
                "architecture-rules.ts",
            ],
            explanation: "Skill definitions should live in src/skill/. Skills defined elsewhere may not be properly registered or validated.",
            suggestedFix: "Move skill definitions to src/skill/ and register them in SkillRegistry.",
        },
    },
];
// ─── All Rules ───────────────────────────────────────
export const ALL_RULES = [
    ...RULE_GROUP_A,
    ...RULE_GROUP_B,
    ...RULE_GROUP_C,
    ...RULE_GROUP_D,
];
export const RULE_COUNT = ALL_RULES.length;
// ─── CLAUDE.md Compliance ────────────────────────────
/**
 * Check whether the given execution chain description matches
 * the canonical chain defined in CLAUDE.md.
 *
 * This is a SOFT check — it warns but does not block.
 */
export function checkClaudeMdCompliance(claimedChain) {
    const mismatches = [];
    for (let i = 0; i < CANONICAL_EXECUTION_CHAIN.length; i++) {
        if (i >= claimedChain.length) {
            mismatches.push(`Missing step at position ${i}: expected "${CANONICAL_EXECUTION_CHAIN[i]}"`);
            continue;
        }
        if (claimedChain[i] !== CANONICAL_EXECUTION_CHAIN[i]) {
            mismatches.push(`Position ${i}: expected "${CANONICAL_EXECUTION_CHAIN[i]}", got "${claimedChain[i]}"`);
        }
    }
    if (claimedChain.length > CANONICAL_EXECUTION_CHAIN.length) {
        for (let i = CANONICAL_EXECUTION_CHAIN.length; i < claimedChain.length; i++) {
            mismatches.push(`Extra step at position ${i}: "${claimedChain[i]}" (not in canonical chain)`);
        }
    }
    return {
        compliant: mismatches.length === 0,
        mismatches,
    };
}
//# sourceMappingURL=architecture-rules.js.map