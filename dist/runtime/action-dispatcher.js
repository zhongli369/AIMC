import { eventBus } from "./event-bus.js";
import { Vec3 } from "vec3";
// ─── Config ──────────────────────────────────────────
const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    /** Actions that are safe to retry */
    retryable: new Set([
        "move_to", "follow_player", "collect_block", "collect_nearby_items",
        "mine_block", "place_block", "use_door", "sleep",
    ]),
};
// ─── Helpers ─────────────────────────────────────────
function pos(x, y, z) {
    return new Vec3(x, y, z);
}
// ─── Dispatcher ──────────────────────────────────────
export class ActionDispatcher {
    bot;
    safety;
    queue = [];
    processing = false;
    currentAction = null;
    constructor(bot, safety) {
        this.bot = bot;
        this.safety = safety;
    }
    // ─── Public API ────────────────────────────────────
    /**
     * Dispatch an intent for execution. Returns a promise that resolves
     * when the action completes, fails, or times out.
     *
     * Actions are queued and executed sequentially to prevent conflicts.
     * High-priority (4-5) actions jump to the front of the queue.
     */
    async dispatch(intent) {
        return new Promise((resolve) => {
            const entry = { intent, resolve };
            if (intent.priority >= 4) {
                // High-priority: insert after any in-progress action, before others
                const idx = this.queue.findIndex((e) => e.intent.priority < 4);
                if (idx === -1)
                    this.queue.push(entry);
                else
                    this.queue.splice(idx, 0, entry);
            }
            else {
                this.queue.push(entry);
            }
            void this.processQueue();
        });
    }
    /**
     * Cancel all pending actions. The currently executing action is allowed
     * to complete (Mineflayer cancellation is unreliable).
     */
    cancelPending() {
        const cancelled = this.queue.splice(0, this.queue.length);
        for (const entry of cancelled) {
            entry.resolve({
                actionId: entry.intent.id,
                success: false,
                message: "Action cancelled by queue flush",
                interrupted: true,
                timedOut: false,
            });
        }
    }
    getQueueLength() {
        return this.queue.length;
    }
    getCurrentAction() {
        return this.currentAction?.intent ?? null;
    }
    // ─── Queue Processor ───────────────────────────────
    async processQueue() {
        if (this.processing)
            return;
        this.processing = true;
        while (this.queue.length > 0) {
            const entry = this.queue.shift();
            this.currentAction = entry;
            entry.startedAt = Date.now();
            const result = await this.dispatchWithRetry(entry.intent);
            // Track latency
            const latency = entry.startedAt ? Date.now() - entry.startedAt : -1;
            void eventBus.emit("agent", "action_completed", {
                intent: entry.intent,
                result,
                latencyMs: latency,
            });
            entry.resolve(result);
            this.currentAction = null;
        }
        this.processing = false;
    }
    // ─── Retry Logic ───────────────────────────────────
    async dispatchWithRetry(intent) {
        // Validate first (only once — safety doesn't change between retries)
        const botState = this.getBotState();
        const validation = this.safety.validate(intent, botState);
        if (!validation.valid) {
            const msg = validation.errors.map((e) => e.message).join("; ");
            void eventBus.emit("system", "safety_block", {
                intent,
                errors: validation.errors,
            });
            return {
                actionId: intent.id,
                success: false,
                message: `Safety blocked: ${msg}`,
                interrupted: false,
                timedOut: false,
            };
        }
        void eventBus.emit("agent", "action_started", { intent });
        this.safety.recordAction(intent.type);
        const maxRetries = RETRY_CONFIG.retryable.has(intent.type)
            ? RETRY_CONFIG.maxRetries
            : 0;
        let lastResult = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const timeout = intent.timeout || 5000;
            const result = await this.executeWithTimeout(intent, timeout);
            if (result.success) {
                return result;
            }
            lastResult = result;
            // Don't retry if the action was interrupted or timed out
            // (retry only makes sense for actionable failures, not environmental ones)
            if (result.interrupted || result.timedOut) {
                break;
            }
            // Last attempt — don't wait
            if (attempt < maxRetries) {
                const delay = Math.min(RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt), RETRY_CONFIG.maxDelayMs);
                void eventBus.emit("agent", "action_failed", {
                    intent,
                    result,
                    attempt: attempt + 1,
                    willRetry: true,
                    retryDelayMs: delay,
                });
                await new Promise((r) => setTimeout(r, delay));
            }
        }
        // All retries exhausted
        void eventBus.emit("agent", "action_failed", {
            intent,
            result: lastResult,
            attemptsExhausted: true,
            totalAttempts: maxRetries + 1,
        });
        return lastResult ?? {
            actionId: intent.id,
            success: false,
            message: "Action failed with no result",
            interrupted: false,
            timedOut: false,
        };
    }
    // ─── Timeout Wrapper ────────────────────────────────
    executeWithTimeout(intent, timeoutMs) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.stopAction(intent);
                resolve({
                    actionId: intent.id,
                    success: false,
                    message: `Action "${intent.type}" timed out after ${timeoutMs}ms`,
                    interrupted: false,
                    timedOut: true,
                });
            }, timeoutMs);
            this.executeAction(intent)
                .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
                .catch((err) => {
                clearTimeout(timer);
                resolve({
                    actionId: intent.id,
                    success: false,
                    message: err instanceof Error ? err.message : String(err),
                    interrupted: false,
                    timedOut: false,
                });
            });
        });
    }
    // ─── Action Stopper (for timeout/interrupt) ─────────
    stopAction(intent) {
        try {
            switch (intent.type) {
                case "move_to":
                case "follow_player":
                case "move_away_from":
                case "go_to_surface":
                case "flee":
                    this.bot.pathfinder.stop();
                    break;
                case "mine_block":
                case "collect_block":
                    this.bot.collectBlock.cancelTask();
                    break;
                case "attack_entity":
                    this.bot.pvp.stop();
                    break;
            }
        }
        catch {
            // Best-effort cancellation
        }
    }
    // ─── Action Executor ────────────────────────────────
    async executeAction(intent) {
        const t = intent.target;
        try {
            switch (intent.type) {
                // ── Movement ──────────────────────────
                case "move_to": {
                    const { x, y, z } = t;
                    const GoalNear = this.bot.pathfinder.goals.GoalNear;
                    await this.bot.pathfinder.goto(new GoalNear(x, y, z, 1));
                    break;
                }
                case "follow_player": {
                    const { playerName } = t;
                    const player = this.bot.players[playerName]?.entity;
                    if (!player)
                        return fail(intent, `Player "${playerName}" not found`);
                    const GoalFollow = this.bot.pathfinder.goals.GoalFollow;
                    await this.bot.pathfinder.goto(new GoalFollow(player, 2));
                    break;
                }
                case "move_away_from": {
                    const target = t;
                    const botPos = this.bot.entity.position;
                    let dx = 0, dz = 0;
                    if (target.entityName) {
                        const entity = this.bot.nearestEntity((e) => e.name === target.entityName || e.username === target.entityName);
                        if (entity) {
                            dx = botPos.x - entity.position.x;
                            dz = botPos.z - entity.position.z;
                        }
                    }
                    else if (target.x !== undefined && target.z !== undefined) {
                        dx = botPos.x - target.x;
                        dz = botPos.z - target.z;
                    }
                    const len = Math.sqrt(dx * dx + dz * dz) || 1;
                    const farX = botPos.x + (dx / len) * 10;
                    const farZ = botPos.z + (dz / len) * 10;
                    const GoalNearXZ = this.bot.pathfinder.goals.GoalNearXZ;
                    await this.bot.pathfinder.goto(new GoalNearXZ(farX, farZ, 2));
                    break;
                }
                case "go_to_surface": {
                    const surface = this.bot.findBlock({
                        matching: (block) => {
                            if (!block)
                                return false;
                            const above = this.bot.blockAt(pos(block.position.x, block.position.y + 1, block.position.z));
                            return block.name === "air" && above?.name === "air" && block.position.y > this.bot.entity.position.y;
                        },
                        maxDistance: 50,
                    });
                    if (!surface)
                        return fail(intent, "No path to surface found");
                    const GoalBlock = this.bot.pathfinder.goals.GoalBlock;
                    await this.bot.pathfinder.goto(new GoalBlock(surface.position.x, surface.position.y, surface.position.z));
                    break;
                }
                // ── Block Interaction ─────────────────
                case "mine_block": {
                    const block = this.bot.blockAt(pos(t.x, t.y, t.z));
                    if (!block || block.name === "air")
                        return fail(intent, "No block to mine");
                    await this.bot.dig(block);
                    break;
                }
                case "collect_block": {
                    const blockType = t.blockType;
                    const block = this.bot.findBlock({
                        matching: (b) => b?.name === blockType,
                        maxDistance: 32,
                    });
                    if (!block)
                        return fail(intent, `No "${blockType}" block found nearby`);
                    await this.bot.collectBlock.collect(block);
                    break;
                }
                case "place_block": {
                    const { blockType } = t;
                    const item = this.bot.inventory.items().find((i) => i.name === blockType);
                    if (!item)
                        return fail(intent, `No "${blockType}" in inventory`);
                    const referenceBlock = this.bot.blockAt(pos(Math.floor(this.bot.entity.position.x), Math.floor(this.bot.entity.position.y), Math.floor(this.bot.entity.position.z)));
                    if (referenceBlock) {
                        await this.bot.equip(item, "hand");
                        await this.bot.placeBlock(referenceBlock, { x: 0, y: 1, z: 0 });
                    }
                    break;
                }
                // ── Combat ────────────────────────────
                case "attack_entity": {
                    const { entityName } = t;
                    const entity = this.bot.nearestEntity((e) => e.name === entityName ||
                        e.username === entityName ||
                        (e.mobType && e.mobType === entityName));
                    if (!entity)
                        return fail(intent, `Entity "${entityName}" not found`);
                    this.bot.pvp.attack(entity);
                    break;
                }
                case "flee": {
                    const hostile = this.bot.nearestEntity((e) => {
                        const type = e.name || e.mobType || "";
                        return ["zombie", "skeleton", "creeper", "spider", "witch", "pillager"]
                            .some((h) => type.includes(h));
                    });
                    if (hostile) {
                        const bx = this.bot.entity.position.x;
                        const bz = this.bot.entity.position.z;
                        const dx = bx - hostile.position.x;
                        const dz = bz - hostile.position.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1;
                        const GoalNearXZ = this.bot.pathfinder.goals.GoalNearXZ;
                        await this.bot.pathfinder.goto(new GoalNearXZ(bx + (dx / len) * 15, bz + (dz / len) * 15, 5));
                    }
                    break;
                }
                // ── Inventory ─────────────────────────
                case "equip_item": {
                    const { itemName } = t;
                    const item = this.bot.inventory.items().find((i) => i.name === itemName);
                    if (!item)
                        return fail(intent, `No "${itemName}" found`);
                    await this.bot.equip(item, "hand");
                    break;
                }
                case "consume": {
                    const { itemName } = t;
                    const item = this.bot.inventory.items().find((i) => i.name === itemName);
                    if (!item)
                        return fail(intent, `No "${itemName}" to consume`);
                    await this.bot.equip(item, "hand");
                    await this.bot.consume();
                    break;
                }
                case "drop_item": {
                    const { itemName, count } = t;
                    const items = this.bot.inventory.items().filter((i) => i.name === itemName);
                    if (!items.length)
                        return fail(intent, `No "${itemName}" to drop`);
                    const toDrop = items.slice(0, count || 1);
                    for (const item of toDrop) {
                        await this.bot.toss(item.type, null, item.count);
                    }
                    break;
                }
                // ── Social ────────────────────────────
                case "speak_chat": {
                    const { text } = t;
                    this.bot.chat(text.slice(0, 256));
                    break;
                }
                case "speak_whisper": {
                    const { text, playerName } = t;
                    if (playerName) {
                        this.bot.whisper(playerName, text.slice(0, 256));
                    }
                    else {
                        this.bot.chat(text.slice(0, 256));
                    }
                    break;
                }
                case "look_at_player": {
                    const { playerName } = t;
                    const player = this.bot.players[playerName]?.entity;
                    if (player) {
                        await this.bot.lookAt(player.position);
                    }
                    break;
                }
                case "look_at_position": {
                    await this.bot.lookAt(pos(t.x, t.y, t.z));
                    break;
                }
                // ── Utility ───────────────────────────
                case "sleep": {
                    const bed = this.bot.findBlock({
                        matching: (block) => block?.name?.includes("bed"),
                        maxDistance: 16,
                    });
                    if (!bed)
                        return fail(intent, "No bed nearby");
                    await this.bot.sleep(bed);
                    break;
                }
                case "wait": {
                    const ms = Math.min(t.ms || 1000, 30000);
                    await new Promise((r) => setTimeout(r, ms));
                    break;
                }
                case "collect_nearby_items": {
                    const items = this.bot.nearestEntities((e) => e.objectType === "Item" || e.name === "item");
                    for (const item of items.slice(0, 10)) {
                        try {
                            await this.bot.collectBlock.collect(item);
                        }
                        catch {
                            // Some items might be unreachable
                        }
                    }
                    break;
                }
                case "place_torch": {
                    const torch = this.bot.inventory.items().find((i) => i.name === "torch");
                    if (!torch)
                        return fail(intent, "No torches in inventory");
                    const referenceBlock = this.bot.blockAt(pos(Math.floor(this.bot.entity.position.x), Math.floor(this.bot.entity.position.y - 1), Math.floor(this.bot.entity.position.z)));
                    if (referenceBlock) {
                        await this.bot.equip(torch, "hand");
                        await this.bot.placeBlock(referenceBlock, { x: 0, y: 1, z: 0 });
                    }
                    break;
                }
                case "use_door": {
                    const door = this.bot.findBlock({
                        matching: (block) => block?.name?.includes("door") || block?.name?.includes("gate"),
                        maxDistance: 8,
                    });
                    if (door) {
                        await this.bot.activateBlock(door);
                    }
                    break;
                }
                default:
                    return fail(intent, `Unknown action type: ${intent.type}`);
            }
            return {
                actionId: intent.id,
                success: true,
                message: `Action "${intent.type}" completed`,
                interrupted: false,
                timedOut: false,
            };
        }
        catch (err) {
            return fail(intent, err instanceof Error ? err.message : String(err));
        }
    }
    // ─── State Helpers ─────────────────────────────────
    getBotState() {
        if (!this.bot?.entity)
            return undefined;
        const b = this.bot;
        return {
            lifecycle: "active",
            health: b.health,
            food: b.food,
            saturation: b.foodSaturation || 0,
            position: { x: b.entity.position.x, y: b.entity.position.y, z: b.entity.position.z },
            velocity: { x: b.entity.velocity.x, y: b.entity.velocity.y, z: b.entity.velocity.z },
            yaw: b.entity.yaw,
            pitch: b.entity.pitch,
            onGround: b.entity.onGround,
            isInWater: b.entity.isInWater ?? false,
            biome: "unknown",
            dimension: b.game.dimension,
            timeOfDay: "day",
            weather: "unknown",
            heldItem: null,
            gameMode: b.game.gameMode,
            experience: { points: b.experience?.points || 0, level: b.experience?.level || 0 },
        };
    }
}
// ─── Helpers ─────────────────────────────────────────
function fail(intent, message) {
    return {
        actionId: intent.id,
        success: false,
        message,
        interrupted: false,
        timedOut: false,
    };
}
//# sourceMappingURL=action-dispatcher.js.map