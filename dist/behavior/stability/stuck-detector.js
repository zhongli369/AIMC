/**
 * Stability & Recovery Layer (Phase 5).
 *
 * Lightweight stability mechanisms to prevent:
 *   - AI freezing / no-action state
 *   - Repeated action loops
 *   - Unstable rapid action switching
 *   - Skill failure spirals
 *
 * This is a STABILITY PATCH — NOT a feature upgrade.
 * No new AI capability. No learning. No self-modification.
 * All recovery flows through the existing AgentCore → SkillRouter chain.
 *
 * MUST NOT:
 *   - Create new execution pipelines
 *   - Bypass SkillRouter or ActionDispatcher
 *   - Modify the token gate or architecture lock
 *   - Add new AI decision paths
 */
const DEFAULT_STABILITY_CONFIG = {
    stuckTimeoutMs: 8000,
    loopWindowMs: 5000,
    loopMaxRepeats: 3,
    loopCooldownMs: 3000,
    skillFailureThreshold: 3,
    skillDisableMs: 7000,
    safeModeMinDurationMs: 10000,
    safeModeAutoExitMs: 15000,
    safeModeReentryCooldownMs: 30000,
};
// ─── Stuck Detector ─────────────────────────────────────
export class StuckDetector {
    config;
    lastProgressTime = Date.now();
    lastProgressEvent = null;
    progressHistory = [];
    stuckTriggerCount = 0;
    constructor(config) {
        this.config = { ...DEFAULT_STABILITY_CONFIG, ...config };
    }
    /**
     * Record a progress event. Call this after ANY meaningful action completes.
     */
    recordProgress(type, detail) {
        const now = Date.now();
        this.lastProgressTime = now;
        this.lastProgressEvent = { type, timestamp: now, detail };
        this.progressHistory.push(this.lastProgressEvent);
        if (this.progressHistory.length > 50) {
            this.progressHistory = this.progressHistory.slice(-50);
        }
    }
    /**
     * Check if the system appears stuck (no progress within timeout).
     */
    isStuck() {
        const elapsed = Date.now() - this.lastProgressTime;
        return elapsed > this.config.stuckTimeoutMs;
    }
    /**
     * Get how long the system has been stuck (ms). Returns 0 if not stuck.
     */
    getStuckDuration() {
        if (!this.isStuck())
            return 0;
        return Date.now() - this.lastProgressTime - this.config.stuckTimeoutMs;
    }
    /**
     * Get the fixed recovery action when stuck.
     * Always returns "explore_area" — no intelligent selection.
     */
    getRecoveryAction() {
        return "explore_area";
    }
    /** Reset stuck state (call after recovery action dispatched). */
    reset() {
        this.lastProgressTime = Date.now();
        this.stuckTriggerCount = 0;
        this.lastProgressEvent = {
            type: "manual_reset",
            timestamp: Date.now(),
            detail: "Stuck detector reset",
        };
    }
    /** Get the time since last progress (ms). */
    getTimeSinceLastProgress() {
        return Date.now() - this.lastProgressTime;
    }
    /** Get the most recent progress event. */
    getLastProgress() {
        return this.lastProgressEvent;
    }
    /** Get recent progress history for diagnostics. */
    getRecentProgress(count) {
        return this.progressHistory.slice(-(count ?? 10));
    }
}
// ─── Action Loop Detector ───────────────────────────────
export class ActionLoopDetector {
    config;
    actionHistory = [];
    cooldowns = new Map(); // actionType → cooldownUntil timestamp
    loopCount = 0;
    constructor(config) {
        this.config = { ...DEFAULT_STABILITY_CONFIG, ...config };
    }
    /**
     * Record an action before dispatch. Call from SkillRouter.
     */
    recordAction(actionType, targetKey) {
        const now = Date.now();
        this.actionHistory.push({
            actionType,
            targetKey: targetKey || "_none_",
            timestamp: now,
        });
        // Prune old entries outside the window
        const cutoff = now - this.config.loopWindowMs;
        this.actionHistory = this.actionHistory.filter((a) => a.timestamp > cutoff);
    }
    /**
     * Check if a given action type + target would trigger a loop.
     */
    isLooping(actionType, targetKey) {
        const now = Date.now();
        const cutoff = now - this.config.loopWindowMs;
        const target = targetKey || "_none_";
        const recent = this.actionHistory.filter((a) => a.actionType === actionType &&
            a.targetKey === target &&
            a.timestamp > cutoff);
        return recent.length >= this.config.loopMaxRepeats;
    }
    /**
     * Check if an action type is currently in cooldown from loop detection.
     */
    isInCooldown(actionType) {
        const until = this.cooldowns.get(actionType);
        if (!until)
            return false;
        if (Date.now() > until) {
            this.cooldowns.delete(actionType);
            return false;
        }
        return true;
    }
    /**
     * Get remaining cooldown time for an action type (ms). Returns 0 if not in cooldown.
     */
    getCooldownRemaining(actionType) {
        const until = this.cooldowns.get(actionType);
        if (!until)
            return 0;
        return Math.max(0, until - Date.now());
    }
    /**
     * Apply loop cooldown to an action type.
     */
    applyCooldown(actionType) {
        this.cooldowns.set(actionType, Date.now() + this.config.loopCooldownMs);
        this.loopCount++;
    }
    /** Total loops detected. */
    getLoopCount() {
        return this.loopCount;
    }
    /** Get recent action records for diagnostics. */
    getRecentActions(count) {
        return this.actionHistory.slice(-(count ?? 20));
    }
    /** Reset all state. */
    reset() {
        this.actionHistory = [];
        this.cooldowns.clear();
        this.loopCount = 0;
    }
}
// ─── Safe Mode Manager ──────────────────────────────────
export class SafeModeManager {
    config;
    _safeMode = false;
    safeModeEnteredAt = null;
    lastStableTime = Date.now();
    lastSafeModeExit = 0;
    safeModeEntryCount = 0;
    // Phase 0.5: Behavior flags from config
    allowCombatInSafeMode = false;
    preferExploreInSafeMode = true;
    constructor(config) {
        this.config = { ...DEFAULT_STABILITY_CONFIG, ...config };
    }
    /** Set behavior flags from config (Phase 0.5). */
    setBehaviorFlags(flags) {
        if (flags.allowCombatInSafeMode !== undefined)
            this.allowCombatInSafeMode = flags.allowCombatInSafeMode;
        if (flags.preferExploreInSafeMode !== undefined)
            this.preferExploreInSafeMode = flags.preferExploreInSafeMode;
    }
    /**
     * Evaluate whether safe mode should be entered.
     */
    shouldEnterSafeMode(params) {
        if (this._safeMode)
            return false;
        // Don't re-enter too quickly
        if (Date.now() - this.lastSafeModeExit < this.config.safeModeReentryCooldownMs) {
            return false;
        }
        // Enter safe mode if stuck for too long
        if (params.isStuck && params.stuckDurationMs > 2000)
            return true;
        // Enter safe mode if loops detected + failures
        if (params.loopDetected && params.recentFailures >= 2)
            return true;
        return false;
    }
    /** Enter safe mode. */
    enterSafeMode(reason) {
        this._safeMode = true;
        this.safeModeEnteredAt = Date.now();
        this.safeModeEntryCount++;
        console.log(`[Stability] SAFE MODE entered — ${reason} (entry #${this.safeModeEntryCount})`);
    }
    /**
     * Evaluate whether safe mode should be exited.
     */
    shouldExitSafeMode() {
        if (!this._safeMode)
            return false;
        const elapsed = Date.now() - (this.safeModeEnteredAt ?? Date.now());
        const stableDuration = Date.now() - this.lastStableTime;
        // Must stay in safe mode for minimum duration
        if (elapsed < this.config.safeModeMinDurationMs)
            return false;
        // Exit after sufficient stability
        return stableDuration > this.config.safeModeAutoExitMs;
    }
    /** Exit safe mode. */
    exitSafeMode() {
        this._safeMode = false;
        this.lastSafeModeExit = Date.now();
        console.log(`[Stability] SAFE MODE exited — system stable`);
    }
    /** Record a stable tick (no issues detected). */
    recordStable() {
        this.lastStableTime = Date.now();
    }
    get isSafeMode() {
        return this._safeMode;
    }
    get safeModeDuration() {
        if (!this.safeModeEnteredAt)
            return 0;
        return Date.now() - this.safeModeEnteredAt;
    }
    /** Get safe mode behavior hints for AgentCore context injection. */
    getSafeModeHints() {
        if (!this._safeMode)
            return null;
        const lines = ["[SAFE MODE] System stability protection active."];
        if (this.preferExploreInSafeMode) {
            lines.push("Prefer: follow_player, explore_area, collect_nearby_items, wait.");
        }
        else {
            lines.push("Prefer passive actions: follow_player, wait, collect_nearby_items, explore_area.");
        }
        if (this.allowCombatInSafeMode) {
            lines.push("Combat allowed only if player is directly under attack.");
        }
        else {
            lines.push("Avoid: attack_entity, mine_block (unless explicitly commanded), aggressive exploration.");
            lines.push("Do NOT escalate to combat unless player is directly under attack.");
        }
        lines.push("Focus on staying near the player and maintaining safety.");
        return lines.join("\n");
    }
    /** Reset all state. */
    reset() {
        this._safeMode = false;
        this.safeModeEnteredAt = null;
        this.lastStableTime = Date.now();
    }
}
// ─── Stability Monitor (aggregator) ─────────────────────
export class StabilityMonitor {
    detector;
    loopDetector;
    safeMode;
    recentFailures = []; // timestamps of recent failures
    constructor(config) {
        const cfg = { ...DEFAULT_STABILITY_CONFIG, ...config };
        this.detector = new StuckDetector(cfg);
        this.loopDetector = new ActionLoopDetector(cfg);
        this.safeMode = new SafeModeManager(cfg);
    }
    /**
     * Evaluate overall stability state. Called each watchdog tick.
     */
    evaluate() {
        const isStuck = this.detector.isStuck();
        const stuckDurationMs = this.detector.getStuckDuration();
        // Clean old failures
        const now = Date.now();
        this.recentFailures = this.recentFailures.filter((t) => now - t < 15000);
        // Check for loops in recent actions
        const recentActions = this.loopDetector.getRecentActions(10);
        let loopDetected = false;
        if (recentActions.length >= 3) {
            const last = recentActions[recentActions.length - 1];
            loopDetected = this.loopDetector.isLooping(last.actionType, last.targetKey);
        }
        // Safe mode evaluation
        if (this.safeMode.shouldEnterSafeMode({
            isStuck,
            stuckDurationMs,
            loopDetected,
            recentFailures: this.recentFailures.length,
        })) {
            const reason = isStuck
                ? `Stuck for ${stuckDurationMs}ms`
                : `Loop detected + ${this.recentFailures.length} recent failures`;
            this.safeMode.enterSafeMode(reason);
        }
        if (this.safeMode.shouldExitSafeMode()) {
            this.safeMode.exitSafeMode();
        }
        // If no issues, record stable tick
        if (!isStuck && !loopDetected && this.recentFailures.length === 0) {
            this.safeMode.recordStable();
        }
        return {
            isStuck,
            stuckDurationMs,
            isSafeMode: this.safeMode.isSafeMode,
            safeModeEnteredAt: this.safeMode["safeModeEnteredAt"],
            actionLoopsDetected: this.loopDetector.getLoopCount(),
            skillsDisabled: [],
            lastProgress: this.detector.getLastProgress(),
            lastProgressMs: this.detector.getTimeSinceLastProgress(),
        };
    }
    /** Record a failure for safe mode evaluation. */
    recordFailure() {
        this.recentFailures.push(Date.now());
    }
    /** Record a success (clears recent failures). */
    recordSuccess() {
        this.recentFailures = [];
    }
    /** Full reset. */
    reset() {
        this.detector.reset();
        this.loopDetector.reset();
        this.safeMode.reset();
        this.recentFailures = [];
    }
}
// ─── Skill Failure Backoff ──────────────────────────────
/**
 * Tracks per-skill failure counts and temporary disables.
 * Used by SkillRouter before skill execution.
 */
