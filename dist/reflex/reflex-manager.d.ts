/**
 * ReflexManager — lightweight non-LLM reaction layer.
 *
 * Behaviors are checked in registration order on every PerceptionEvent.
 * Each behavior returns { consumed } — if true, downstream handlers
 * (handleChat / AgentCore) are skipped for this event.
 *
 * Design constraints:
 *   - No physicsTick subscription
 *   - No long-running loops
 *   - Behaviors must be idempotent and rate-limited internally
 *   - Reflex NEVER replaces AgentCore — only intercepts before it
 */
import type { PerceptionEvent } from "../perception/event-types.js";
export interface ReflexContext {
    bot: any;
    safeBotChat: (text: string) => boolean;
    /** mineflayer-pathfinder namespace (goals, Movements) */
    pf?: any;
}
export interface ReflexResult {
    /** Whether downstream dispatch (handleChat) should be skipped */
    consumed: boolean;
    /** Human-readable action label for logging */
    action?: string;
    /** Why the behavior decided to act or skip */
    reason?: string;
    /** Error message if the action failed */
    error?: string;
}
export interface ReflexBehavior {
    /** Unique name for logging and config */
    name: string;
    /** Runtime toggle — set to false to disable without unregistering */
    enabled: boolean;
    /** Quick sync check — return true if this behavior might act */
    canHandle(event: PerceptionEvent): boolean;
    /** Execute the behavior. MUST NOT throw. */
    handle(event: PerceptionEvent, ctx: ReflexContext): Promise<ReflexResult>;
}
export declare class ReflexManager {
    private behaviors;
    private ctx;
    private _enabled;
    private _stopped;
    constructor(ctx: ReflexContext, enabled?: boolean);
    get enabled(): boolean;
    registerBehavior(behavior: ReflexBehavior): void;
    /**
     * Run all enabled behaviors against a PerceptionEvent.
     * First behavior that returns consumed=true short-circuits the rest.
     * Returns { consumed } so the caller knows whether to skip downstream dispatch.
     */
    handleEvent(event: PerceptionEvent): Promise<{
        consumed: boolean;
    }>;
    stop(): void;
}
//# sourceMappingURL=reflex-manager.d.ts.map