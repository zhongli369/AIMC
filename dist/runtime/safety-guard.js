import { Vec3 } from "vec3";
const DEFAULT_SAFETY_CONFIG = {
    maxFallDistance: 3,
    retreatHealthPercent: 30,
    protectedItems: [
        "diamond", "diamond_block", "netherite_ingot", "netherite_block",
        "netherite_pickaxe", "netherite_sword", "netherite_axe", "netherite_shovel",
        "diamond_pickaxe", "diamond_sword", "diamond_axe", "diamond_shovel",
        "elytra", "dragon_egg", "beacon", "shulker_box", "enchanted_golden_apple",
        "totem_of_undying", "nether_star", "wither_skeleton_skull",
    ],
    maxBuildBlocks: 64,
    cooldowns: {
        attack_entity: 500,
        speak_chat: 1000,
        speak_whisper: 1000,
        place_block: 100,
        mine_block: 200,
        drop_item: 500,
        consume: 500,
        equip_item: 250,
    },
    blockedActions: [],
    minSafeY: 5,
    maxSafeYDelta: 3,
    lavaSearchRadius: 5,
};
// ─── Last Action Times ────────────────────────────────
const lastActionTimes = new Map();
const spamTracker = new Map();
const SPAM_WINDOW_MS = 1000;
const SPAM_MAX_ACTIONS = 5;
export class SafetyGuard {
    config;
    bot = null;
    emergencyLocked = false;
    emergencyReason = "";
    constructor(config) {
        this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
    }
    // ─── Bot Binding (for block queries) ────────────────
    setBot(bot) {
        this.bot = bot;
    }
    clearBot() {
        this.bot = null;
    }
    // ─── Emergency Override ─────────────────────────────
    // LLM intents CAN be overridden by safety.
    emergencyStop(reason) {
        this.emergencyLocked = true;
        this.emergencyReason = reason;
        console.error(`[SafetyGuard] EMERGENCY STOP: ${reason}`);
    }
    clearEmergency() {
        this.emergencyLocked = false;
        this.emergencyReason = "";
        console.log("[SafetyGuard] Emergency cleared — resuming normal operation");
    }
    isEmergencyLocked() {
        return this.emergencyLocked;
    }
    getEmergencyReason() {
        return this.emergencyReason;
    }
    blockAll(reason) {
        this.emergencyStop(reason);
    }
    unblockAll() {
        this.clearEmergency();
    }
    // ─── Main Validation ────────────────────────────────
    validate(intent, botState) {
        const errors = [];
        // 0. Emergency check — override everything
        if (this.emergencyLocked) {
            errors.push({
                field: "*",
                message: `EMERGENCY LOCKDOWN: ${this.emergencyReason}. All actions blocked.`,
                severity: "critical",
            });
            return { valid: false, errors };
        }
        // 1. Check if action is blocked
        if (this.config.blockedActions.includes(intent.type)) {
            errors.push({
                field: "type",
                message: `Action "${intent.type}" is permanently blocked`,
                severity: "critical",
            });
            return { valid: false, errors };
        }
        // 2. Spam detection (global, any action type)
        errors.push(...this.validateSpam(intent));
        // 3. Rate limit check (per-action cooldown)
        const cooldown = this.config.cooldowns[intent.type];
        if (cooldown) {
            const lastTime = lastActionTimes.get(intent.type) || 0;
            const elapsed = Date.now() - lastTime;
            if (elapsed < cooldown) {
                errors.push({
                    field: "type",
                    message: `Rate limited: ${intent.type} cooldown (${cooldown - elapsed}ms remaining)`,
                    severity: "error", // blocks the action
                });
            }
        }
        // 4. Per-action safety checks
        switch (intent.type) {
            case "attack_entity":
                errors.push(...this.validateAttack(intent));
                break;
            case "drop_item":
                errors.push(...this.validateDrop(intent));
                break;
            case "dig_down":
                errors.push(...this.validateDigDown(intent, botState));
                break;
            case "mine_block":
                errors.push(...this.validateMine(intent));
                break;
            case "place_block":
                errors.push(...this.validatePlace(intent));
                break;
            case "move_to":
                errors.push(...this.validateMove(intent, botState));
                break;
            case "follow_player":
                errors.push(...this.validateFollow(intent));
                break;
            case "flee":
                // Flee is always allowed — safety override
                break;
        }
        // 5. Health check for dangerous actions
        if (botState && this.isDangerousAction(intent.type) && intent.type !== "flee") {
            const healthPercent = (botState.health / 20) * 100;
            if (healthPercent < this.config.retreatHealthPercent) {
                errors.push({
                    field: "type",
                    message: `Health too low (${healthPercent.toFixed(0)}%) for dangerous action: ${intent.type}`,
                    severity: "error",
                });
            }
        }
        // 6. Position safety check (lava/void near target)
        if (this.bot && this.isPositionAction(intent.type)) {
            errors.push(...this.validatePositionSafety(intent));
        }
        // Only critical + error severity make the intent invalid
        // Warnings are informational only and don't block execution
        const blockingErrors = errors.filter((e) => e.severity === "critical" || e.severity === "error");
        return {
            valid: blockingErrors.length === 0,
            errors,
        };
    }
    // ─── Spam Detection ─────────────────────────────────
    validateSpam(intent) {
        const key = intent.type;
        const now = Date.now();
        const tracker = spamTracker.get(key);
        if (!tracker || now - tracker.windowStart > SPAM_WINDOW_MS) {
            spamTracker.set(key, { count: 1, windowStart: now });
            return [];
        }
        tracker.count++;
        if (tracker.count > SPAM_MAX_ACTIONS) {
            return [{
                    field: "type",
                    message: `Action spam detected: ${tracker.count} "${intent.type}" in ${SPAM_WINDOW_MS}ms (max ${SPAM_MAX_ACTIONS})`,
                    severity: "critical",
                }];
        }
        return [];
    }
    // ─── Position Safety (lava/void) ────────────────────
    validatePositionSafety(intent) {
        const errors = [];
        const target = intent.target;
        const targetX = target.x;
        const targetY = target.y;
        const targetZ = target.z;
        if (targetX === undefined || targetZ === undefined)
            return errors;
        const x = targetX, z = targetZ;
        // Check blocks around target for lava
        if (this.bot) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dy = -2; dy <= 0; dy++) {
                        try {
                            const y = (targetY ?? this.bot.entity.position.y) + dy;
                            const block = this.bot.blockAt(new Vec3(x + dx, y, z + dz));
                            if (block && (block.name === "lava" || block.name === "flowing_lava")) {
                                errors.push({
                                    field: "target",
                                    message: `Lava detected within ${this.config.lavaSearchRadius} blocks of target (${x + dx}, ${y}, ${z + dz})`,
                                    severity: "critical",
                                });
                                return errors; // One lava block is enough to block
                            }
                        }
                        catch {
                            // Block out of range — ignore
                        }
                    }
                }
            }
        }
        // Void check — target Y must be above min safe level
        if (targetY !== undefined && targetY < this.config.minSafeY) {
            errors.push({
                field: "target.y",
                message: `Target Y=${targetY} is below minimum safe level ${this.config.minSafeY} (possible void)`,
                severity: "critical",
            });
        }
        return errors;
    }
    // ─── Per-Action Validators ──────────────────────────
    validateAttack(intent) {
        const errors = [];
        const target = intent.target;
        if (target.playerName) {
            errors.push({
                field: "target",
                message: `Attacking player "${target.playerName}" — verify this is intentional PvP`,
                severity: "warning",
            });
        }
        const dangerousMobs = ["warden", "ender_dragon", "wither"];
        if (target.entityType && dangerousMobs.includes(target.entityType)) {
            errors.push({
                field: "target",
                message: `Attacking dangerous entity "${target.entityType}" — verify gear and strategy`,
                severity: "warning",
            });
        }
        return errors;
    }
    validateDrop(intent) {
        const errors = [];
        const target = intent.target;
        if (target.itemName && this.config.protectedItems.includes(target.itemName)) {
            errors.push({
                field: "target.itemName",
                message: `Refusing to drop protected item: "${target.itemName}"`,
                severity: "critical",
            });
        }
        return errors;
    }
    validateDigDown(_intent, botState) {
        const errors = [];
        errors.push({
            field: "type",
            message: "dig_down is risky — verify area below is safe",
            severity: "warning",
        });
        if (botState && botState.dimension === "overworld" && botState.position.y < 10) {
            errors.push({
                field: "type",
                message: "Near void level — dig_down blocked",
                severity: "critical",
            });
        }
        // Check for lava directly below if bot is bound
        if (this.bot) {
            try {
                const pos = this.bot.entity.position;
                for (let dy = -1; dy >= -5; dy--) {
                    const block = this.bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) + dy, Math.floor(pos.z)));
                    if (block && (block.name === "lava" || block.name === "flowing_lava")) {
                        errors.push({
                            field: "type",
                            message: `Lava detected ${Math.abs(dy)} blocks below — dig_down blocked`,
                            severity: "critical",
                        });
                        break;
                    }
                }
            }
            catch {
                // Out of range — skip
            }
        }
        return errors;
    }
    validateMine(intent) {
        const errors = [];
        const target = intent.target;
        const structureBlocks = [
            "chest", "furnace", "crafting_table", "enchanting_table",
            "anvil", "beacon", "ender_chest", "shulker_box", "barrel",
            "bed", "door", "trapdoor",
        ];
        if (target.blockType && structureBlocks.includes(target.blockType)) {
            errors.push({
                field: "target.blockType",
                message: `Mining structure block "${target.blockType}" — verify this is intended`,
                severity: "warning",
            });
        }
        return errors;
    }
    validatePlace(intent) {
        const errors = [];
        const target = intent.target;
        if (target.count && target.count > this.config.maxBuildBlocks) {
            errors.push({
                field: "target.count",
                message: `Place count ${target.count} exceeds max ${this.config.maxBuildBlocks}`,
                severity: "error",
            });
        }
        return errors;
    }
    validateMove(intent, botState) {
        const errors = [];
        const target = intent.target;
        if (target.x !== undefined && target.z !== undefined) {
            const x = target.x;
            const z = target.z;
            // World border check
            const maxCoord = 29_999_984;
            if (Math.abs(x) > maxCoord || Math.abs(z) > maxCoord) {
                errors.push({
                    field: "target",
                    message: "Move target outside world border",
                    severity: "critical",
                });
            }
            // Fall damage check
            if (botState && target.y !== undefined) {
                const yDelta = botState.position.y - target.y;
                if (yDelta > this.config.maxFallDistance) {
                    errors.push({
                        field: "target.y",
                        message: `Move would cause ${yDelta.toFixed(1)} block fall (max ${this.config.maxFallDistance}) — potential fall damage`,
                        severity: "critical",
                    });
                }
            }
        }
        return errors;
    }
    validateFollow(intent) {
        const errors = [];
        const target = intent.target;
        if (!target.playerName || target.playerName.trim().length === 0) {
            errors.push({
                field: "target.playerName",
                message: "follow_player requires a valid playerName",
                severity: "error",
            });
        }
        return errors;
    }
    // ─── Helpers ────────────────────────────────────────
    isDangerousAction(type) {
        return ["attack_entity", "dig_down", "mine_block"].includes(type);
    }
    isPositionAction(type) {
        return ["move_to", "dig_down", "go_to_surface"].includes(type);
    }
    recordAction(actionType) {
        lastActionTimes.set(actionType, Date.now());
    }
    getCooldownRemaining(actionType) {
        const cooldown = this.config.cooldowns[actionType] || 0;
        const lastTime = lastActionTimes.get(actionType) || 0;
        return Math.max(0, cooldown - (Date.now() - lastTime));
    }
    updateConfig(partial) {
        this.config = { ...this.config, ...partial };
    }
    getConfig() {
        return this.config;
    }
}
//# sourceMappingURL=safety-guard.js.map