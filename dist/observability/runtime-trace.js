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
// ─── Recorder ────────────────────────────────────────────
export class RuntimeTraceRecorder {
    currentSession = null;
    sessions = [];
    maxSessions = 50;
    maxEventsPerSession = 500;
    sessionStartTime = 0;
    /** Start a new trace session (one per think() cycle). */
    startSession(label) {
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
    recordEvent(event) {
        if (!this.currentSession?.open)
            return;
        // Enforce event limit per session
        if (this.currentSession.events.length >= this.maxEventsPerSession)
            return;
        const evt = {
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
    closeSession() {
        if (!this.currentSession)
            return null;
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
    getCurrentSession() {
        return this.currentSession;
    }
    /** Get all archived sessions. */
    getSessions(limit) {
        return this.sessions.slice(-(limit ?? 20));
    }
    /** Get a specific session by ID. */
    getSession(sessionId) {
        if (this.currentSession?.sessionId === sessionId)
            return this.currentSession;
        return this.sessions.find((s) => s.sessionId === sessionId) ?? null;
    }
    /** Get the most recent complete session. */
    getLastSession() {
        return this.sessions[this.sessions.length - 1] ?? null;
    }
    /** Get total event count across all sessions. */
    getTotalEventCount() {
        let count = 0;
        for (const s of this.sessions)
            count += s.events.length;
        if (this.currentSession)
            count += this.currentSession.events.length;
        return count;
    }
    /** Export all trace data as a plain JSON object. */
    export() {
        return {
            sessions: [...this.sessions, ...(this.currentSession ? [this.currentSession] : [])],
            exportedAt: Date.now(),
        };
    }
    /** Reset all trace data. */
    reset() {
        this.currentSession = null;
        this.sessions = [];
    }
}
//# sourceMappingURL=runtime-trace.js.map