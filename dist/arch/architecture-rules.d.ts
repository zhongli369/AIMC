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
export type DriftSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RuleGroup = "A" | "B" | "C" | "D";
export interface DriftRule {
    /** Rule identifier */
    id: string;
    /** Rule group (A/B/C/D) */
    group: RuleGroup;
    /** Human-readable description */
    description: string;
    /** Severity level */
    severity: DriftSeverity;
    /** What pattern to look for */
    pattern: DriftPattern;
}
export interface DriftPattern {
    /** Regex or substring match on import statements */
    forbiddenImport?: RegExp;
    /** Files that are exempted from this rule */
    exemptFiles?: string[];
    /** Regex on file content */
    contentMatch?: RegExp;
    /** Substring to search for */
    contentContains?: string;
    /** Whether to check only files added/modified (not existing authorized files) */
    newFilesOnly?: boolean;
    /** Human-readable explanation of why this pattern is a violation */
    explanation: string;
    /** Suggested fix */
    suggestedFix: string;
}
export interface DriftViolation {
    ruleId: string;
    group: RuleGroup;
    severity: DriftSeverity;
    file: string;
    line?: number;
    explanation: string;
    suggestedFix: string;
}
export interface DriftReport {
    timestamp: string;
    totalFilesScanned: number;
    totalViolations: number;
    violations: DriftViolation[];
    passed: boolean;
}
/**
 * The SINGLE valid execution chain.
 * Any deviation from this is a CRITICAL violation.
 */
export declare const CANONICAL_EXECUTION_CHAIN: readonly ["AgentCore", "RuntimeCore.validate", "SkillRouter.route", "ActionDispatcher.dispatch", "Mineflayer"];
/**
 * Modules authorized to import ActionDispatcher directly.
 */
export declare const AUTHORIZED_DISPATCHER_IMPORTERS: string[];
/**
 * Modules authorized to call bot.*() directly.
 * ONLY ActionDispatcher.
 */
export declare const AUTHORIZED_BOT_CALLERS: string[];
/**
 * Directories authorized for LLM/SDK imports.
 */
export declare const AUTHORIZED_LLM_DIRECTORIES: string[];
/**
 * Files that define the runtime entry point (allowed to wire globals).
 */
export declare const AUTHORIZED_GLOBAL_WRITERS: string[];
/**
 * GROUP A — Execution Chain Integrity
 *
 * The system has exactly ONE execution chain:
 *   AgentCore → RuntimeCore.validate → SkillRouter → ActionDispatcher → Mineflayer
 *
 * Any alternative execution chain, bypass of SkillRouter, or direct
 * ActionDispatcher invocation outside authorized modules is a violation.
 */
export declare const RULE_GROUP_A: DriftRule[];
/**
 * GROUP B — Bot Control Access
 *
 * ActionDispatcher is the ONLY module authorized to call bot.*().
 * Any other module calling Mineflayer API directly is a violation.
 */
export declare const RULE_GROUP_B: DriftRule[];
/**
 * GROUP C — AI Pipeline Integrity
 *
 * AgentCore is the ONLY AI decision system. The system must have
 * exactly ONE LLM invocation path, ONE reasoning engine, and
 * ZERO parallel AI loops.
 */
export declare const RULE_GROUP_C: DriftRule[];
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
export declare const RULE_GROUP_D: DriftRule[];
export declare const ALL_RULES: DriftRule[];
export declare const RULE_COUNT: number;
/**
 * Check whether the given execution chain description matches
 * the canonical chain defined in CLAUDE.md.
 *
 * This is a SOFT check — it warns but does not block.
 */
export declare function checkClaudeMdCompliance(claimedChain: string[]): {
    compliant: boolean;
    mismatches: string[];
};
//# sourceMappingURL=architecture-rules.d.ts.map