import { eventBus } from "../runtime/event-bus.js";
const DEFAULT_CONFIG = {
    maxReconnectAttempts: 10,
    reconnectBaseDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    spawnTimeoutMs: 30000,
};
// ─── BotCore ──────────────────────────────────────────
export class BotCore {
    config;
    bot = null;
    state = "init";
    reconnectAttempt = 0;
    initBotFn = null;
    spawnResolve = null;
    spawnTimer = null;
    disconnectHandled = false;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ─── Set Bot Factory ────────────────────────────────
    /** Register the legacy initBot function from Mindcraft utils/mcdata.js */
    setBotFactory(factory) {
        this.initBotFn = factory;
    }
    // ─── Connect ────────────────────────────────────────
    async connect() {
        if (!this.initBotFn)
            throw new Error("Bot factory not set — call setBotFactory() first");
        this.disconnectHandled = false;
        this.state = "connecting";
        this.bot = this.initBotFn(this.config.username);
        this.setupEventHandlers(this.bot);
        await this.emit("bot_connected", { username: this.config.username });
        // Wait for spawn or timeout
        const spawnPromise = new Promise((resolve, reject) => {
            this.spawnResolve = resolve;
            this.spawnTimer = setTimeout(() => {
                reject(new Error(`Spawn timeout after ${this.config.spawnTimeoutMs}ms`));
            }, this.config.spawnTimeoutMs);
        });
        try {
            await spawnPromise;
            this.state = "active";
            this.reconnectAttempt = 0;
            await this.emit("bot_spawned", { username: this.config.username });
            return this.bot;
        }
        catch (err) {
            this.state = "error";
            await this.emit("bot_error", { error: String(err) });
            throw err;
        }
    }
    // ─── Disconnect ─────────────────────────────────────
    async disconnect(reason) {
        this.disconnectHandled = true;
        this.state = "disconnected";
        if (this.spawnTimer)
            clearTimeout(this.spawnTimer);
        try {
            this.bot?.removeAllListeners();
            this.bot?.end(reason || "Bot disconnected");
        }
        catch {
            // Bot might already be disconnected
        }
        this.bot = null;
        await this.emit("bot_disconnected", { reason });
    }
    // ─── Reconnect ──────────────────────────────────────
    async reconnect(reason) {
        if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
            console.error(`[BotCore] Max reconnect attempts (${this.config.maxReconnectAttempts}) reached`);
            this.state = "error";
            await this.emit("bot_error", { error: "Max reconnect attempts reached" });
            return null;
        }
        this.reconnectAttempt++;
        const delay = Math.min(this.config.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempt - 1), this.config.reconnectMaxDelayMs);
        // Add jitter: ±25%
        const jitter = delay * 0.25 * (Math.random() * 2 - 1);
        const actualDelay = Math.round(delay + jitter);
        console.log(`[BotCore] Reconnecting in ${actualDelay}ms (attempt ${this.reconnectAttempt}/${this.config.maxReconnectAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, actualDelay));
        try {
            return await this.connect();
        }
        catch (err) {
            console.error(`[BotCore] Reconnect attempt ${this.reconnectAttempt} failed:`, err);
            return this.reconnect(reason);
        }
    }
    // ─── Event Wiring ───────────────────────────────────
    setupEventHandlers(bot) {
        // Spawn
        bot.once("spawn", () => {
            if (this.spawnTimer)
                clearTimeout(this.spawnTimer);
            this.spawnResolve?.();
        });
        // Health changes
        bot.on("health", () => {
            void this.emit("health_change", {
                health: bot.health,
                food: bot.food,
            });
        });
        // Chat
        bot.on("chat", (username, message) => {
            if (username === this.config.username)
                return;
            void this.emit("chat", { username, message });
        });
        // Whisper
        bot.on("whisper", (username, message) => {
            void this.emit("chat", { username, message, isWhisper: true });
        });
        // Damage
        let prevHealth = bot.health;
        bot.on("health", () => {
            if (bot.health < prevHealth) {
                const damage = prevHealth - bot.health;
                void this.emit("damage_taken", {
                    amount: damage,
                    source: "unknown",
                    health: bot.health,
                });
            }
            prevHealth = bot.health;
        });
        // Death
        bot.on("death", () => {
            void this.emit("death", {
                message: "Bot died",
                position: {
                    x: bot.entity?.position?.x ?? 0,
                    y: bot.entity?.position?.y ?? 0,
                    z: bot.entity?.position?.z ?? 0,
                },
                dimension: bot.game.dimension,
            });
        });
        // Time events
        bot.on("time", () => {
            const timeOfDay = bot.time.timeOfDay;
            if (timeOfDay === 0)
                void this.emit("sunrise", {});
            else if (timeOfDay === 12000)
                void this.emit("sunset", {});
        });
        // End/Kick — attempt reconnect
        const handleEnd = (reason) => {
            if (this.disconnectHandled)
                return;
            this.disconnectHandled = true;
            this.state = "disconnected";
            void this.emit("bot_disconnected", { reason });
            // Auto-reconnect for non-permanent disconnects
            const permanentReasons = ["banned", "Invalid credentials", "whitelist"];
            const isPermanent = permanentReasons.some((r) => String(reason).toLowerCase().includes(r.toLowerCase()));
            if (!isPermanent) {
                void this.reconnect(String(reason));
            }
            else {
                console.error(`[BotCore] Permanent disconnect: ${reason}`);
            }
        };
        bot.once("kicked", (reason) => handleEnd(String(reason)));
        bot.once("end", (reason) => handleEnd(reason));
        // Error
        bot.on("error", (err) => {
            void this.emit("bot_error", { error: err.message });
        });
        // Idle (mineflayer emits this as a string, not a typed event)
        bot.on("idle", () => {
            this.state = "idle";
            void this.emit("idle", {});
        });
    }
    // ─── State Query ────────────────────────────────────
    getBotState() {
        if (!this.bot?.entity)
            return null;
        const b = this.bot;
        const timeNames = ["sunrise", "day", "noon", "sunset", "night", "midnight"];
        const timeIdx = Math.floor((b.time.timeOfDay / 24000) * timeNames.length) % timeNames.length;
        return {
            lifecycle: this.state,
            health: b.health,
            food: b.food,
            saturation: b.foodSaturation || 0,
            position: {
                x: b.entity.position.x,
                y: b.entity.position.y,
                z: b.entity.position.z,
            },
            velocity: {
                x: b.entity.velocity.x,
                y: b.entity.velocity.y,
                z: b.entity.velocity.z,
            },
            yaw: b.entity.yaw,
            pitch: b.entity.pitch,
            onGround: b.entity.onGround,
            isInWater: b.entity.isInWater ?? false,
            biome: b.blockAt(b.entity.position)?.biome?.name || "unknown",
            dimension: b.game.dimension,
            timeOfDay: timeNames[timeIdx],
            weather: b.rainState ? b.isRaining ? "rain" : "clear" : "unknown",
            heldItem: b.heldItem ? {
                name: b.heldItem.name,
                displayName: b.heldItem.displayName,
                count: b.heldItem.count,
                slot: b.heldItem.slot,
            } : null,
            gameMode: b.game.gameMode,
            experience: { points: b.experience?.points || 0, level: b.experience?.level || 0 },
        };
    }
    isConnected() {
        return this.bot !== null && this.state !== "killed" && this.state !== "error";
    }
    isAlive() {
        return this.isConnected() && (this.bot?.health ?? 0) > 0;
    }
    // ─── Internal ───────────────────────────────────────
    async emit(type, data) {
        await eventBus.emit("minecraft", type, data);
        await eventBus.emit("system", type, data);
    }
}
//# sourceMappingURL=bot-core.js.map