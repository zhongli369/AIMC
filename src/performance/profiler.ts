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

// ─── Metric Types ─────────────────────────────────────

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

// ─── Config ────────────────────────────────────────────

export interface ProfilerConfig {
  enabled: boolean;
  /** Max stored entries per ring buffer */
  maxThinkCycles: number;
  maxActions: number;
  maxPhases: number;
  /** Event throughput window in ms */
  throughputWindowMs: number;
}

const DEFAULT_CONFIG: ProfilerConfig = {
  enabled: true,
  maxThinkCycles: 200,
  maxActions: 1000,
  maxPhases: 500,
  throughputWindowMs: 60_000,
};

// ─── PerfProfiler ─────────────────────────────────────

export class PerformanceProfiler extends EventEmitter {
  private config: ProfilerConfig;
  private startTime: number;

  // Ring buffers
  private thinkCycles: ThinkCycleMetric[] = [];
  private actions: ActionMetric[] = [];
  private eventBuckets: { timestamp: number; category: string }[] = [];
  private memorySnapshots: MemorySnapshot[] = [];

  // Counters
  private totalCycles = 0;
  private totalActions = 0;
  private actionSuccesses = 0;
  private totalTokensUsed = 0;
  private totalCostUsd = 0;

  constructor(config?: Partial<ProfilerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = performance.now();
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(v: boolean): void {
    this.config.enabled = v;
  }

  // ─── Think Cycle Tracking ────────────────────────────

  /** Start a new think cycle, returns a tracker object. */
  startThinkCycle(cycleId?: string): ThinkCycleTracker {
    if (!this.config.enabled) return new ThinkCycleTracker(this, null);

    const tracker = new ThinkCycleTracker(this, {
      cycleId: cycleId || `think-${Date.now()}-${this.totalCycles}`,
      timestamp: Date.now(),
      phases: [],
      totalMs: 0,
      fallback: false,
    });

    return tracker;
  }

  recordThinkCycle(metric: ThinkCycleMetric): void {
    if (!this.config.enabled) return;

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

  startAction(actionId: string, actionType: string): ActionTracker {
    if (!this.config.enabled) return new ActionTracker(this, null);

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

  recordAction(metric: ActionMetric): void {
    if (!this.config.enabled) return;

    this.totalActions++;
    if (metric.success) this.actionSuccesses++;

    this.actions.push(metric);
    if (this.actions.length > this.config.maxActions) {
      this.actions.shift();
    }

    this.emit("action", metric);
  }

  // ─── Event Throughput ────────────────────────────────

  recordEvent(category: string): void {
    if (!this.config.enabled) return;

    this.eventBuckets.push({ timestamp: performance.now(), category });

    // Prune old
    const cutoff = performance.now() - this.config.throughputWindowMs;
    this.eventBuckets = this.eventBuckets.filter((e) => e.timestamp > cutoff);
  }

  getEventThroughput(): EventThroughput {
    const now = performance.now();
    const cutoff = now - this.config.throughputWindowMs;
    const recent = this.eventBuckets.filter((e) => e.timestamp > cutoff);

    const byCategory: Record<string, number> = {};
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

  recordMemorySnapshot(snapshot: MemorySnapshot): void {
    if (!this.config.enabled) return;
    this.memorySnapshots.push(snapshot);
    if (this.memorySnapshots.length > 100) {
      this.memorySnapshots.shift();
    }
  }

  // ─── Snapshot ────────────────────────────────────────

  /** Build a point-in-time summary of all tracked metrics. */
  snapshot(): ProfilerSnapshot {
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
  getRecentThinkCycles(limit: number = 20): ThinkCycleMetric[] {
    return this.thinkCycles.slice(-limit);
  }

  /** Return recent action metrics for analysis. */
  getRecentActions(limit: number = 50): ActionMetric[] {
    return this.actions.slice(-limit);
  }

  /** Reset all counters and buffers. */
  reset(): void {
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
  private profiler: PerformanceProfiler;
  private metric: ThinkCycleMetric | null;
  private currentPhase = "";
  private phaseStart = 0;

  constructor(profiler: PerformanceProfiler, metric: ThinkCycleMetric | null) {
    this.profiler = profiler;
    this.metric = metric;
  }

  startPhase(phase: string): void {
    if (!this.metric) return;
    this.currentPhase = phase;
    this.phaseStart = performance.now();
  }

  endPhase(success = true, metadata?: Record<string, unknown>): void {
    if (!this.metric) return;
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

  setTokenUsage(usage: TokenUsage): void {
    if (this.metric) this.metric.tokenUsage = usage;
  }

  setFallback(): void {
    if (this.metric) this.metric.fallback = true;
  }

  finish(): void {
    if (!this.metric) return;
    this.metric.totalMs = Date.now() - this.metric.timestamp;
    this.profiler.recordThinkCycle(this.metric);
    this.metric = null;
  }
}

// ─── Action Tracker ────────────────────────────────────

export class ActionTracker {
  private profiler: PerformanceProfiler;
  private metric: ActionMetric | null;

  constructor(profiler: PerformanceProfiler, metric: ActionMetric | null) {
    this.profiler = profiler;
    this.metric = metric;
  }

  markStarted(): void {
    if (!this.metric) return;
    const now = performance.now();
    this.metric.startedAt = now;
    this.metric.queueWaitMs = now - this.metric.queuedAt;
  }

  markCompleted(success: boolean, retries = 0): void {
    if (!this.metric) return;
    this.metric.completedAt = performance.now();
    this.metric.executionMs = this.metric.completedAt - this.metric.startedAt;
    this.metric.success = success;
    this.metric.retries = retries;
    this.profiler.recordAction(this.metric);
    this.metric = null;
  }
}
