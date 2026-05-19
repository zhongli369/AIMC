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
const DEFAULT_CONFIG = {
    enabled: true,
    maxThinkCycles: 200,
    maxActions: 1000,
    maxPhases: 500,
    throughputWindowMs: 60_000,
};
// ─── PerfProfiler ─────────────────────────────────────
export class PerformanceProfiler extends EventEmitter {
    config;
    startTime;
    // Ring buffers
    thinkCycles = [];
    actions = [];
    eventBuckets = [];
    memorySnapshots = [];
    // Counters
    totalCycles = 0;
    totalActions = 0;
    actionSuccesses = 0;
    totalTokensUsed = 0;
    totalCostUsd = 0;
    constructor(config) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startTime = performance.now();
    }
    get enabled() {
        return this.config.enabled;
    }
    setEnabled(v) {
        this.config.enabled = v;
    }
    // ─── Think Cycle Tracking ────────────────────────────
    /** Start a new think cycle, returns a tracker object. */
    startThinkCycle(cycleId) {
        if (!this.config.enabled)
            return new ThinkCycleTracker(this, null);
        const tracker = new ThinkCycleTracker(this, {
            cycleId: cycleId || `think-${Date.now()}-${this.totalCycles}`,
            timestamp: Date.now(),
            phases: [],
            totalMs: 0,
            fallback: false,
        });
        return tracker;
    }
    recordThinkCycle(metric) {
        if (!this.config.enabled)
            return;
        this.totalCycles++;
        if (metric.tokenUsage) {
            this.totalTokensUsed += metric.tokenUsage.totalTokens;
            this.totalCostUsd += metric.tokenUsage.estimatedCostUsd;
        }
        this.thinkCycles.push(metric);
        if (this.thinkCycles.length > this.config.maxThinkCycles) {
            this.thinkCycles.shift();
        }
        this.emit("thinkCycle", metric);
    }
    // ─── Action Tracking ─────────────────────────────────
    startAction(actionId, actionType) {
        if (!this.config.enabled)
            return new ActionTracker(this, null);
        return new ActionTracker(this, {
            actionId,
            actionType,
            queuedAt: performance.now(),
            startedAt: 0,
            completedAt: 0,
            queueWaitMs: 0,
            executionMs: 0,
            retries: 0,
            success: false,
        });
    }
    recordAction(metric) {
        if (!this.config.enabled)
            return;
        this.totalActions++;
        if (metric.success)
            this.actionSuccesses++;
        this.actions.push(metric);
        if (this.actions.length > this.config.maxActions) {
            this.actions.shift();
        }
        this.emit("action", metric);
    }
    // ─── Event Throughput ────────────────────────────────
    recordEvent(category) {
        if (!this.config.enabled)
            return;
        this.eventBuckets.push({ timestamp: performance.now(), category });
        // Prune old
        const cutoff = performance.now() - this.config.throughputWindowMs;
        this.eventBuckets = this.eventBuckets.filter((e) => e.timestamp > cutoff);
    }
    getEventThroughput() {
        const now = performance.now();
        const cutoff = now - this.config.throughputWindowMs;
        const recent = this.eventBuckets.filter((e) => e.timestamp > cutoff);
        const byCategory = {};
        for (const e of recent) {
            byCategory[e.category] = (byCategory[e.category] || 0) + 1;
        }
        const windowMs = this.config.throughputWindowMs;
        return {
            windowMs,
            eventCount: recent.length,
            ratePerSec: recent.length / (windowMs / 1000),
            byCategory,
        };
    }
    // ─── Memory Tracking ─────────────────────────────────
    recordMemorySnapshot(snapshot) {
        if (!this.config.enabled)
            return;
        this.memorySnapshots.push(snapshot);
        if (this.memorySnapshots.length > 100) {
            this.memorySnapshots.shift();
        }
    }
    // ─── Snapshot ────────────────────────────────────────
    /** Build a point-in-time summary of all tracked metrics. */
    snapshot() {
        const now = performance.now();
        const recentCycles = this.thinkCycles.slice(-50);
        const recentActions = this.actions.slice(-100);
        const avgThinkLatency = recentCycles.length > 0
            ? recentCycles.reduce((s, c) => s + c.totalMs, 0) / recentCycles.length
            : 0;
        const avgActionLatency = recentActions.length > 0
            ? recentActions.reduce((s, a) => s + a.executionMs, 0) / recentActions.length
            : 0;
        return {
            timestamp: Date.now(),
            uptimeMs: now - this.startTime,
            thinkCycles: this.totalCycles,
            totalActions: this.totalActions,
            actionsSuccessRate: this.totalActions > 0
                ? this.actionSuccesses / this.totalActions
                : 1,
            avgThinkLatencyMs: Math.round(avgThinkLatency * 100) / 100,
            avgActionLatencyMs: Math.round(avgActionLatency * 100) / 100,
            totalTokens: this.totalTokensUsed,
            totalCostUsd: Math.round(this.totalCostUsd * 10000) / 10000,
            eventRate: this.getEventThroughput().ratePerSec,
        };
    }
    /** Return recent think cycle metrics for analysis. */
    getRecentThinkCycles(limit = 20) {
        return this.thinkCycles.slice(-limit);
    }
    /** Return recent action metrics for analysis. */
    getRecentActions(limit = 50) {
        return this.actions.slice(-limit);
    }
    /** Reset all counters and buffers. */
    reset() {
        this.thinkCycles = [];
        this.actions = [];
        this.eventBuckets = [];
        this.memorySnapshots = [];
        this.totalCycles = 0;
        this.totalActions = 0;
        this.actionSuccesses = 0;
        this.totalTokensUsed = 0;
        this.totalCostUsd = 0;
        this.startTime = performance.now();
    }
}
// ─── Think Cycle Tracker (RAII-style) ─────────────────
export class ThinkCycleTracker {
    profiler;
    metric;
    currentPhase = "";
    phaseStart = 0;
    constructor(profiler, metric) {
        this.profiler = profiler;
        this.metric = metric;
    }
    startPhase(phase) {
        if (!this.metric)
            return;
        this.currentPhase = phase;
        this.phaseStart = performance.now();
    }
    endPhase(success = true, metadata) {
        if (!this.metric)
            return;
        const now = performance.now();
        this.metric.phases.push({
            phase: this.currentPhase,
            startTime: this.phaseStart,
            endTime: now,
            durationMs: now - this.phaseStart,
            success,
            metadata,
        });
    }
    setTokenUsage(usage) {
        if (this.metric)
            this.metric.tokenUsage = usage;
    }
    setFallback() {
        if (this.metric)
            this.metric.fallback = true;
    }
    finish() {
        if (!this.metric)
            return;
        this.metric.totalMs = Date.now() - this.metric.timestamp;
        this.profiler.recordThinkCycle(this.metric);
        this.metric = null;
    }
}
// ─── Action Tracker ────────────────────────────────────
export class ActionTracker {
    profiler;
    metric;
    constructor(profiler, metric) {
        this.profiler = profiler;
        this.metric = metric;
    }
    markStarted() {
        if (!this.metric)
            return;
        const now = performance.now();
        this.metric.startedAt = now;
        this.metric.queueWaitMs = now - this.metric.queuedAt;
    }
    markCompleted(success, retries = 0) {
        if (!this.metric)
            return;
        this.metric.completedAt = performance.now();
        this.metric.executionMs = this.metric.completedAt - this.metric.startedAt;
        this.metric.success = success;
        this.metric.retries = retries;
        this.profiler.recordAction(this.metric);
        this.metric = null;
    }
}
//# sourceMappingURL=profiler.js.map