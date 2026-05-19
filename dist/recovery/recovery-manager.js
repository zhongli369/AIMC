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
const DEFAULT_CONFIG = {
    maxConsecutiveFailures: 5,
    stuckThresholdMs: 60_000,
    stuckMinDelta: 0.5,
    recoveryCooldownMs: 30_000,
    maxRecoveriesPerHour: 6,
    autoRecover: true,
};
// ─── RecoveryManager ──────────────────────────────────
export class RecoveryManager extends EventEmitter {
    config;
    watchdog;
    // Recovery state
    lastRecoveryTime = new Map();
    recoveryCounts = new Map();
    recoveryHistory = [];
    // Stuck detection
    positionHistory = [];
    consecutiveFailures = 0;
    constructor(watchdog, config) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.watchdog = watchdog;
        // Listen for watchdog timeouts
        this.watchdog.on("timeout", (alert) => {
            this.handleWatchdogTimeout(alert).catch((err) => {
                console.warn("[RecoveryManager] Watchdog timeout handler failed:", err.message);
            });
        });
        this.watchdog.on("escalation", (alert) => {
            console.error(`[RecoveryManager] ESCALATION: ${alert.name} — ${alert.consecutiveTimeouts} consecutive timeouts`);
            this.handleEscalation(alert).catch((err) => {
                console.warn("[RecoveryManager] Escalation handler failed:", err.message);
            });
        });
    }
    // ─── Stuck Detection ─────────────────────────────────
    /** Record bot position for stuck detection. */
    recordPosition(x, y, z) {
        this.positionHistory.push({ x, y, z, timestamp: Date.now() });
        // Keep last 5 minutes of positions
        const cutoff = Date.now() - 300_000;
        this.positionHistory = this.positionHistory.filter((p) => p.timestamp > cutoff);
    }
    /** Check if the bot appears stuck (no significant position change). */
    isStuck() {
        const now = Date.now();
        const relevant = this.positionHistory.filter((p) => p.timestamp > now - this.config.stuckThresholdMs);
        if (relevant.length < 2) {
            return { stuck: false, durationMs: 0, reason: "" };
        }
        const first = relevant[0];
        const last = relevant[relevant.length - 1];
        const durationMs = last.timestamp - first.timestamp;
        const delta = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2 + (last.z - first.z) ** 2);
        if (durationMs >= this.config.stuckThresholdMs && delta < this.config.stuckMinDelta) {
            return {
                stuck: true,
                durationMs,
                reason: `No significant movement in ${Math.round(durationMs / 1000)}s (delta: ${delta.toFixed(2)} blocks)`,
            };
        }
        return { stuck: false, durationMs: 0, reason: "" };
    }
    // ─── Failure Tracking ────────────────────────────────
    /** Record an action failure. Triggers recovery if threshold exceeded. */
    recordFailure() {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
            this.emit("failure_threshold", this.consecutiveFailures);
        }
        return this.consecutiveFailures;
    }
    /** Reset the failure counter (e.g., after a successful action). */
    resetFailures() {
        this.consecutiveFailures = 0;
    }
    get failureCount() {
        return this.consecutiveFailures;
    }
    // ─── Recovery Procedures ──────────────────────────────
    /**
     * Attempt recovery for a subsystem.
     * Returns true if recovery was attempted (even if it failed).
     */
    async recoverSubsystem(id, reason) {
        const event = {
            id: `recovery-${Date.now()}`,
            subsystem: id,
            reason,
            strategy: "none",
            success: false,
            elapsedMs: 0,
            timestamp: Date.now(),
        };
        // Rate limit
        if (!this.canRecover(id)) {
            event.strategy = "rate_limited";
            this.recoveryHistory.push(event);
            return event;
        }
        const start = performance.now();
        try {
            switch (id) {
                case "runtime":
                    event.strategy = "runtime_pipeline_reset";
                    event.success = await this.recoverRuntime();
                    break;
                case "agent":
                    event.strategy = "agent_cancel_reset";
                    event.success = await this.recoverAgent();
                    break;
                case "voice":
                    event.strategy = "voice_pipeline_restart";
                    event.success = await this.recoverVoice();
                    break;
                case "memory":
                    event.strategy = "memory_store_flush";
                    event.success = await this.recoverMemory();
                    break;
                case "llm":
                    event.strategy = "llm_reconnect";
                    event.success = await this.recoverLLM();
                    break;
                case "bot":
                    event.strategy = "bot_stuck_recovery";
                    event.success = await this.recoverBot();
                    break;
                case "heuristics":
                    event.strategy = "heuristics_reset";
                    event.success = true; // Stateless — always recovers
                    break;
                default:
                    event.strategy = "unknown";
            }
        }
        catch (err) {
            event.strategy = `${event.strategy}_failed`;
            event.success = false;
        }
        event.elapsedMs = performance.now() - start;
        // Track
        this.lastRecoveryTime.set(id, Date.now());
        this.recoveryCounts.set(id, (this.recoveryCounts.get(id) || 0) + 1);
        this.recoveryHistory.push(event);
        // Prune history
        if (this.recoveryHistory.length > 200) {
            this.recoveryHistory = this.recoveryHistory.slice(-100);
        }
        this.emit("recovery", event);
        console.log(`[RecoveryManager] ${event.success ? "OK" : "FAILED"} recovery: ${id} (${event.strategy}) — ${Math.round(event.elapsedMs)}ms`);
        return event;
    }
    // ─── Individual Recovery Strategies ──────────────────
    async recoverRuntime() {
        try {
            // Emit a reset signal — RuntimeCore listens for this
            this.emit("runtime_reset");
            return true;
        }
        catch {
            return false;
        }
    }
    async recoverAgent() {
        try {
            // Cancel any active LLM request, reset state
            this.emit("agent_reset");
            return true;
        }
        catch {
            return false;
        }
    }
    async recoverVoice() {
        try {
            this.emit("voice_reset");
            return true;
        }
        catch {
            return false;
        }
    }
    async recoverMemory() {
        try {
            this.emit("memory_reset");
            return true;
        }
        catch {
            return false;
        }
    }
    async recoverLLM() {
        try {
            // Signal LLM reconnect
            this.emit("llm_reset");
            return true;
        }
        catch {
            return false;
        }
    }
    async recoverBot() {
        try {
            // Clear position history, cancel all actions
            this.positionHistory = [];
            this.emit("bot_reset");
            return true;
        }
        catch {
            return false;
        }
    }
    // ─── Watchdog Handlers ──────────────────────────────
    async handleWatchdogTimeout(alert) {
        console.warn(`[RecoveryManager] Watchdog timeout: ${alert.name} — ${Math.round(alert.overdueMs / 1000)}s overdue (#${alert.consecutiveTimeouts})`);
        // For first timeout, just warn. For second, attempt recovery.
        if (alert.consecutiveTimeouts >= 2) {
            await this.recoverSubsystem(alert.subsystem, `watchdog_timeout: ${alert.overdueMs}ms overdue`);
        }
    }
    async handleEscalation(alert) {
        // Aggressive recovery on escalation
        console.error(`[RecoveryManager] Aggressive recovery for ${alert.name}`);
        switch (alert.subsystem) {
            case "runtime":
                // Try runtime + agent reset
                await this.recoverSubsystem("runtime", "escalation");
                await this.recoverSubsystem("agent", "escalation");
                break;
            case "llm":
                // LLM escalation: cancel all + force reconnect
                await this.recoverSubsystem("agent", "llm_escalation");
                await this.recoverSubsystem("llm", "escalation");
                break;
            default:
                await this.recoverSubsystem(alert.subsystem, "escalation");
        }
    }
    // ─── Health Check ───────────────────────────────────
    /** Comprehensive health check of all subsystems. */
    healthCheck() {
        const issues = [];
        // Watchdog health
        const unhealthy = this.watchdog.getUnhealthy();
        for (const u of unhealthy) {
            issues.push({
                subsystem: u.id,
                name: u.name,
                detail: `Watchdog timeout: ${Math.round(u.overdue / 1000)}s overdue`,
            });
        }
        // Stuck check
        const stuckInfo = this.isStuck();
        if (stuckInfo.stuck) {
            issues.push({
                subsystem: "bot",
                name: "Minecraft Bot",
                detail: stuckInfo.reason,
            });
        }
        // Failure threshold
        if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
            issues.push({
                subsystem: "agent",
                name: "AgentCore",
                detail: `${this.consecutiveFailures} consecutive action failures`,
            });
        }
        return {
            healthy: issues.length === 0,
            issues,
            stuckInfo,
        };
    }
    // ─── Helpers ────────────────────────────────────────
    canRecover(id) {
        if (!this.config.autoRecover)
            return false;
        const lastTime = this.lastRecoveryTime.get(id) || 0;
        const elapsed = Date.now() - lastTime;
        if (elapsed < this.config.recoveryCooldownMs)
            return false;
        // Check hourly limit
        const hourlyCount = this.recoveryHistory.filter((e) => e.subsystem === id && Date.now() - e.timestamp < 3_600_000).length;
        if (hourlyCount >= this.config.maxRecoveriesPerHour)
            return false;
        return true;
    }
    /** Get recovery history for analysis. */
    getRecoveryHistory() {
        return [...this.recoveryHistory];
    }
    /** Reset all recovery state. */
    /** Full cleanup — call before replacing this instance. */
    destroy() {
        this.watchdog.removeAllListeners();
        this.removeAllListeners();
    }
    reset() {
        this.lastRecoveryTime.clear();
        this.recoveryCounts.clear();
        this.recoveryHistory = [];
        this.positionHistory = [];
        this.consecutiveFailures = 0;
    }
}
//# sourceMappingURL=recovery-manager.js.map