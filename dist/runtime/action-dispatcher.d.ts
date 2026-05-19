/**
 * ActionDispatcher — maps validated IntentActions to Mineflayer bot API calls.
 * This is the ONLY place where intents become Minecraft actions.
 *
 * SINGLE EXECUTION CHAIN GUARD:
 * Only SkillRouter is authorized to call dispatch(). Direct bot access is forbidden.
 * The caller token must match a registered authorized caller.
 *
 * Features: retry with exponential backoff, fallback handling, action queuing.
 */
import type { BotRef } from "../interfaces/minecraft.js";
import type { IntentAction, ExecutionResult } from "../interfaces/intent.js";
import { SafetyGuard } from "./safety-guard.js";
import type { BehaviorTimeline } from "../observability/behavior-timeline.js";
export declare class ActionDispatcher {
    private bot;
    private safety;
    private queue;
    private processing;
    private currentAction;
    /** Authorized callers: name → token */
    private authorizedCallers;
    private timeline;
    constructor(bot: BotRef, safety: SafetyGuard);
    /** Wire observability timeline for dispatch logging (Phase 6). */
    setTimeline(timeline: BehaviorTimeline): void;
    /**
     * Register an authorized caller. Only registered callers can dispatch actions.
     * Called by SkillRouter during setDispatcher() wiring.
     */
    registerCaller(name: string, token: string): void;
    /**
     * Verify that the current caller is authorized.
     *
     * ARCHITECTURE LOCK (Phase 2.6):
     * This is the HARD gate. No code may call dispatch() without the SkillRouter
     * token set on globalThis. Violations are logged, emitted as events, and thrown.
     */
    private verifyCaller;
    /** Report an architecture violation with full diagnostics. */
    private reportViolation;
    /** Extract the most likely violating module from a stack trace. */
    private extractViolatingModule;
    /** Late-binding: replace the bot reference (e.g., after reconnection). */
    setBot(bot: BotRef): void;
    /** Placeholder for future world state integration. */
    setWorld(world: unknown): void;
    /**
     * Dispatch an intent for execution. Returns a promise that resolves
     * when the action completes, fails, or times out.
     *
     * Actions are queued and executed sequentially to prevent conflicts.
     * High-priority (4-5) actions jump to the front of the queue.
     */
    dispatch(intent: IntentAction): Promise<ExecutionResult>;
    /**
     * Cancel all pending actions. The currently executing action is allowed
     * to complete (Mineflayer cancellation is unreliable).
     */
    cancelPending(): void;
    getQueueLength(): number;
    getCurrentAction(): IntentAction | null;
    private processQueue;
    private dispatchWithRetry;
    private executeWithTimeout;
    private stopAction;
    private executeAction;
    private getBotState;
}
//# sourceMappingURL=action-dispatcher.d.ts.map