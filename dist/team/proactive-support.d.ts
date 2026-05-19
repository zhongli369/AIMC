/**
 * ProactiveSupport — safe helper action generation (Phase 4-F).
 *
 * Generates support suggestions that ALWAYS flow through SkillRouter.
 * NEVER executes independently. NEVER overrides explicit player commands.
 *
 * Support behaviors:
 *   - Auto-light caves
 *   - Collect dropped items
 *   - Guard during mining
 *   - Share food if player starving
 *   - Keep formation distance
 *   - Warn about threats
 *   - Assist combat target focus
 *   - Regroup automatically
 *
 * MUST NOT:
 *   - Override player commands
 *   - Steal resources aggressively
 *   - Wander far away
 *   - Initiate dangerous combat alone
 *   - Bypass SkillRouter or ActionDispatcher
 */
import type { IntentAction } from "../interfaces/intent.js";
import type { TeamState } from "./team-state.js";
import type { PredictedIntent, PredictionContext } from "./intent-prediction.js";
export interface ProactiveSupportConfig {
    /** Min ms between support actions */
    cooldownMs: number;
    /** Max distance from player for support actions */
    maxSupportDistance: number;
    /** Max support actions per evaluation */
    maxActionsPerCycle: number;
    /** Whether to auto-light dark areas */
    autoLightEnabled: boolean;
    /** Whether to auto-collect drops */
    autoCollectEnabled: boolean;
    /** Whether to auto-share food */
    autoShareFood: boolean;
    /** Min player hunger to trigger food share */
    minPlayerHungerForShare: number;
    /** Supported area radius for threat watching */
    guardRadius: number;
}
export interface SupportEvaluation {
    actions: IntentAction[];
    /** Whether existing task should be interrupted for support */
    shouldInterrupt: boolean;
    /** Reason for interruption (if any) */
    interruptReason: string | null;
    /** Highest priority support opportunity found */
    highestPriority: number;
}
export declare class ProactiveSupportEngine {
    private config;
    private lastSupportTime;
    private supportActionCount;
    private cooldowns;
    constructor(config?: Partial<ProactiveSupportConfig>);
    /**
     * Evaluate context and generate safe support actions.
     *
     * ALL returned actions MUST be dispatched through SkillRouter.route().
     * This method does NOT dispatch anything directly.
     */
    evaluateSupportActions(params: {
        prediction: PredictedIntent;
        context: PredictionContext;
        teamState: TeamState | null;
        botHealth: number;
        botHunger: number;
        currentTask?: string;
        voicePressureLevel?: string;
    }): SupportEvaluation;
    /**
     * Determine whether current task should be interrupted for support.
     */
    shouldInterruptCurrentTask(prediction: PredictedIntent, currentTaskPriority: number, currentTaskElapsedMs: number): boolean;
    /**
     * Score a support opportunity 0–1 for prioritization.
     */
    scoreSupportOpportunity(prediction: PredictedIntent, context: PredictionContext): number;
    /** Get total support actions generated. */
    getSupportStats(): {
        totalActions: number;
        lastSupportTime: number;
    };
    private createGuardAction;
    private createCombatBackupAction;
    private createRegroupAction;
    private createCollectAction;
    private createLightAction;
    private createShareFoodAction;
    private createScoutAction;
    private createAssistMiningAction;
    private canAct;
    private markActed;
}
//# sourceMappingURL=proactive-support.d.ts.map