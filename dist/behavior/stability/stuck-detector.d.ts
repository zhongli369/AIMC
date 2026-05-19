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
export interface StabilityConfig {
    /** Max ms without meaningful progress before stuck detection */
    stuckTimeoutMs: number;
    /** Time window for loop detection */
    loopWindowMs: number;
    /** Max identical actions within window before cooldown */
    loopMaxRepeats: number;
    /** Cooldown duration in ms after loop detected */
    loopCooldownMs: number;
    /** Consecutive skill failures before temporary disable */
    skillFailureThreshold: number;
    /** How long a skill is disabled (ms) */
    skillDisableMs: number;
    /** Minimum ms safe mode must stay active */
    safeModeMinDurationMs: number;
    /** Auto-exit safe mode after this much stability (ms) */
    safeModeAutoExitMs: number;
    /** Safe mode cooldown before re-entry allowed */
    safeModeReentryCooldownMs: number;
}
export type ProgressType = "movement" | "block_interact" | "skill_success" | "action_success" | "state_change" | "chat_sent" | "plan_step" | "manual_reset";
export interface ProgressEvent {
    type: ProgressType;
    timestamp: number;
    detail?: string;
}
export interface ActionRecord {
    actionType: string;
    targetKey: string;
    timestamp: number;
}
export interface StabilityState {
    isStuck: boolean;
    stuckDurationMs: number;
    isSafeMode: boolean;
    safeModeEnteredAt: number | null;
    actionLoopsDetected: number;
    skillsDisabled: string[];
    lastProgress: ProgressEvent | null;
    lastProgressMs: number;
}
export declare class StuckDetector {
    private config;
    private lastProgressTime;
    private lastProgressEvent;
    private progressHistory;
    private stuckTriggerCount;
    constructor(config?: Partial<StabilityConfig>);
    /**
     * Record a progress event. Call this after ANY meaningful action completes.
     */
    recordProgress(type: ProgressType, detail?: string): void;
    /**
     * Check if the system appears stuck (no progress within timeout).
     */
    isStuck(): boolean;
    /**
     * Get how long the system has been stuck (ms). Returns 0 if not stuck.
     */
    getStuckDuration(): number;
    /**
     * Get the fixed recovery action when stuck.
     * Always returns "explore_area" — no intelligent selection.
     */
    getRecoveryAction(): string;
    /** Reset stuck state (call after recovery action dispatched). */
    reset(): void;
    /** Get the time since last progress (ms). */
    getTimeSinceLastProgress(): number;
    /** Get the most recent progress event. */
    getLastProgress(): ProgressEvent | null;
    /** Get recent progress history for diagnostics. */
    getRecentProgress(count?: number): ProgressEvent[];
}
export declare class ActionLoopDetector {
    private config;
    private actionHistory;
    private cooldowns;
    private loopCount;
    constructor(config?: Partial<StabilityConfig>);
    /**
     * Record an action before dispatch. Call from SkillRouter.
     */
    recordAction(actionType: string, targetKey?: string): void;
    /**
     * Check if a given action type + target would trigger a loop.
     */
    isLooping(actionType: string, targetKey?: string): boolean;
    /**
     * Check if an action type is currently in cooldown from loop detection.
     */
    isInCooldown(actionType: string): boolean;
    /**
     * Get remaining cooldown time for an action type (ms). Returns 0 if not in cooldown.
     */
    getCooldownRemaining(actionType: string): number;
    /**
     * Apply loop cooldown to an action type.
     */
    applyCooldown(actionType: string): void;
    /** Total loops detected. */
    getLoopCount(): number;
    /** Get recent action records for diagnostics. */
    getRecentActions(count?: number): ActionRecord[];
    /** Reset all state. */
    reset(): void;
}
export declare class SafeModeManager {
    private config;
    private _safeMode;
    private safeModeEnteredAt;
    private lastStableTime;
    private lastSafeModeExit;
    private safeModeEntryCount;
    private allowCombatInSafeMode;
    private preferExploreInSafeMode;
    constructor(config?: Partial<StabilityConfig>);
    /** Set behavior flags from config (Phase 0.5). */
    setBehaviorFlags(flags: {
        allowCombatInSafeMode?: boolean;
        preferExploreInSafeMode?: boolean;
    }): void;
    /**
     * Evaluate whether safe mode should be entered.
     */
    shouldEnterSafeMode(params: {
        isStuck: boolean;
        stuckDurationMs: number;
        loopDetected: boolean;
        recentFailures: number;
    }): boolean;
    /** Enter safe mode. */
    enterSafeMode(reason: string): void;
    /**
     * Evaluate whether safe mode should be exited.
     */
    shouldExitSafeMode(): boolean;
    /** Exit safe mode. */
    exitSafeMode(): void;
    /** Record a stable tick (no issues detected). */
    recordStable(): void;
    get isSafeMode(): boolean;
    get safeModeDuration(): number;
    /** Get safe mode behavior hints for AgentCore context injection. */
    getSafeModeHints(): string | null;
    /** Reset all state. */
    reset(): void;
}
export declare class StabilityMonitor {
    detector: StuckDetector;
    loopDetector: ActionLoopDetector;
    safeMode: SafeModeManager;
    private recentFailures;
    constructor(config?: Partial<StabilityConfig>);
    /**
     * Evaluate overall stability state. Called each watchdog tick.
     */
    evaluate(): StabilityState;
    /** Record a failure for safe mode evaluation. */
    recordFailure(): void;
    /** Record a success (clears recent failures). */
    recordSuccess(): void;
    /** Full reset. */
    reset(): void;
}
/**
 * Tracks per-skill failure counts and temporary disables.
 * Used by SkillRouter before skill execution.
 */
export declare class SkillFailureTracker {
    private config;
    private consecutiveFailures;
    private disabledUntil;
    private totalFailures;
    private totalDisables;
    /** Fallback mapping when a skill is disabled. */
    static readonly FALLBACK_MAP: Record<string, string>;
    private fallbackMap;
    constructor(config?: Partial<StabilityConfig>, fallbackMap?: Record<string, string>);
    /**
     * Update the fallback map at runtime (from config).
     */
    setFallbackMap(map: Record<string, string>): void;
    /**
     * Check if a skill is currently disabled.
     */
    isDisabled(skillName: string): boolean;
    /**
     * Get the recommended fallback for a disabled skill.
     */
    getFallback(skillName: string): string | null;
    /**
     * Get remaining disable time for a skill (ms). Returns 0 if not disabled.
     */
    getDisableRemaining(skillName: string): number;
    /**
     * Record a skill success. Resets failure count for that skill.
     */
    recordSuccess(skillName: string): void;
    /**
     * Record a skill failure. Increments failure count.
     * Returns true if the skill should now be disabled.
     */
    recordFailure(skillName: string): boolean;
    /** Get consecutive failure count for a skill. */
    getFailureCount(skillName: string): number;
    /** Get list of currently disabled skill names. */
    getDisabledSkills(): string[];
    /** Total statistics. */
    getStats(): {
        totalFailures: number;
        totalDisables: number;
    };
    /** Reset all tracking. */
    reset(): void;
}
//# sourceMappingURL=stuck-detector.d.ts.map