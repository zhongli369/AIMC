/**
 * BehaviorArbitrator — real-time behavior arbitration layer (Phase 4-G).
 *
 * Collects signals from ALL soft influence layers and produces a single
 * prioritized action list for SkillRouter. Resolves conflicts between
 * tactical, role, voice, relationship, memory, and cooperative signals.
 *
 * DETERMINISTIC — same input → same output. No AI, no randomness.
 *
 * Emergency Rules (checked in order):
 *   1. Memory emergency ALWAYS overrides everything
 *   2. Voice pressure overrides tactical ONLY if safe state
 *   3. Combat safety: HP < 30% → role cannot force attack
 *   4. Relationship protection overrides mining/building if player in danger
 *   5. Only ONE final primary action is selected
 *
 * ADVISORY ONLY. All actions flow through SkillRouter.
 * NEVER executes independently. NEVER bypasses the token gate.
 */
import type { IntentAction } from "../../interfaces/intent.js";
import type { VoicePressureSignal } from "../../voice/voice-pressure.js";
import type { TacticalRecommendation } from "../../team/tactical-analyzer.js";
import type { CompanionRole } from "../../role/role-identity.js";
import type { RelationshipSnapshot } from "../../memory/relationship-state.js";
import type { PlayerIntentType, SupportOpportunityType } from "../../team/intent-prediction.js";
export interface MemoryUrgencySignal {
    level: "none" | "low" | "medium" | "high" | "emergency";
    triggeredMemories: string[];
    suggestedAction?: string;
    urgencyScore: number;
}
export interface CooperativeStateSignal {
    predictedIntent: PlayerIntentType | null;
    predictionConfidence: number;
    supportOpportunity: SupportOpportunityType | null;
    supportPriority: number;
}
export interface ArbitrationInput {
    /** Proposed actions from LLM (validated AgentOutput.actions) */
    proposedActions: IntentAction[];
    /** Current bot intent from LLM (chat/skill/plan) */
    agentIntent?: string;
    /** Tactical recommendation (4-C) */
    tacticalRecommendation: TacticalRecommendation;
    /** Role skill weights (4-D) */
    roleSkillWeights: Record<string, number>;
    /** Current companion role */
    companionRole: CompanionRole;
    /** Relationship snapshot (4-E) */
    relationshipSnapshot: RelationshipSnapshot | null;
    /** Voice pressure signal (4-A/B) */
    voicePressure: VoicePressureSignal;
    /** Cooperative state (4-F) */
    cooperativeState: CooperativeStateSignal;
    /** Memory urgency (4-E) */
    memoryUrgency: MemoryUrgencySignal | null;
    /** Bot health (0–20) */
    botHealth: number;
    /** Player health (0–20, if known) */
    playerHealth?: number;
}
export interface SuppressedAction {
    action: IntentAction;
    reason: string;
    suppressedBy: string;
}
export interface ArbitrationResult {
    /** Final ranked action list for SkillRouter */
    rankedActions: IntentAction[];
    /** Primary (winning) action */
    primaryAction: IntentAction | null;
    /** Actions that were suppressed or removed */
    suppressedActions: SuppressedAction[];
    /** Which emergency rule was applied (if any) */
    appliedRule: string | null;
    /** Human-readable reason chain for the decision */
    reasonChain: string[];
    /** Per-signal normalized weights for telemetry */
    signalWeights: ArbitrationWeights;
}
export interface ArbitrationWeights {
    tacticalWeight: number;
    roleWeight: number;
    relationshipWeight: number;
    memoryWeight: number;
    voiceWeight: number;
    cooperativeWeight: number;
    finalScore: number;
}
export interface ArbitrationConfig {
    /** Weight coefficients in the final score formula */
    coefficients: {
        tactical: number;
        role: number;
        relationship: number;
        memory: number;
        voice: number;
        cooperative: number;
    };
    /** Bot health threshold for combat override (fraction 0–1) */
    combatOverrideHealthFraction: number;
    /** Player health threshold for relationship protection */
    playerDangerHealthThreshold: number;
    /** Max suppressed actions to track */
    maxSuppressedActions: number;
}
export declare class BehaviorArbitrator {
    private config;
    private decisionLog;
    private voiceWeightMultiplier;
    private memoryWeightMultiplier;
    private relationshipProtectionEnabled;
    constructor(config?: Partial<ArbitrationConfig>);
    /**
     * Apply config-driven weight multipliers (Phase 0.5).
     * Called at startup after config file is loaded.
     * Multipliers are applied ON TOP of the base coefficients — they do NOT replace them.
     */
    applyConfigMultipliers(params: {
        voiceWeightMultiplier?: number;
        memoryWeightMultiplier?: number;
        relationshipProtectionEnabled?: boolean;
    }): void;
    /**
     * Evaluate all subsystem signals and produce a single arbitrated action list.
     *
     * This is the SOLE entry point for behavior arbitration.
     * Call AFTER RuntimeCore.validate() and BEFORE SkillRouter.route().
     */
    evaluate(input: ArbitrationInput): ArbitrationResult;
    /**
     * Compute normalized per-signal weights and final arbitration score.
     *
     * finalScore = T*1.0 + R*0.8 + Rel*0.7 + M*1.2 + V*1.5 + C*0.9
     */
    computeWeights(input: ArbitrationInput): ArbitrationWeights;
    /** Get recent decisions for telemetry/audit. */
    getDecisionLog(limit?: number): ArbitrationResult[];
    /** Clear decision log. */
    clearDecisionLog(): void;
    private hasEmergencyMemory;
    private isPlayerInDanger;
    private voiceOverridesTactical;
    private normalizeTactical;
    private normalizeRole;
    private normalizeRelationship;
    private normalizeMemory;
    private normalizeVoice;
    private normalizeCooperative;
    private rankByPriority;
    private selectPrimary;
    private adjustPriorityForVoice;
    private buildEmergencyAction;
    private buildSurvivalAction;
    private buildProtectAction;
    private sanitizeActionType;
    private logDecision;
}
//# sourceMappingURL=behavior-arbitrator.d.ts.map