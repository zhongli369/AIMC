/**
 * SystemHealth — real-time system metrics (Phase 6).
 *
 * Computes health indicators from trace/timeline data.
 * READ-ONLY metrics. Zero execution influence.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
// ─── Health Tracker ──────────────────────────────────────
export class SystemHealthTracker {
    // Counters
    totalTicks = 0;
    stuckEvents = 0;
    totalActions = 0;
    loopEvents = 0;
    totalSkills = 0;
    successfulSkills = 0;
    fallbackTriggers = 0;
    // Latency tracking
    latencySamples = [];
    maxLatencySamples = 200;
    // State tracking
    safeModeActive = false;
    lastStuckTime = 0;
    startedAt = Date.now();
    /** Record a think/tick cycle. */
    recordTick(params) {
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
    recordAction(params) {
        this.totalActions++;
        if (params.wasLoop)
            this.loopEvents++;
    }
    /** Record a skill execution result. */
    recordSkill(params) {
        this.totalSkills++;
        if (params.success)
            this.successfulSkills++;
        if (params.wasFallback)
            this.fallbackTriggers++;
    }
    /** Update safe mode flag from external source. */
    setSafeMode(active) {
        this.safeModeActive = active;
    }
    /**
     * Compute current health snapshot.
     * Pure computation — no side effects.
     */
    compute() {
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
        let currentState = "healthy";
        const timeSinceStuck = Date.now() - this.lastStuckTime;
        if (this.safeModeActive) {
            currentState = "safe_mode";
        }
        else if (timeSinceStuck < 15000 && stuckRate > 0.05) {
            currentState = "recovering";
        }
        else if (stuckRate > 0.1 ||
            loopRate > 0.05 ||
            (this.totalSkills > 5 && skillSuccessRate < 0.4)) {
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
    getStatusLine() {
        const h = this.compute();
        return `[${h.currentState}] ticks:${h.totalTicks} skills:${h.totalSkills} ` +
            `stuck:${(h.stuckRate * 100).toFixed(1)}% loop:${(h.loopRate * 100).toFixed(1)}% ` +
            `success:${(h.skillSuccessRate * 100).toFixed(0)}% latency:${h.avgDecisionLatencyMs.toFixed(0)}ms`;
    }
    /** Reset all counters. */
    reset() {
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
//# sourceMappingURL=system-health.js.map