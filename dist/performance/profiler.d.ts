/**
 * PerformanceProfiler — unified runtime performance measurement.
 *
 * Tracks: think cycle phases, action execution latency, event throughput,
 * memory usage snapshots, subsystem health checks.
 *
 * All timings are high-resolution monotonic (performance.now / hrtime).
 * Zero overhead when disabled (guards on .enabled).
 */
import { EventEmitter } from "node:events";
export interface PhaseTiming {
    phase: string;
    startTime: number;
    endTime: number;
    durationMs: number;
    success: boolean;
    metadata?: Record<string, unknown>;
}
export interface ActionMetric {
    actionId: string;
    actionType: string;
    queuedAt: number;
    startedAt: number;
    completedAt: number;
    queueWaitMs: number;
    executionMs: number;
    retries: number;
    success: boolean;
}
export interface ThinkCycleMetric {
    cycleId: string;
    timestamp: number;
    phases: PhaseTiming[];
    totalMs: number;
    fallback: boolean;
    tokenUsage?: TokenUsage;
}
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
}
export interface EventThroughput {
    windowMs: number;
    eventCount: number;
    ratePerSec: number;
    byCategory: Record<string, number>;
}
export interface MemorySnapshot {
    timestamp: number;
    storeEntries: number;
    storeSizeBytes: number;
    retrievalLatencyMs: number;
}
export interface ProfilerSnapshot {
    timestamp: number;
    uptimeMs: number;
    thinkCycles: number;
    totalActions: number;
    actionsSuccessRate: number;
    avgThinkLatencyMs: number;
    avgActionLatencyMs: number;
    totalTokens: number;
    totalCostUsd: number;
    eventRate: number;
}
export interface ProfilerConfig {
    enabled: boolean;
    /** Max stored entries per ring buffer */
    maxThinkCycles: number;
    maxActions: number;
    maxPhases: number;
    /** Event throughput window in ms */
    throughputWindowMs: number;
}
export declare class PerformanceProfiler extends EventEmitter {
    private config;
    private startTime;
    private thinkCycles;
    private actions;
    private eventBuckets;
    private memorySnapshots;
    private totalCycles;
    private totalActions;
    private actionSuccesses;
    private totalTokensUsed;
    private totalCostUsd;
    constructor(config?: Partial<ProfilerConfig>);
    get enabled(): boolean;
    setEnabled(v: boolean): void;
    /** Start a new think cycle, returns a tracker object. */
    startThinkCycle(cycleId?: string): ThinkCycleTracker;
    recordThinkCycle(metric: ThinkCycleMetric): void;
    startAction(actionId: string, actionType: string): ActionTracker;
    recordAction(metric: ActionMetric): void;
    recordEvent(category: string): void;
    getEventThroughput(): EventThroughput;
    recordMemorySnapshot(snapshot: MemorySnapshot): void;
    /** Build a point-in-time summary of all tracked metrics. */
    snapshot(): ProfilerSnapshot;
    /** Return recent think cycle metrics for analysis. */
    getRecentThinkCycles(limit?: number): ThinkCycleMetric[];
    /** Return recent action metrics for analysis. */
    getRecentActions(limit?: number): ActionMetric[];
    /** Reset all counters and buffers. */
    reset(): void;
}
export declare class ThinkCycleTracker {
    private profiler;
    private metric;
    private currentPhase;
    private phaseStart;
    constructor(profiler: PerformanceProfiler, metric: ThinkCycleMetric | null);
    startPhase(phase: string): void;
    endPhase(success?: boolean, metadata?: Record<string, unknown>): void;
    setTokenUsage(usage: TokenUsage): void;
    setFallback(): void;
    finish(): void;
}
export declare class ActionTracker {
    private profiler;
    private metric;
    constructor(profiler: PerformanceProfiler, metric: ActionMetric | null);
    markStarted(): void;
    markCompleted(success: boolean, retries?: number): void;
}
//# sourceMappingURL=profiler.d.ts.map