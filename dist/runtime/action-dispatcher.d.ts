/**
 * ActionDispatcher — maps validated IntentActions to Mineflayer bot API calls.
 * This is the ONLY place where intents become Minecraft actions.
 * Features: retry with exponential backoff, fallback handling, action queuing.
 */
import type { BotRef } from "../interfaces/minecraft.js";
import type { IntentAction, ExecutionResult } from "../interfaces/intent.js";
import { SafetyGuard } from "./safety-guard.js";
export declare class ActionDispatcher {
    private bot;
    private safety;
    private queue;
    private processing;
    private currentAction;
    constructor(bot: BotRef, safety: SafetyGuard);
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