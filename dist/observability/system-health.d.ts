/**
 * SystemHealth — real-time system metrics (Phase 6).
 *
 * Computes health indicators from trace/timeline data.
 * READ-ONLY metrics. Zero execution influence.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
export type HealthState = "healthy" | "unstable" | "safe_mode" | "recovering";
export interface SystemHealthSnapshot {
    /** Stuck events per total ticks (0–1) */
    stuckRate: number;
    /** Loop events per total actions (0–1) */
    loopRate: number;
    /** Successful skills / total skills (0–1) */
    skillSuccessRate: number;
    /** Fallback triggers / total skill executions (0–1) */
    fallbackRate: number;
    /** Average AgentCore → ActionDispatcher latency (ms) */
    avgDecisionLatencyMs: number;
    /** Current health classification */
    currentState: HealthState;
    /** Timestamp of this snapshot */
    timestamp: number;
    /** Total ticks evaluated */
    totalTicks: number;
    /** Total actions dispatched */
    totalActions: number;
    /** Total skills executed */
    totalSkills: number;
    /** Uptime since tracker start (ms) */
    uptimeMs: number;
}
export declare class SystemHealthTracker {
    private totalTicks;
    private stuckEvents;
    private totalActions;
    private loopEvents;
    private totalSkills;
    private successfulSkills;
    private fallbackTriggers;
    private latencySamples;
    private maxLatencySamples;
    private safeModeActive;
    private lastStuckTime;
    private startedAt;
    /** Record a think/tick cycle. */
    recordTick(params: {
        wasStuck?: boolean;
        latencyMs?: number;
    }): void;
    /** Record an action dispatch. */
    recordAction(params: {
        wasLoop?: boolean;
    }): void;
    /** Record a skill execution result. */
    recordSkill(params: {
        success: boolean;
        wasFallback?: boolean;
    }): void;
    /** Update safe mode flag from external source. */
    setSafeMode(active: boolean): void;
    /**
     * Compute current health snapshot.
     * Pure computation — no side effects.
     */
    compute(): SystemHealthSnapshot;
    /** Get a quick health status string. */
    getStatusLine(): string;
    /** Reset all counters. */
    reset(): void;
}
//# sourceMappingURL=system-health.d.ts.map