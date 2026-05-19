/**
 * RuntimeTrace — full execution chain trace recorder (Phase 6).
 *
 * Records every AI decision end-to-end:
 *   AgentCore → RuntimeCore.validate → Arbitration → SkillRouter → ActionDispatcher → Mineflayer
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 * All recording is async, non-blocking, never-throws.
 */
export type TraceStage = "agent_core_input" | "agent_core_output" | "runtime_validate" | "arbitration" | "skill_router" | "skill_execute" | "action_dispatch" | "mineflayer_result";
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
export interface TraceSession {
    sessionId: string;
    startedAt: number;
    events: TraceEvent[];
    /** Whether this session is still open */
    open: boolean;
}
export declare class RuntimeTraceRecorder {
    private currentSession;
    private sessions;
    private maxSessions;
    private maxEventsPerSession;
    private sessionStartTime;
    /** Start a new trace session (one per think() cycle). */
    startSession(label?: string): string;
    /** Record a trace event in the current session. */
    recordEvent(event: Omit<TraceEvent, "traceId" | "timestamp" | "elapsedMs"> & {
        traceId?: string;
        timestamp?: number;
        elapsedMs?: number;
    }): void;
    /** Close current session and archive it. */
    closeSession(): TraceSession | null;
    /** Get the current (open) session. */
    getCurrentSession(): TraceSession | null;
    /** Get all archived sessions. */
    getSessions(limit?: number): TraceSession[];
    /** Get a specific session by ID. */
    getSession(sessionId: string): TraceSession | null;
    /** Get the most recent complete session. */
    getLastSession(): TraceSession | null;
    /** Get total event count across all sessions. */
    getTotalEventCount(): number;
    /** Export all trace data as a plain JSON object. */
    export(): {
        sessions: TraceSession[];
        exportedAt: number;
    };
    /** Reset all trace data. */
    reset(): void;
}
//# sourceMappingURL=runtime-trace.d.ts.map