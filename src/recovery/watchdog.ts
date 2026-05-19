/**
 * Watchdog — subsystem health monitoring with heartbeat + timeout detection.
 *
 * Each subsystem registers a watchdog. It must "kick" (heartbeat) within
 * its timeout window. If a timeout fires, the watchdog emits a "timeout"
 * event that the RecoveryManager handles.
 *
 * Subsystems tracked: runtime, agent, voice, memory, llm, bot
 */
import { EventEmitter } from "node:events";

// ─── Subsystem ─────────────────────────────────────────

export type SubsystemId = "runtime" | "agent" | "voice" | "memory" | "llm" | "bot" | "heuristics";

export interface SubsystemWatchdog {
  id: SubsystemId;
  name: string;
  timeoutMs: number;
  lastKick: number;
  enabled: boolean;
  consecutiveTimeouts: number;
}

export interface WatchdogAlert {
  subsystem: SubsystemId;
  name: string;
  lastKick: number;
  overdueMs: number;
  consecutiveTimeouts: number;
  timestamp: number;
}

// ─── Config ────────────────────────────────────────────

export interface WatchdogConfig {
  /** Default timeout for subsystems without explicit config */
  defaultTimeoutMs: number;
  /** Check interval (ms) */
  checkIntervalMs: number;
  /** Max consecutive timeouts before escalating */
  maxConsecutiveTimeouts: number;
  /** Whether watchdog is active */
  enabled: boolean;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  defaultTimeoutMs: 30_000,
  checkIntervalMs: 5000,
  maxConsecutiveTimeouts: 3,
  enabled: true,
};

const SUBSYSTEM_DEFAULTS: Record<SubsystemId, { name: string; timeoutMs: number }> = {
  runtime: { name: "RuntimeCore", timeoutMs: 20_000 },
  agent: { name: "AgentCore", timeoutMs: 45_000 },
  voice: { name: "Voice Pipeline", timeoutMs: 30_000 },
  memory: { name: "Memory Store", timeoutMs: 15_000 },
  llm: { name: "DeepSeek LLM", timeoutMs: 60_000 },
  bot: { name: "Minecraft Bot", timeoutMs: 30_000 },
  heuristics: { name: "Heuristic Engine", timeoutMs: 10_000 },
};

// ─── Watchdog ──────────────────────────────────────────

export class Watchdog extends EventEmitter {
  private config: WatchdogConfig;
  private subsystems: Map<SubsystemId, SubsystemWatchdog> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;

  constructor(config?: Partial<WatchdogConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize all subsystems
    for (const [id, def] of Object.entries(SUBSYSTEM_DEFAULTS)) {
      this.subsystems.set(id as SubsystemId, {
        id: id as SubsystemId,
        name: def.name,
        timeoutMs: def.timeoutMs,
        lastKick: Date.now(),
        enabled: false,
        consecutiveTimeouts: 0,
      });
    }
  }

  // ─── Lifecycle ───────────────────────────────────────

  /** Enable a subsystem and start watching it. */
  enable(id: SubsystemId): void {
    const sub = this.subsystems.get(id);
    if (!sub) return;
    sub.enabled = true;
    sub.lastKick = Date.now();
    sub.consecutiveTimeouts = 0;
  }

  /** Disable a subsystem (e.g., during maintenance). */
  disable(id: SubsystemId): void {
    const sub = this.subsystems.get(id);
    if (!sub) return;
    sub.enabled = false;
  }

  /** Start the watchdog timer. */
  start(): void {
    if (!this.config.enabled) return;
    if (this.timer) return;

    this.timer = setInterval(() => this.check(), this.config.checkIntervalMs);
    console.log("[Watchdog] Started — checking subsystems every", this.config.checkIntervalMs, "ms");
  }

  /** Stop the watchdog timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Pause checks without stopping the timer (for debugging). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  // ─── Heartbeat ───────────────────────────────────────

  /** Kick a subsystem — signals "I'm alive." Call frequently. */
  kick(id: SubsystemId): void {
    const sub = this.subsystems.get(id);
    if (!sub || !sub.enabled) return;
    sub.lastKick = Date.now();
    sub.consecutiveTimeouts = 0;
  }

  /** Get time since last kick for a subsystem. */
  sinceLastKick(id: SubsystemId): number {
    const sub = this.subsystems.get(id);
    if (!sub) return 0;
    return Date.now() - sub.lastKick;
  }

  // ─── Check ───────────────────────────────────────────

  private check(): void {
    if (this.paused || !this.config.enabled) return;

    const now = Date.now();

    for (const sub of this.subsystems.values()) {
      if (!sub.enabled) continue;

      const elapsed = now - sub.lastKick;
      if (elapsed > sub.timeoutMs) {
        sub.consecutiveTimeouts++;

        const alert: WatchdogAlert = {
          subsystem: sub.id,
          name: sub.name,
          lastKick: sub.lastKick,
          overdueMs: elapsed - sub.timeoutMs,
          consecutiveTimeouts: sub.consecutiveTimeouts,
          timestamp: now,
        };

        this.emit("timeout", alert);

        if (sub.consecutiveTimeouts >= this.config.maxConsecutiveTimeouts) {
          this.emit("escalation", alert);
        }
      }
    }
  }

  // ─── Status ──────────────────────────────────────────

  /** Get status of all subsystems. */
  getAllStatus(): Array<{
    id: SubsystemId;
    name: string;
    enabled: boolean;
    lastKick: number;
    ago: number;
    healthy: boolean;
    consecutiveTimeouts: number;
  }> {
    const now = Date.now();
    return [...this.subsystems.values()].map((sub) => ({
      id: sub.id,
      name: sub.name,
      enabled: sub.enabled,
      lastKick: sub.lastKick,
      ago: now - sub.lastKick,
      healthy: !sub.enabled || (now - sub.lastKick) < sub.timeoutMs,
      consecutiveTimeouts: sub.consecutiveTimeouts,
    }));
  }

  /** Get unhealthy subsystems. */
  getUnhealthy(): Array<{ id: SubsystemId; name: string; overdue: number }> {
    const now = Date.now();
    return [...this.subsystems.values()]
      .filter((sub) => sub.enabled && (now - sub.lastKick) > sub.timeoutMs)
      .map((sub) => ({ id: sub.id, name: sub.name, overdue: now - sub.lastKick - sub.timeoutMs }));
  }
}
