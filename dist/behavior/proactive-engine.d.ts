/**
 * ProactiveEngine — autonomous behavior generation.
 *
 * AI autonomously: follows player, warns about danger, suggests goals,
 * gathers resources, assists combat, checks player condition.
 *
 * Priority hierarchy:
 *   1. Survival (self-preservation)
 *   2. Cooperation (player assistance)
 *   3. Efficiency (long-term optimization)
 *   4. Support (resource gathering, lighting, etc.)
 */
import { EventEmitter } from "node:events";
import type { BotState } from "../interfaces/minecraft.js";
import type { GameEvent } from "../interfaces/event.js";
import type { PersonalityEngine } from "../personality/personality-engine.js";
import type { EmotionEngine } from "../personality/emotion-engine.js";
export interface ProactiveIntent {
    /** Action type to execute */
    actionType: string;
    /** Priority 1–5 (higher = more urgent) */
    priority: number;
    /** Reason for this proactive action */
    reason: string;
    /** Target specification */
    target?: Record<string, unknown>;
    /** Whether this intent requires LLM validation */
    requireLLM: boolean;
}
export interface ProactiveConfig {
    /** Interval between proactive evaluation ticks (ms) */
    evaluationIntervalMs: number;
    /** Minimum interval between actions (ms) */
    minActionIntervalMs: number;
    /** Max intents to generate per evaluation */
    maxIntentsPerTick: number;
    /** Whether to require LLM validation for high-risk actions */
    llmValidationForRisky: boolean;
    /** Max follow distance from player (blocks) */
    maxFollowDistance: number;
    /** Health threshold for self-preservation mode */
    survivalHealthThreshold: number;
}
export declare class ProactiveEngine extends EventEmitter {
    private config;
    private personality;
    private emotion;
    private lastActionTime;
    private evaluationTimer;
    private active;
    constructor(personality: PersonalityEngine, emotion: EmotionEngine, config?: Partial<ProactiveConfig>);
    start(): void;
    stop(): void;
    isActive(): boolean;
    /**
     * Evaluate current state and generate proactive intents.
     * Called on a timer.
     */
    evaluate(params?: {
        botState?: BotState | null;
        recentEvents?: GameEvent[];
        nearbyEntities?: string[];
    }): Promise<ProactiveIntent[]>;
    private evaluateSurvival;
    private evaluateCooperation;
    private evaluateEfficiency;
    private evaluateSupport;
    private buildContext;
    /**
     * Manually force a proactive intent (used by emergency signals).
     */
    forceIntent(intent: ProactiveIntent): void;
}
//# sourceMappingURL=proactive-engine.d.ts.map