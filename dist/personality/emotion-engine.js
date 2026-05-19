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
const DEFAULT_CONFIG = {
    baseDecayRate: 0.05,
    returnRate: 0.03,
    calmThreshold: 0.1,
    updateIntervalMs: 5000,
};
// ─── Trigger Priority Table ──────────────────────────
const TRIGGER_PRIORITY = {
    player_death: 100,
    bot_death: 95,
    emergency: 90,
    combat_start: 80,
    rare_discovery: 60,
    player_praise: 55,
    task_complete: 50,
    player_nearby: 40,
    task_fail: 35,
    damage_taken: 30,
    idle_long: 20,
    new_area: 15,
    chat_friendly: 10,
};
// ─── Engine ──────────────────────────────────────────
export class EmotionEngine extends EventEmitter {
    config;
    state;
    activeTrigger = null;
    updateTimer = null;
    failureStreak = 0;
    successStreak = 0;
    constructor(config) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = {
            type: "calm",
            intensity: 0,
            startedAt: Date.now(),
            previousType: "calm",
            previousIntensity: 0,
            reason: "Initialized",
            decayRate: this.config.baseDecayRate,
        };
    }
    // ─── Start / Stop ──────────────────────────────────
    start() {
        if (this.updateTimer)
            return;
        this.updateTimer = setInterval(() => this.tick(), this.config.updateIntervalMs);
    }
    stop() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }
    // ─── Trigger Emotion ────────────────────────────────
    /**
     * Trigger an emotional response to an event.
     * Higher priority triggers override lower ones.
     */
    trigger(trigger) {
        const currentPriority = this.activeTrigger?.priority ?? 0;
        if (trigger.priority < currentPriority) {
            // Lower priority triggers blend as secondary emotion
            this.state.previousIntensity = Math.min(1, this.state.previousIntensity + trigger.intensity * 0.3);
            return;
        }
        // Record previous state for blending
        this.state.previousType = this.state.type;
        this.state.previousIntensity = this.state.intensity;
        // Apply new trigger
        this.activeTrigger = trigger;
        this.state.type = trigger.target;
        this.state.intensity = Math.min(1, Math.max(this.state.intensity, trigger.intensity));
        this.state.startedAt = Date.now();
        this.state.reason = trigger.reason;
        this.state.decayRate = trigger.durationMs > 0
            ? Math.max(0.01, 1.0 / (trigger.durationMs / 1000))
            : this.config.baseDecayRate;
        // Track streaks
        if (trigger.target === "frustrated")
            this.failureStreak++;
        else
            this.failureStreak = Math.max(0, this.failureStreak - 1);
        if (trigger.target === "excited")
            this.successStreak++;
        else
            this.successStreak = Math.max(0, this.successStreak - 1);
        this.emit("emotion_change", { ...this.state });
    }
    /**
     * Trigger from a game event (convenience method).
     * Automatically maps common game events to emotions.
     */
    triggerFromEvent(eventType, details) {
        const priority = TRIGGER_PRIORITY[eventType] ?? 5;
        let target = "calm";
        let intensity = 0.3;
        switch (eventType) {
            case "player_death":
            case "bot_death":
                target = "protective";
                intensity = 1.0;
                break;
            case "emergency":
                target = "alert";
                intensity = 0.9;
                break;
            case "combat_start":
            case "damage_taken":
                target = "alert";
                intensity = 0.7;
                break;
            case "rare_discovery":
            case "player_praise":
            case "task_complete":
                target = "excited";
                intensity = 0.6;
                break;
            case "player_nearby":
                target = "focused";
                intensity = 0.4;
                break;
            case "task_fail":
                target = "frustrated";
                intensity = 0.5;
                break;
            case "idle_long":
                target = "calm";
                intensity = 0.2;
                break;
            case "new_area":
                target = "excited";
                intensity = 0.4;
                break;
            case "chat_friendly":
                target = "focused";
                intensity = 0.35;
                break;
            default:
                target = "calm";
                intensity = 0.2;
                break;
        }
        this.trigger({
            target,
            intensity,
            reason: details || eventType,
            durationMs: 30_000,
            priority,
        });
    }
    // ─── State Access ──────────────────────────────────
    getState() {
        return this.state;
    }
    getEmotion() {
        return this.state.type;
    }
    getIntensity() {
        return this.state.intensity;
    }
    isNegative() {
        return this.state.type === "frustrated" || this.state.type === "alert";
    }
    getFailureStreak() {
        return this.failureStreak;
    }
    getSuccessStreak() {
        return this.successStreak;
    }
    // ─── Decay Tick ─────────────────────────────────────
    tick() {
        const now = Date.now();
        const elapsed = (now - this.state.startedAt) / 1000; // seconds
        // Calculate natural decay
        const decayAmount = this.state.decayRate * elapsed;
        // Apply decay (smooth exponential)
        this.state.intensity = Math.max(0, this.state.intensity - decayAmount);
        // Return toward calm when intensity drops below threshold
        if (this.state.intensity < this.config.calmThreshold && this.state.type !== "calm") {
            this.state.previousType = this.state.type;
            this.state.previousIntensity = this.state.intensity;
            this.state.type = "calm";
            this.state.intensity = Math.max(0, this.state.intensity - this.config.returnRate);
            this.state.reason = "Emotion decayed naturally";
            this.activeTrigger = null;
            this.emit("emotion_change", { ...this.state });
        }
        // Reset timer
        this.state.startedAt = now;
        // Reset streaks after sufficient calm
        if (this.state.type === "calm" && this.state.intensity < 0.05) {
            this.failureStreak = Math.max(0, this.failureStreak - 1);
            this.successStreak = Math.max(0, this.successStreak - 1);
        }
    }
    // ─── Reset ─────────────────────────────────────────
    reset() {
        this.state = {
            type: "calm",
            intensity: 0,
            startedAt: Date.now(),
            previousType: "calm",
            previousIntensity: 0,
            reason: "Reset",
            decayRate: this.config.baseDecayRate,
        };
        this.activeTrigger = null;
        this.failureStreak = 0;
        this.successStreak = 0;
        this.emit("emotion_change", { ...this.state });
    }
}
//# sourceMappingURL=emotion-engine.js.map