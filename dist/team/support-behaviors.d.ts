/**
 * SupportBehaviors — passive teammate actions.
 *
 * These are PASSIVE ONLY. They generate IntentAction suggestions
 * that flow through the standard SkillRouter → ActionDispatcher path.
 *
 * MUST NOT:
 *   - Call bot.*() directly
 *   - Bypass SkillRouter
 *   - Create autonomous execution loops
 *   - Introduce parallel AI systems
 *
 * All execution STILL goes through the canonical chain.
 */
import type { IntentAction } from "../interfaces/intent.js";
import type { TeamState } from "./team-state.js";
export interface SupportBehaviorConfig {
    /** Ideal follow distance (blocks) */
    idealFollowDistance: number;
    /** Max follow distance before regroup triggered */
    maxFollowDistance: number;
    /** Auto-pickup dropped items while following */
    autoPickupItems: boolean;
    /** Avoid standing in player's path */
    avoidBlocking: boolean;
    /** Minimum health to offer support (below = self-preserve) */
    minHealthForSupport: number;
}
export declare class SupportBehaviors {
    private config;
    constructor(config?: Partial<SupportBehaviorConfig>);
    /**
     * Generate passive support actions based on team state.
     *
     * Returns IntentAction[] that the caller MUST dispatch through
     * SkillRouter.route() — never directly to ActionDispatcher.
     */
    evaluate(teamState: TeamState, botHealth: number): {
        actions: IntentAction[];
        behaviorTriggered: string | null;
    };
    setConfig(patch: Partial<SupportBehaviorConfig>): void;
    getConfig(): Readonly<SupportBehaviorConfig>;
}
//# sourceMappingURL=support-behaviors.d.ts.map