export class SkillFailureTracker {
    config;
    consecutiveFailures = new Map();
    disabledUntil = new Map();
    totalFailures = 0;
    totalDisables = 0;
    /** Fallback mapping when a skill is disabled. */
    static FALLBACK_MAP = {
        mine_resource: "explore_area",
        attack_target: "defend_player",
        gather_food: "collect_items",
        follow_player: "explore_area",
        build_shelter: "explore_area",
        collect_items: "explore_area",
        explore_area: "wait",
        defend_player: "follow_player",
    };
    fallbackMap;
    constructor(config, fallbackMap) {
        this.config = { ...DEFAULT_STABILITY_CONFIG, ...config };
        this.fallbackMap = fallbackMap || SkillFailureTracker.FALLBACK_MAP;
    }
    /**
     * Update the fallback map at runtime (from config).
     */
    setFallbackMap(map) {
        this.fallbackMap = { ...SkillFailureTracker.FALLBACK_MAP, ...map };
    }
    /**
     * Check if a skill is currently disabled.
     */
    isDisabled(skillName) {
        const until = this.disabledUntil.get(skillName);
        if (!until)
            return false;
        if (Date.now() > until) {
            this.disabledUntil.delete(skillName);
            return false;
        }
        return true;
    }
    /**
     * Get the recommended fallback for a disabled skill.
     */
    getFallback(skillName) {
        if (!this.isDisabled(skillName))
            return null;
        return this.fallbackMap[skillName] || "explore_area";
    }
    /**
     * Get remaining disable time for a skill (ms). Returns 0 if not disabled.
     */
    getDisableRemaining(skillName) {
        const until = this.disabledUntil.get(skillName);
        if (!until)
            return 0;
        return Math.max(0, until - Date.now());
    }
    /**
     * Record a skill success. Resets failure count for that skill.
     */
    recordSuccess(skillName) {
        this.consecutiveFailures.delete(skillName);
    }
    /**
     * Record a skill failure. Increments failure count.
     * Returns true if the skill should now be disabled.
     */
    recordFailure(skillName) {
        const current = (this.consecutiveFailures.get(skillName) || 0) + 1;
        this.consecutiveFailures.set(skillName, current);
        this.totalFailures++;
        if (current >= this.config.skillFailureThreshold) {
            this.disabledUntil.set(skillName, Date.now() + this.config.skillDisableMs);
            this.consecutiveFailures.delete(skillName);
            this.totalDisables++;
            console.log(`[Stability] Skill "${skillName}" disabled for ${this.config.skillDisableMs}ms ` +
                `after ${current} consecutive failures`);
            return true;
        }
        return false;
    }
    /** Get consecutive failure count for a skill. */
    getFailureCount(skillName) {
        return this.consecutiveFailures.get(skillName) || 0;
    }
    /** Get list of currently disabled skill names. */
    getDisabledSkills() {
        const now = Date.now();
        const disabled = [];
        for (const [skill, until] of this.disabledUntil) {
            if (now <= until)
                disabled.push(skill);
            else
                this.disabledUntil.delete(skill);
        }
        return disabled;
    }
    /** Total statistics. */
    getStats() {
        return {
            totalFailures: this.totalFailures,
            totalDisables: this.totalDisables,
        };
    }
    /** Reset all tracking. */
    reset() {
        this.consecutiveFailures.clear();
        this.disabledUntil.clear();
        this.totalFailures = 0;
        this.totalDisables = 0;
    }
}
//# sourceMappingURL=stuck-detector.js.map