/**
 * EmotionEngine — emotional state machine with natural decay.
 *
 * States: calm, excited, alert, frustrated, focused, protective
 *
 * Influenced by: nearby danger, repeated failures, achievements,
 *   player interaction quality, memory history.
 *
 * Emotion decays naturally over time toward "calm".
 */
import { EventEmitter } from "node:events";
export type EmotionType = "calm" | "excited" | "alert" | "frustrated" | "focused" | "protective";
export interface EmotionalState {
    /** Current dominant emotion */
    type: EmotionType;
    /** Intensity 0–1 */
    intensity: number;
    /** When this emotion started */
    startedAt: number;
    /** Previous emotion (for blending) */
    previousType: EmotionType;
    /** Secondary emotion influence (0–1) */
    previousIntensity: number;
    /** Reason for current emotion */
    reason: string;
    /** How fast emotion decays (0–1, lower = longer) */
    decayRate: number;
}
export interface EmotionalTrigger {
    /** Target emotion */
    target: EmotionType;
    /** Intensity boost (0–1) */
    intensity: number;
    /** Reason string */
    reason: string;
    /** How long the emotion persists (ms), 0 for natural decay */
    durationMs: number;
    /** Priority — higher priority triggers overwrite lower */
    priority: number;
}
interface EmotionConfig {
    /** Base decay per tick (% of intensity lost per second) */
    baseDecayRate: number;
    /** How fast intensity returns to baseline */
    returnRate: number;
    /** Minimum intensity before reverting to calm */
    calmThreshold: number;
    /** Interval between emotion updates (ms) */
    updateIntervalMs: number;
}
export declare class EmotionEngine extends EventEmitter {
    private config;
    private state;
    private activeTrigger;
    private updateTimer;
    private failureStreak;
    private successStreak;
    constructor(config?: Partial<EmotionConfig>);
    start(): void;
    stop(): void;
    /**
     * Trigger an emotional response to an event.
     * Higher priority triggers override lower ones.
     */
    trigger(trigger: EmotionalTrigger): void;
    /**
     * Trigger from a game event (convenience method).
     * Automatically maps common game events to emotions.
     */
    triggerFromEvent(eventType: string, details?: string): void;
    getState(): Readonly<EmotionalState>;
    getEmotion(): EmotionType;
    getIntensity(): number;
    isNegative(): boolean;
    getFailureStreak(): number;
    getSuccessStreak(): number;
    private tick;
    reset(): void;
}
export {};
//# sourceMappingURL=emotion-engine.d.ts.map