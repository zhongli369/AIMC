/**
 * PerceptionPipeline — thin typed wrapper over raw Mineflayer bot events.
 *
 * Responsibilities:
 *   1. Register Mineflayer event listeners (chat, messagestr, spawn)
 *   2. Normalize heterogeneous event signatures → PerceptionEvent
 *   3. Deduplicate chat/message events (2-second window)
 *   4. Filter system messages (chat only)
 *   5. Dispatch validated chat messages to handler.onChatMessage
 *
 * Non-goals: EventBus, AsyncLocalStorage, pattern matching, physics ticks.
 */
import { randomUUID } from "node:crypto";
// ─── Dedup Window ─────────────────────────────────────────────
const DEDUP_WINDOW_MS = 2000;
const CLEANUP_INTERVAL_MS = 10_000;
// ─── Pipeline ─────────────────────────────────────────────────
export class PerceptionPipeline {
    bot;
    handlers;
    started = false;
    // Bound listeners for removeListener
    _onChat = null;
    _onMessagestr = null;
    _onSpawn = null;
    // Dedup: key → last-seen timestamp
    _recent = new Map();
    _cleanupTimer = null;
    constructor(bot, handlers) {
        this.bot = bot;
        this.handlers = handlers;
    }
    // ── Public API ──────────────────────────────────────────
    start() {
        if (this.started)
            return;
        this.started = true;
        console.log("[PERCEPTION] start");
        // ── chat event (MC <= 1.18): (username, message) ──
        this._onChat = async (username, message) => {
            const text = typeof message === "string"
                ? message
                : message?.toString?.() || "";
            if (!text.trim())
                return;
            if (username === this.bot.username)
                return;
            const dedupKey = `chat:${username}:${text.trim().slice(0, 60)}`;
            if (this._isDuplicate(dedupKey)) {
                console.log(`[PERCEPTION] duplicate chat ignored — key=${dedupKey.slice(0, 50)}`);
                return;
            }
            const event = this._makeEvent("chat:player_message", username, {
                username,
                message: text.trim(),
            });
            console.log(`[PERCEPTION] event ${event.type} traceId=${event.traceId} source=${username} text="${text.trim().slice(0, 60)}"`);
            // ── Reflex / pre-dispatch hook ──
            try {
                const reflexResult = await this.handlers.onPerceptionEvent?.(event);
                if (reflexResult?.consumed)
                    return;
            }
            catch (err) {
                console.error(`[PERCEPTION] onPerceptionEvent threw: ${err.message}`);
                // Never block chat pipeline
            }
            console.log(`[PERCEPTION] dispatch to handleChat traceId=${event.traceId}`);
            this.handlers.onChatMessage?.({
                type: "chat",
                source: username,
                message: text.trim(),
            });
        };
        // ── messagestr event (MC >= 1.19): fallback / compat ──
        this._onMessagestr = async (message, _position, _json, _sender) => {
            const text = typeof message === "string"
                ? message
                : message?.toString?.() || "";
            if (!text.trim() || text.length < 2)
                return;
            // Skip system messages (chat handler catches real player chat)
            if (text.startsWith("<") || text.startsWith("["))
                return;
            if (this.bot.username && text.includes(this.bot.username + ">"))
                return;
            const dedupKey = `msg:player:${text.trim().slice(0, 60)}`;
            if (this._isDuplicate(dedupKey)) {
                console.log(`[PERCEPTION] duplicate messagestr ignored — key=${dedupKey.slice(0, 50)}`);
                return;
            }
            const event = this._makeEvent("chat:player_message", "player", {
                username: "player",
                message: text.trim(),
            });
            console.log(`[PERCEPTION] event ${event.type} traceId=${event.traceId} source=player text="${text.trim().slice(0, 60)}"`);
            // ── Reflex / pre-dispatch hook ──
            try {
                const reflexResult = await this.handlers.onPerceptionEvent?.(event);
                if (reflexResult?.consumed)
                    return;
            }
            catch (err) {
                console.error(`[PERCEPTION] onPerceptionEvent threw: ${err.message}`);
            }
            console.log(`[PERCEPTION] dispatch to handleChat traceId=${event.traceId}`);
            this.handlers.onChatMessage?.({
                type: "chat",
                source: "player",
                message: text.trim(),
            });
        };
        // ── spawn event ──
        this._onSpawn = () => {
            const event = this._makeEvent("bot:spawn", "minecraft", {
                position: this.bot?.entity?.position
                    ? {
                        x: this.bot.entity.position.x,
                        y: this.bot.entity.position.y,
                        z: this.bot.entity.position.z,
                    }
                    : null,
            });
            console.log(`[PERCEPTION] event ${event.type} traceId=${event.traceId}`);
        };
        // Register listeners
        this.bot.on("chat", this._onChat);
        this.bot.on("messagestr", this._onMessagestr);
        this.bot.on("spawn", this._onSpawn);
        console.log("[PERCEPTION] registered listeners: chat,messagestr,spawn");
        // Periodic dedup cleanup
        this._cleanupTimer = setInterval(() => {
            const cutoff = Date.now() - CLEANUP_INTERVAL_MS;
            for (const [k, ts] of this._recent) {
                if (ts < cutoff)
                    this._recent.delete(k);
            }
        }, CLEANUP_INTERVAL_MS);
        if (this._cleanupTimer.unref)
            this._cleanupTimer.unref();
    }
    stop() {
        if (!this.started)
            return;
        if (this._onChat)
            this.bot.removeListener("chat", this._onChat);
        if (this._onMessagestr)
            this.bot.removeListener("messagestr", this._onMessagestr);
        if (this._onSpawn)
            this.bot.removeListener("spawn", this._onSpawn);
        if (this._cleanupTimer)
            clearInterval(this._cleanupTimer);
        this._recent.clear();
        this.started = false;
        this._onChat = null;
        this._onMessagestr = null;
        this._onSpawn = null;
        console.log("[PERCEPTION] stop");
    }
    // ── Private Helpers ─────────────────────────────────────
    _isDuplicate(key) {
        const now = Date.now();
        const last = this._recent.get(key);
        if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
            return true;
        }
        this._recent.set(key, now);
        return false;
    }
    _makeEvent(type, source, payload) {
        return {
            id: randomUUID(),
            traceId: randomUUID(),
            type,
            source,
            timestamp: Date.now(),
            payload,
        };
    }
}
//# sourceMappingURL=perception-pipeline.js.map