/**
 * RuntimeTrace — full execution chain trace recorder (Phase 6).
 *
 * Records every AI decision end-to-end:
 *   AgentCore → RuntimeCore.validate → Arbitration → SkillRouter → ActionDispatcher → Mineflayer
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 * All recording is async, non-blocking, never-throws.
 */

import { randomUUID } from "node:crypto";

// ─── Trace Stage ─────────────────────────────────────────

export type TraceStage =
  | "agent_core_input"     // Context assembled, about to call LLM
  | "agent_core_output"    // LLM output received
  | "runtime_validate"     // Schema + safety validation result
  | "arbitration"          // BehaviorArbitrator decision
  | "skill_router"         // SkillRouter.route() entry/exit
  | "skill_execute"        // Individual skill execution
  | "action_dispatch"      // ActionDispatcher.dispatch() call
  | "mineflayer_result";   // Final Mineflayer API result

// ─── Trace Event ─────────────────────────────────────────

export interface TraceEvent {
  traceId: string;
  timestamp: number;
  stage: TraceStage;
  /** Human-readable label for this trace point */
  label: string;
  /** Duration from trace start (ms) */
  elapsedMs: number;
  /** Input context snapshot (stage-dependent) */
  input?: unknown;
  /** Output / result snapshot (stage-dependent) */
  output?: unknown;
  /** Error info if this stage failed */
  error?: string;
  /** Arbitrary metadata tags */
  tags?: string[];
}

// ─── Trace Session ───────────────────────────────────────

export interface TraceSession {
  sessionId: string;
  startedAt: number;
  events: TraceEvent[];
  /** Whether this session is still open */
  open: boolean;
}

// ─── Recorder ────────────────────────────────────────────

export class RuntimeTraceRecorder {
  private currentSession: TraceSession | null = null;
  private sessions: TraceSession[] = [];
  private maxSessions = 50;
  private maxEventsPerSession = 500;
  private sessionStartTime = 0;

  /** Start a new trace session (one per think() cycle). */
  startSession(label?: string): string {
    if (this.currentSession?.open) {
      this.closeSession();
    }

    const sessionId = randomUUID();
    this.sessionStartTime = Date.now();
    this.currentSession = {
      sessionId,
      startedAt: this.sessionStartTime,
      events: [],
      open: true,
    };

    this.recordEvent({
      traceId: randomUUID(),
      timestamp: Date.now(),
      stage: "agent_core_input",
      label: label || "think_cycle_start",
      elapsedMs: 0,
    });

    return sessionId;
  }

  /** Record a trace event in the current session. */
  recordEvent(event: Omit<TraceEvent, "traceId" | "timestamp" | "elapsedMs"> & {
    traceId?: string;
    timestamp?: number;
    elapsedMs?: number;
  }): void {
    if (!this.currentSession?.open) return;

    // Enforce event limit per session
    if (this.currentSession.events.length >= this.maxEventsPerSession) return;

    const evt: TraceEvent = {
      traceId: event.traceId || randomUUID(),
      timestamp: event.timestamp || Date.now(),
      elapsedMs: event.elapsedMs ?? (Date.now() - this.sessionStartTime),
      stage: event.stage,
      label: event.label,
      input: event.input,
      output: event.output,
      error: event.error,
      tags: event.tags,
    };

    this.currentSession.events.push(evt);
  }

  /** Close current session and archive it. */
  closeSession(): TraceSession | null {
    if (!this.currentSession) return null;

    this.currentSession.open = false;

    // Record session end
    this.currentSession.events.push({
      traceId: randomUUID(),
      timestamp: Date.now(),
      stage: "mineflayer_result",
      label: "session_end",
      elapsedMs: Date.now() - this.sessionStartTime,
    });

    this.sessions.push(this.currentSession);
    if (this.sessions.length > this.maxSessions) {
      this.sessions = this.sessions.slice(-this.maxSessions);
    }

    const closed = this.currentSession;
    this.currentSession = null;
    return closed;
  }

  /** Get the current (open) session. */
  getCurrentSession(): TraceSession | null {
    return this.currentSession;
  }

  /** Get all archived sessions. */
  getSessions(limit?: number): TraceSession[] {
    return this.sessions.slice(-(limit ?? 20));
  }

  /** Get a specific session by ID. */
  getSession(sessionId: string): TraceSession | null {
    if (this.currentSession?.sessionId === sessionId) return this.currentSession;
    return this.sessions.find((s) => s.sessionId === sessionId) ?? null;
  }

  /** Get the most recent complete session. */
  getLastSession(): TraceSession | null {
    return this.sessions[this.sessions.length - 1] ?? null;
  }

  /** Get total event count across all sessions. */
  getTotalEventCount(): number {
    let count = 0;
    for (const s of this.sessions) count += s.events.length;
    if (this.currentSession) count += this.currentSession.events.length;
    return count;
  }

  /** Export all trace data as a plain JSON object. */
  export(): { sessions: TraceSession[]; exportedAt: number } {
    return {
      sessions: [...this.sessions, ...(this.currentSession ? [this.currentSession] : [])],
      exportedAt: Date.now(),
    };
  }

  /** Reset all trace data. */
  reset(): void {
    this.currentSession = null;
    this.sessions = [];
  }
}
