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
// ─── Manager ──────────────────────────────────────────────────
export class ReflexManager {
    behaviors = [];
    ctx;
    _enabled;
    _stopped = false;
    constructor(ctx, enabled = true) {
        this.ctx = ctx;
        this._enabled = enabled;
    }
    get enabled() {
        return this._enabled && !this._stopped;
    }
    registerBehavior(behavior) {
        this.behaviors.push(behavior);
        console.log(`[REFLEX] registered behavior: ${behavior.name} enabled=${behavior.enabled}`);
    }
    /**
     * Run all enabled behaviors against a PerceptionEvent.
     * First behavior that returns consumed=true short-circuits the rest.
     * Returns { consumed } so the caller knows whether to skip downstream dispatch.
     */
    async handleEvent(event) {
        if (!this.enabled)
            return { consumed: false };
        for (const behavior of this.behaviors) {
            if (!behavior.enabled)
                continue;
            if (!behavior.canHandle(event))
                continue;
            try {
                const result = await behavior.handle(event, this.ctx);
                if (result.consumed) {
                    console.log(`[REFLEX] ${behavior.name} consumed event traceId=${event.traceId}`);
                    return { consumed: true };
                }
            }
            catch (err) {
                console.error(`[REFLEX] ${behavior.name} threw: ${err.message}`);
                // Never let a reflex failure block the chat pipeline
            }
        }
        return { consumed: false };
    }
    stop() {
        this._stopped = true;
        console.log("[REFLEX] stopped — all behaviors inactive");
    }
}
//# sourceMappingURL=reflex-manager.js.map