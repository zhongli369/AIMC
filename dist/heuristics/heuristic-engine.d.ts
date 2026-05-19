/**
 * HeuristicEngine — lightweight non-LLM decision layer.
 *
 * Evaluates common game situations and produces structured decisions
 * WITHOUT calling the LLM. Saves cost, reduces latency, improves reliability.
 *
 * Decisions flow through the SAME RuntimeCore pipeline as LLM output:
 *   HeuristicEngine → AgentOutput → SafetyGuard → ActionDispatcher
 *
 * Priority heuristic → LLM bypass:
 *   1. SURVIVAL: flee, eat, dodge (always heuristic — never wait for LLM)
 *   2. UTILITY: follow, torch, collect (heuristic when confidence high)
 *   3. LLM: everything else (complex reasoning, chat, crafting)
 */
import type { AgentOutput } from "../interfaces/intent.js";
import type { BotState } from "../interfaces/minecraft.js";
export interface HeuristicConfig {
    /** Minimum health % to consider "safe" */
    safeHealthPercent: number;
    /** Health below which we ALWAYS flee */
    fleeHealthPercent: number;
    /** Hunger below which we eat */
    eatHungerThreshold: number;
    /** Light level below which we place a torch */
    torchLightLevel: number;
    /** Max distance for "follow player" heuristic */
    followMaxDistance: number;
    /** Min distance before we trigger "follow" */
    followTriggerDistance: number;
    /** Max distance for item pickup */
    pickupRange: number;
    /** Cooldown between heuristic follow actions (ms) */
    followCooldownMs: number;
    /** Cooldown between heuristic torch placements (ms) */
    torchCooldownMs: number;
    /** Whether heuristics are enabled at all */
    enabled: boolean;
}
export interface HeuristicDecision {
    /** Whether a heuristic decision was made */
    decided: boolean;
    /** The action category (survival, utility, none) */
    category: "survival" | "utility" | "none";
    /** Human-readable reason */
    reason: string;
    /** AgentOutput-compatible result (if decided) */
    output: AgentOutput | null;
    /** Confidence in this heuristic (0–1, only act when high for utility) */
    confidence: number;
}
export interface NearbyInfo {
    entities: string[];
    hostiles: string[];
    items: string[];
    players: string[];
    projectiles: string[];
}
export declare class HeuristicEngine {
    private config;
    private lastFollowTime;
    private lastTorchTime;
    constructor(config?: Partial<HeuristicConfig>);
    get enabled(): boolean;
    setEnabled(v: boolean): void;
    /**
     * Evaluate current state and produce a heuristic decision if appropriate.
     * Returns null when no heuristic applies (LLM should handle it).
     */
    evaluate(params: {
        botState: BotState;
        nearby: NearbyInfo;
        inventoryItems?: string[];
        lightLevel?: number;
    }): HeuristicDecision | null;
    private checkFlee;
    private checkDodge;
    private checkEat;
    private checkTorch;
    private checkFollow;
    private checkPickup;
    /**
     * Get a quick action preference without generating full output.
     * Useful for rate-limiting decisions or pre-filtering.
     */
    quickCheck(params: {
        botState: BotState;
        nearby: NearbyInfo;
    }): {
        shouldFlee: boolean;
        shouldEat: boolean;
        shouldDodge: boolean;
    };
}
//# sourceMappingURL=heuristic-engine.d.ts.map