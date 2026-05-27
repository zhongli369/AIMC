/**
 * look_at_speaker reflex — bot looks at the player who just chatted.
 *
 * Does NOT consume the event — normal chat routing proceeds after.
 * Rate-limited: max 1 look per player per second.
 */
const DEFAULT_CONFIG = {
    rateLimitMs: 1000,
};
export function createLookAtSpeaker(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const lastLook = new Map();
    return {
        name: "look_at_speaker",
        enabled: true,
        canHandle(event) {
            return event.type === "chat:player_message";
        },
        async handle(event, ctx) {
            const payload = event.payload;
            const username = payload.username;
            const traceId = event.traceId;
            // Rate limit per player
            const now = Date.now();
            const prev = lastLook.get(username);
            if (prev !== undefined && now - prev < cfg.rateLimitMs) {
                return {
                    consumed: false,
                    action: "look_at_speaker",
                    reason: `rate_limited (${now - prev}ms since last look)`,
                };
            }
            lastLook.set(username, now);
            console.log(`[REFLEX] look_at_speaker started traceId=${traceId} target=${username}`);
            const playerEntity = ctx.bot?.players?.[username]?.entity;
            if (!playerEntity) {
                console.log(`[REFLEX] look_at_speaker skipped traceId=${traceId} reason=no_player_entity`);
                return {
                    consumed: false,
                    action: "look_at_speaker",
                    reason: "no_player_entity",
                };
            }
            try {
                const eyePos = playerEntity.position.offset(0, 1.6, 0);
                await ctx.bot.lookAt(eyePos, true);
                console.log(`[REFLEX] look_at_speaker completed traceId=${traceId}`);
                return {
                    consumed: false,
                    action: "look_at_speaker",
                    reason: "looked_at_player",
                };
            }
            catch (err) {
                console.error(`[REFLEX] look_at_speaker failed traceId=${traceId} error=${err.message}`);
                return {
                    consumed: false,
                    action: "look_at_speaker",
                    error: err.message,
                };
            }
        },
    };
}
//# sourceMappingURL=look-at-speaker.js.map