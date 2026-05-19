/**
 * SkillRouter — SOLE execution entry point for ALL AgentOutput.
 *
 * This is the ONLY path from AI decision to Minecraft action:
 *   AgentCore → RuntimeCore.validate() → SkillRouter.route() → ActionDispatcher → Mineflayer
 *
 * Handles three intent types:
 *   - "chat"  → dispatch validated actions directly
 *   - "skill" → look up skill, plan actions, dispatch (with retry + fallback)
 *   - "plan"  → decompose plan steps, execute sequentially (with lifecycle)
 *
 * Phase 3-A additions:
 *   - Retry mechanism (max 2, exponential backoff 100→300→600ms)
 *   - Fallback skill chain (registry-level mapping, max 2 hops)
 *   - Execution telemetry (AIMC_SKILL_TRACE structured logs)
 *   - Plan step lifecycle (pending/running/success/failed/retrying/skipped)
 *
 * SkillRouter sets a caller token before dispatching so ActionDispatcher
 * can verify the caller is authorized. Token is cleared in finally block.
 */
import type { AgentOutput, ExecutionResult } from "../interfaces/intent.js";
import type { ActionDispatcher } from "../runtime/action-dispatcher.js";
import type { SkillContext } from "./skill-definitions.js";
import { SkillRegistry } from "./skill-registry.js";
import type { SkillExecutionResult, PlanStepStatus } from "./types/skill-result.js";
import type { VoicePressureSignal } from "../voice/voice-pressure.js";
import type { TacticalRecommendation, TacticalSkillBias } from "../team/tactical-analyzer.js";
import type { CompanionRole } from "../role/role-identity.js";
import type { RelationshipSnapshot } from "../memory/relationship-state.js";
import type { ExperienceCategory } from "../memory/shared-experience.js";
import { SkillFailureTracker, ActionLoopDetector } from "../behavior/stability/stuck-detector.js";
import { BehaviorTimeline } from "../observability/behavior-timeline.js";
import type { RuntimeTraceRecorder } from "../observability/runtime-trace.js";
export interface PlanStep {
    step: number;
    action: string;
    skill?: string;
    params: Record<string, unknown>;
}
export interface TaskPlan {
    goal: string;
    steps: PlanStep[];
}
export interface PlanExecutionResult {
    goal: string;
    completed: boolean;
    stepsCompleted: number;
    stepsTotal: number;
    currentStep: number;
    results: ExecutionResult[];
    message: string;
    /** Per-step lifecycle status (Phase 3-A) */
    stepStatuses: PlanStepStatus[];
}
export declare class SkillRouter {
    private registry;
    private dispatcher;
    private aborted;
    private callerToken;
    private voicePressure;
    private voiceSensitivity;
    private voiceTimingEnabled;
    constructor(registry?: SkillRegistry);
    /** Bind the ActionDispatcher (late binding, set after bot spawn). */
    setDispatcher(dispatcher: ActionDispatcher): void;
    getRegistry(): SkillRegistry;
    /** Abort any running plan execution. */
    abort(): void;
    /**
     * Set voice pressure signal for timing influence (Phase 4-B).
     *
     * This is a SOFT modifier only. It scales retry delays, timeouts,
     * and fallback speed. It does NOT change the execution chain or
     * create new control paths. Call with createNeutralSignal() to reset.
     */
    setVoicePressure(signal: VoicePressureSignal): void;
    /** Get current voice pressure signal (read-only). */
    getVoicePressure(): Readonly<VoicePressureSignal>;
    private tacticalBias;
    private tacticalRecommendation;
    private failureTracker;
    private loopDetector;
    private timeline;
    private traceRecorder;
    /** Set tactical bias for skill routing preference (Phase 4-C). */
    setTacticalBias(bias: TacticalSkillBias, recommendation: TacticalRecommendation): void;
    /** Get failure tracker for external telemetry (Phase 5). */
    getFailureTracker(): SkillFailureTracker;
    /** Get loop detector for external telemetry (Phase 5). */
    getLoopDetector(): ActionLoopDetector;
    /** Clear tactical bias (return to neutral). */
    clearTacticalBias(): void;
    /** Wire observability backends for trace recording. */
    setObservabilityBackend(params: {
        timeline: BehaviorTimeline;
        traceRecorder?: RuntimeTraceRecorder;
    }): void;
    getBehaviorTimeline(): BehaviorTimeline | null;
    /**
     * Apply config values at runtime (after config file loaded).
     * Replaces hardcoded fallback mapping, voice sensitivity, and behavior flags.
     */
    applyConfig(): void;
    /** Get current tactical recommendation (read-only). */
    getTacticalRecommendation(): TacticalRecommendation;
    /**
     * Adjust fallback chain based on tactical recommendation.
     * If tactical mode is "protect", a non-combat skill failure should
     * prefer falling back to defend_player rather than explore_area.
     */
    private applyTacticalFallbackBias;
    /**
     * Route a VALIDATED AgentOutput through the skill system.
     *
     * This is the SINGLE entry point for all action execution.
     * RuntimeCore.validate() must be called BEFORE this method.
     *
     * Handles ALL intent types:
     *   - "chat"  → dispatch actions directly
     *   - "skill" → execute a single skill (with retry + fallback)
     *   - "plan"  → execute a multi-step plan (with step lifecycle)
     */
    route(output: AgentOutput, ctx: SkillContext): Promise<{
        results: ExecutionResult[];
        planResult?: PlanExecutionResult;
        skillResult?: SkillExecutionResult;
    }>;
    private dispatchActions;
    /**
     * Dispatch a single action with retry on execution failure.
     * DOES NOT retry on safety blocks or validation failures.
     */
    private dispatchWithRetry;
    /**
     * Execute a single skill with retry and fallback support.
     *
     * Phase 3-A flow:
     *   1. Plan actions via registry
     *   2. Dispatch each action with retry
     *   3. If any action fails all retries → trigger fallback
     *   4. If fallback exists → execute fallback skill
     *   5. Emit AIMC_SKILL_TRACE telemetry
     */
    executeSkillWithRetry(name: string, params: Record<string, unknown>, ctx: SkillContext): Promise<SkillExecutionResult>;
    /**
     * Internal skill execution (dispatches all planned actions with retry).
     */
    private executeSkillInternal;
    /**
     * Execute a skill (backward-compatible wrapper).
     * Delegates to executeSkillInternal for single-shot execution without fallback.
     */
    executeSkill(name: string, params: Record<string, unknown>, ctx: SkillContext): Promise<ExecutionResult[]>;
    executePlan(plan: TaskPlan, ctx: SkillContext): Promise<PlanExecutionResult>;
    /**
     * Emit a structured AIMC_SKILL_TRACE log entry.
     * This is a SIDE EFFECT ONLY — it does not affect execution flow.
     */
    private emitSkillTrace;
    /** Calculate per-step timeout based on priority, scaled by voice pressure. */
    private stepTimeout;
    /**
     * Emit AIMC_VOICE_PRESSURE_TRACE for observability.
     * Side-effect only — does NOT affect execution flow.
     */
    emitVoicePressureTrace(extra?: Record<string, unknown>): void;
    /**
     * Emit AIMC_TACTICAL_TRACE for observability.
     * Side-effect only — does NOT affect execution flow.
     */
    emitTacticalTrace(extra?: Record<string, unknown>): void;
    /**
     * Emit AIMC_ROLE_TRACE for observability.
     *
     * Captures role influence on skill execution:
     *   - Current role and confidence
     *   - Role switch events
     *   - Skill weight overrides from role
     *
     * Side-effect only — does NOT affect execution flow.
     */
    emitRoleTrace(params: {
        currentRole: CompanionRole;
        confidence: number;
        event: "skill_influence" | "role_switch" | "adaptation_tick";
        roleSkillWeights?: Record<string, number>;
        previousRole?: CompanionRole;
        switchReason?: string;
        dominantTraits?: string[];
    }): void;
    /**
     * Emit AIMC_MEMORY_TRACE for observability (Phase 4-E).
     *
     * Tracks: memory recalls, callback usage, memory pruning.
     * Side-effect only — does NOT affect execution flow.
     */
    emitMemoryTrace(params: {
        event: "recall" | "callback_generated" | "pruned" | "experience_added";
        category?: ExperienceCategory;
        callbackText?: string;
        memoryCount?: number;
        prunedCount?: number;
        queryKeywords?: string[];
    }): void;
    /**
     * Emit AIMC_RELATIONSHIP_TRACE for observability (Phase 4-E).
     *
     * Tracks: trust changes, familiarity evolution, relationship milestones.
     * Side-effect only — does NOT affect execution flow.
     */
    emitRelationshipTrace(params: {
        event: "trust_change" | "familiarity_change" | "session_start" | "session_end" | "milestone";
        snapshot?: RelationshipSnapshot;
        delta?: number;
        reason?: string;
        previousLevel?: number;
        newLevel?: number;
    }): void;
    /**
     * Emit AIMC_STABILITY_TRACE for observability (Phase 5).
     *
     * Diagnostic only — does NOT affect execution flow or feed back into reasoning.
     * Tracks: stuck detection, loop detection, skill disable, safe mode transitions.
     */
    emitStabilityTrace(params: {
        event: "stuck_detected" | "loop_detected" | "skill_disabled" | "safe_mode_enter" | "safe_mode_exit" | "cooldown_active";
        skillName?: string;
        actionType?: string;
        targetKey?: string;
        fallbackSkill?: string;
        disableRemainingMs?: number;
        loopCount?: number;
        stuckDurationMs?: number;
        reason?: string;
    }): void;
    /**
     * Emit AIMC_ARBITRATION_TRACE for observability (Phase 4-G).
     *
     * Tracks: signal weights, winning action, rejected actions, applied rules.
     * Side-effect only — does NOT affect execution flow.
     */
    emitArbitrationTrace(params: {
        signalWeights: Record<string, number>;
        primaryAction: string | null;
        suppressedCount: number;
        appliedRule: string | null;
        reasonChain: string[];
        tacticalRecommendation?: string;
        voiceLevel?: string;
        companionRole?: string;
    }): void;
    /**
     * Emit AIMC_COOP_TRACE for observability (Phase 4-F).
     *
     * Tracks: predicted intents, proactive assists, cooperative success rate.
     * Side-effect only — does NOT affect execution flow.
     */
    emitCoopTrace(params: {
        event: "intent_predicted" | "assist_action" | "coop_success" | "coop_failure";
        predictedIntent?: string;
        confidence?: number;
        supportAction?: string;
        playerAction?: string;
        durationMs?: number;
    }): void;
    /**
     * Emit AIMC_SUPPORT_TRACE for observability (Phase 4-F).
     *
     * Tracks: proactive support actions, interruptions, assistance decisions.
     * Side-effect only — does NOT affect execution flow.
     */
    emitSupportTrace(params: {
        event: "support_generated" | "support_interrupted" | "support_completed" | "support_skipped";
        supportType?: string;
        reason?: string;
        priority?: number;
        cooldownActive?: boolean;
    }): void;
    /**
     * Emit AIMC_FORMATION_TRACE for observability (Phase 4-F).
     *
     * Tracks: formation mode switches, positioning adjustments.
     * Side-effect only — does NOT affect execution flow.
     */
    emitFormationTrace(params: {
        event: "formation_changed" | "regroup_triggered" | "position_adjusted";
        previousFormation?: string;
        newFormation?: string;
        reason?: string;
        distanceToPlayer?: number;
    }): void;
    /**
     * Emit AIMC_COMBAT_TRACE for observability (Phase 4-F).
     *
     * Tracks: combat role, target selection, rescue events, threat priorities.
     * Side-effect only — does NOT affect execution flow.
     */
    emitCombatTrace(params: {
        event: "combat_role" | "target_selected" | "rescue_triggered" | "retreat" | "threat_cleared";
        combatRole?: string;
        targetEntity?: string;
        threatCount?: number;
        botHealth?: number;
        playerHealth?: number;
    }): void;
}
//# sourceMappingURL=skill-router.d.ts.map