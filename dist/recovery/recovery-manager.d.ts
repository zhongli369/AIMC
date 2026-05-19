/**
 * RecoveryManager — detects failures and orchestrates automated recovery.
 *
 * Watches for: stuck detection, repeated action failures, subsystem timeouts.
 * Recovery strategies: cancel/reset, restart pipeline, reconnect, backup.
 *
 * Recovery is ordered: least destructive → more aggressive.
 * Only escalates when previous strategy fails.
 */
import { EventEmitter } from "node:events";
import type { Watchdog, SubsystemId } from "./watchdog.js";
export interface RecoveryConfig {
    /** Max consecutive action failures before recovery */
    maxConsecutiveFailures: number;
    /** Max time without position change before "stuck" (ms) */
    stuckThresholdMs: number;
    /** Min distance for position change to count (blocks) */
    stuckMinDelta: number;
    /** Cooldown between recovery attempts per subsystem (ms) */
    recoveryCooldownMs: number;
    /** Max recovery attempts per subsystem per hour */
    maxRecoveriesPerHour: number;
    /** Whether to auto-recover at all */
    autoRecover: boolean;
}
export interface RecoveryEvent {
    id: string;
    subsystem: SubsystemId;
    reason: string;
    strategy: string;
    success: boolean;
    elapsedMs: number;
    timestamp: number;
}
export declare class RecoveryManager extends EventEmitter {
    private config;
    private watchdog;
    private lastRecoveryTime;
    private recoveryCounts;
    private recoveryHistory;
    private positionHistory;
    private consecutiveFailures;
    constructor(watchdog: Watchdog, config?: Partial<RecoveryConfig>);
    /** Record bot position for stuck detection. */
    recordPosition(x: number, y: number, z: number): void;
    /** Check if the bot appears stuck (no significant position change). */
    isStuck(): {
        stuck: boolean;
        durationMs: number;
        reason: string;
    };
    /** Record an action failure. Triggers recovery if threshold exceeded. */
    recordFailure(): number;
    /** Reset the failure counter (e.g., after a successful action). */
    resetFailures(): void;
    get failureCount(): number;
    /**
     * Attempt recovery for a subsystem.
     * Returns true if recovery was attempted (even if it failed).
     */
    recoverSubsystem(id: SubsystemId, reason: string): Promise<RecoveryEvent>;
    private recoverRuntime;
    private recoverAgent;
    private recoverVoice;
    private recoverMemory;
    private recoverLLM;
    private recoverBot;
    private handleWatchdogTimeout;
    private handleEscalation;
    /** Comprehensive health check of all subsystems. */
    healthCheck(): {
        healthy: boolean;
        issues: Array<{
            subsystem: SubsystemId;
            name: string;
            detail: string;
        }>;
        stuckInfo: ReturnType<RecoveryManager["isStuck"]>;
    };
    private canRecover;
    /** Get recovery history for analysis. */
    getRecoveryHistory(): RecoveryEvent[];
    /** Reset all recovery state. */
    /** Full cleanup — call before replacing this instance. */
    destroy(): void;
    reset(): void;
}
//# sourceMappingURL=recovery-manager.d.ts.map