/**
 * SystemHealth — real-time system metrics (Phase 6).
 *
 * Computes health indicators from trace/timeline data.
 * READ-ONLY metrics. Zero execution influence.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */

// ─── Health State ────────────────────────────────────────

export type HealthState = "healthy" | "unstable" | "safe_mode" | "recovering";

// ─── System Health Snapshot ──────────────────────────────

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

// ─── Health Tracker ──────────────────────────────────────

export class SystemHealthTracker {
  // Counters
  private totalTicks = 0;
  private stuckEvents = 0;
  private totalActions = 0;
  private loopEvents = 0;
  private totalSkills = 0;
  private successfulSkills = 0;
  private fallbackTriggers = 0;

  // Latency tracking
  private latencySamples: number[] = [];
  private maxLatencySamples = 200;

  // State tracking
  private safeModeActive = false;
  private lastStuckTime = 0;
  private startedAt = Date.now();

  /** Record a think/tick cycle. */
  recordTick(params: {
    wasStuck?: boolean;
    latencyMs?: number;
  }): void {
    this.totalTicks++;
    if (params.wasStuck) {
      this.stuckEvents++;
      this.lastStuckTime = Date.now();
    }
    if (params.latencyMs !== undefined) {
      this.latencySamples.push(params.latencyMs);
      if (this.latencySamples.length > this.maxLatencySamples) {
        this.latencySamples = this.latencySamples.slice(-this.maxLatencySamples);
      }
    }
  }

  /** Record an action dispatch. */
  recordAction(params: {
    wasLoop?: boolean;
  }): void {
    this.totalActions++;
    if (params.wasLoop) this.loopEvents++;
  }

  /** Record a skill execution result. */
  recordSkill(params: {
    success: boolean;
    wasFallback?: boolean;
  }): void {
    this.totalSkills++;
    if (params.success) this.successfulSkills++;
    if (params.wasFallback) this.fallbackTriggers++;
  }

  /** Update safe mode flag from external source. */
  setSafeMode(active: boolean): void {
    this.safeModeActive = active;
  }

  /**
   * Compute current health snapshot.
   * Pure computation — no side effects.
   */
  compute(): SystemHealthSnapshot {
    const uptimeMs = Date.now() - this.startedAt;

    const stuckRate = this.totalTicks > 0
      ? this.stuckEvents / this.totalTicks
      : 0;

    const loopRate = this.totalActions > 0
      ? this.loopEvents / this.totalActions
      : 0;

    const skillSuccessRate = this.totalSkills > 0
      ? this.successfulSkills / this.totalSkills
      : 1.0;

    const fallbackRate = this.totalSkills > 0
      ? this.fallbackTriggers / this.totalSkills
      : 0;

    const avgDecisionLatencyMs = this.latencySamples.length > 0
      ? this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length
      : 0;

    // Determine health state
    let currentState: HealthState = "healthy";

    const timeSinceStuck = Date.now() - this.lastStuckTime;
    if (this.safeModeActive) {
      currentState = "safe_mode";
    } else if (timeSinceStuck < 15000 && stuckRate > 0.05) {
      currentState = "recovering";
    } else if (
      stuckRate > 0.1 ||
      loopRate > 0.05 ||
      (this.totalSkills > 5 && skillSuccessRate < 0.4)
    ) {
      currentState = "unstable";
    }

    return {
      stuckRate,
      loopRate,
      skillSuccessRate,
      fallbackRate,
      avgDecisionLatencyMs,
      currentState,
      timestamp: Date.now(),
      totalTicks: this.totalTicks,
      totalActions: this.totalActions,
      totalSkills: this.totalSkills,
      uptimeMs,
    };
  }

  /** Get a quick health status string. */
  getStatusLine(): string {
    const h = this.compute();
    return `[${h.currentState}] ticks:${h.totalTicks} skills:${h.totalSkills} ` +
      `stuck:${(h.stuckRate * 100).toFixed(1)}% loop:${(h.loopRate * 100).toFixed(1)}% ` +
      `success:${(h.skillSuccessRate * 100).toFixed(0)}% latency:${h.avgDecisionLatencyMs.toFixed(0)}ms`;
  }

  /** Reset all counters. */
  reset(): void {
    this.totalTicks = 0;
    this.stuckEvents = 0;
    this.totalActions = 0;
    this.loopEvents = 0;
    this.totalSkills = 0;
    this.successfulSkills = 0;
    this.fallbackTriggers = 0;
    this.latencySamples = [];
    this.startedAt = Date.now();
  }
}
