/**
 * BehaviorTimeline — chronological record of ALL decisions (Phase 6).
 *
 * Append-only event log for behavioral auditing and replay.
 * Max 5000 entries, auto-prunes oldest.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */

import { randomUUID } from "node:crypto";

// ─── Timeline Event Type ─────────────────────────────────

export type TimelineEventType =
  | "skill_start"
  | "skill_complete"
  | "skill_failed"
  | "fallback_triggered"
  | "safe_mode_enter"
  | "safe_mode_exit"
  | "loop_detected"
  | "stuck_recovery"
  | "arbitration_override"
  | "plan_step_start"
  | "plan_step_complete"
  | "plan_step_failed"
  | "voice_pressure_change"
  | "tactical_change"
  | "role_switch"
  | "cooldown_active"
  | "skill_disabled"
  | "skill_reenabled"
  | "chat_sent"
  | "proactive_action"
  | "heuristic_fast_path"
  | "recovery_watchdog"
  | "agent_state_change";

// ─── Timeline Entry ──────────────────────────────────────

export interface TimelineEntry {
  entryId: string;
  timestamp: number;
  eventType: TimelineEventType;
  /** Human-readable summary */
  summary: string;
  /** Optional structured detail */
  detail?: Record<string, unknown>;
  /** Related trace session ID */
  traceSessionId?: string;
  /** Optional severity for filtering */
  severity?: "debug" | "info" | "warn";
}

// ─── Timeline ────────────────────────────────────────────

export class BehaviorTimeline {
  private entries: TimelineEntry[] = [];
  private maxEntries: number;
  private totalRecorded = 0;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Record a timeline event.
   * Non-blocking, never throws, auto-prunes oldest.
   */
  record(
    eventType: TimelineEventType,
    summary: string,
    detail?: Record<string, unknown>,
    traceSessionId?: string,
  ): TimelineEntry {
    const entry: TimelineEntry = {
      entryId: randomUUID(),
      timestamp: Date.now(),
      eventType,
      summary,
      detail,
      traceSessionId,
      severity: eventType.includes("failed") || eventType.includes("stuck")
        ? "warn"
        : eventType.includes("complete") || eventType.includes("exit")
          ? "info"
          : "debug",
    };

    this.entries.push(entry);
    this.totalRecorded++;

    // Auto-prune oldest
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    return entry;
  }

  /** Convenience shorthand methods. */
  skillStart(skillName: string, params?: Record<string, unknown>, traceId?: string): TimelineEntry {
    return this.record("skill_start", `Skill "${skillName}" started`, {
      skillName, ...params,
    }, traceId);
  }

  skillComplete(skillName: string, durationMs?: number, traceId?: string): TimelineEntry {
    return this.record("skill_complete", `Skill "${skillName}" completed`, {
      skillName, durationMs,
    }, traceId);
  }

  skillFailed(skillName: string, error?: string, traceId?: string): TimelineEntry {
    return this.record("skill_failed", `Skill "${skillName}" failed`, {
      skillName, error,
    }, traceId);
  }

  fallbackTriggered(fromSkill: string, toSkill: string, reason?: string, traceId?: string): TimelineEntry {
    return this.record("fallback_triggered", `Fallback: "${fromSkill}" → "${toSkill}"`, {
      fromSkill, toSkill, reason,
    }, traceId);
  }

  safeModeEnter(reason: string, traceId?: string): TimelineEntry {
    return this.record("safe_mode_enter", `Safe mode entered: ${reason}`, { reason }, traceId);
  }

  safeModeExit(durationMs?: number, traceId?: string): TimelineEntry {
    return this.record("safe_mode_exit", "Safe mode exited", { durationMs }, traceId);
  }

  loopDetected(actionType: string, count: number, traceId?: string): TimelineEntry {
    return this.record("loop_detected", `Action loop: ${actionType} × ${count}`, {
      actionType, repeatCount: count,
    }, traceId);
  }

  stuckRecovery(action: string, stuckDurationMs?: number, traceId?: string): TimelineEntry {
    return this.record("stuck_recovery", `Stuck recovery: ${action}`, {
      recoveryAction: action, stuckDurationMs,
    }, traceId);
  }

  arbitrationOverride(rule: string, suppressedCount: number, traceId?: string): TimelineEntry {
    return this.record("arbitration_override", `Arbitration: ${rule}`, {
      rule, suppressedCount,
    }, traceId);
  }

  /** Query entries by type, time range, or keyword. */
  query(params: {
    eventType?: TimelineEventType;
    since?: number;
    until?: number;
    keyword?: string;
    limit?: number;
  }): TimelineEntry[] {
    let result = this.entries;

    if (params.eventType) {
      result = result.filter((e) => e.eventType === params.eventType);
    }
    const since = params.since;
    const until = params.until;
    if (since !== undefined) {
      result = result.filter((e) => e.timestamp >= since);
    }
    if (until !== undefined) {
      result = result.filter((e) => e.timestamp <= until);
    }
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      result = result.filter((e) =>
        e.summary.toLowerCase().includes(kw) ||
        JSON.stringify(e.detail || {}).toLowerCase().includes(kw),
      );
    }

    return result.slice(-(params.limit ?? 100));
  }

  /** Get all entries. */
  getAll(limit?: number): TimelineEntry[] {
    return this.entries.slice(-(limit ?? 500));
  }

  /** Get recent entries (last N ms). */
  getRecent(ms: number): TimelineEntry[] {
    const cutoff = Date.now() - ms;
    return this.entries.filter((e) => e.timestamp >= cutoff);
  }

  /** Export all timeline data. */
  export(): { entries: TimelineEntry[]; totalRecorded: number; exportedAt: number } {
    return {
      entries: [...this.entries],
      totalRecorded: this.totalRecorded,
      exportedAt: Date.now(),
    };
  }

  /** Reset timeline. */
  reset(): void {
    this.entries = [];
    this.totalRecorded = 0;
  }

  /** Entry count. */
  get count(): number {
    return this.entries.length;
  }
}
