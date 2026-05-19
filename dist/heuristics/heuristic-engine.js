const DEFAULT_CONFIG = {
    safeHealthPercent: 60,
    fleeHealthPercent: 25,
    eatHungerThreshold: 14,
    torchLightLevel: 4,
    followMaxDistance: 50,
    followTriggerDistance: 8,
    pickupRange: 5,
    followCooldownMs: 3000,
    torchCooldownMs: 2000,
    enabled: true,
};
// ─── Heuristic Engine ─────────────────────────────────
export class HeuristicEngine {
    config;
    lastFollowTime = 0;
    lastTorchTime = 0;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    get enabled() {
        return this.config.enabled;
    }
    setEnabled(v) {
        this.config.enabled = v;
    }
    // ─── Main Evaluation ─────────────────────────────────
    /**
     * Evaluate current state and produce a heuristic decision if appropriate.
     * Returns null when no heuristic applies (LLM should handle it).
     */
    evaluate(params) {
        if (!this.config.enabled)
            return null;
        // ═══ TIER 1: SURVIVAL (always act, never wait for LLM) ═══
        const fleeDecision = this.checkFlee(params.botState, params.nearby);
        if (fleeDecision)
            return fleeDecision;
        const dodgeDecision = this.checkDodge(params.nearby);
        if (dodgeDecision)
            return dodgeDecision;
        const eatDecision = this.checkEat(params.botState, params.inventoryItems);
        if (eatDecision)
            return eatDecision;
        // ═══ TIER 2: UTILITY (only when high confidence) ═══
        const torchDecision = this.checkTorch(params.lightLevel, params.inventoryItems);
        if (torchDecision)
            return torchDecision;
        const followDecision = this.checkFollow(params.botState, params.nearby);
        if (followDecision)
            return followDecision;
        const pickupDecision = this.checkPickup(params.nearby);
        if (pickupDecision)
            return pickupDecision;
        // ═══ No heuristic applies — LLM must handle it ═══
        return null;
    }
    // ─── Survival Checks ─────────────────────────────────
    checkFlee(botState, nearby) {
        const healthPct = (botState.health / 20) * 100;
        if (healthPct > this.config.fleeHealthPercent)
            return null;
        if (nearby.hostiles.length === 0)
            return null;
        return {
            decided: true,
            category: "survival",
            reason: `Health critically low (${Math.round(healthPct)}%) with ${nearby.hostiles.length} hostile(s) nearby`,
            output: {
                actions: [{
                        id: `heuristic-flee-${Date.now()}`,
                        type: "flee",
                        target: {},
                        priority: 5,
                        reason: "survival_flee_low_health",
                    }],
                speech: { text: "Fleeing!", tone: "urgent" },
            },
            confidence: 1.0,
        };
    }
    checkDodge(nearby) {
        const danger = nearby.projectiles.length > 0 || nearby.hostiles.some((h) => /creeper|tnt/i.test(h));
        if (!danger)
            return null;
        return {
            decided: true,
            category: "survival",
            reason: `Immediate danger: ${nearby.projectiles.length > 0 ? "projectiles inbound" : "creeper/TNT nearby"}`,
            output: {
                actions: [{
                        id: `heuristic-dodge-${Date.now()}`,
                        type: "flee",
                        target: {},
                        priority: 5,
                        reason: "survival_dodge_danger",
                    }],
            },
            confidence: 0.95,
        };
    }
    checkEat(botState, inventory) {
        if (botState.food >= this.config.eatHungerThreshold)
            return null;
        const hasFood = inventory?.some((item) => /steak|cooked|cod|salmon|porkchop|mutton|chicken|rabbit.*stew|golden_apple|golden_carrot/i.test(item));
        if (!hasFood)
            return null;
        return {
            decided: true,
            category: "survival",
            reason: `Hunger low (${botState.food}/20), food available in inventory`,
            output: {
                actions: [{
                        id: `heuristic-eat-${Date.now()}`,
                        type: "consume",
                        target: {},
                        priority: 5,
                        reason: "survival_eat_hunger",
                    }],
            },
            confidence: 0.95,
        };
    }
    // ─── Utility Checks ──────────────────────────────────
    checkTorch(lightLevel, inventory) {
        if (lightLevel === undefined || lightLevel > this.config.torchLightLevel)
            return null;
        const hasTorch = inventory?.some((item) => /torch|lantern|glowstone|campfire/i.test(item));
        if (!hasTorch)
            return null;
        // Cooldown
        if (Date.now() - this.lastTorchTime < this.config.torchCooldownMs)
            return null;
        this.lastTorchTime = Date.now();
        return {
            decided: true,
            category: "utility",
            reason: `Light level low (${lightLevel}), torch available`,
            output: {
                actions: [{
                        id: `heuristic-torch-${Date.now()}`,
                        type: "place_block",
                        target: {},
                        priority: 3,
                        reason: "utility_light_placement",
                    }],
            },
            confidence: 0.85,
        };
    }
    checkFollow(botState, nearby) {
        if (nearby.players.length === 0)
            return null;
        // Cooldown
        if (Date.now() - this.lastFollowTime < this.config.followCooldownMs)
            return null;
        // Check if any player is far enough to trigger follow
        // We use a heuristic here since we don't have real distance — check entity strings
        const farPlayers = nearby.players.filter((p) => {
            const distMatch = p.match(/\((\d+)m\)/);
            if (distMatch) {
                return parseInt(distMatch[1], 10) > this.config.followTriggerDistance;
            }
            return false;
        });
        if (farPlayers.length === 0)
            return null;
        this.lastFollowTime = Date.now();
        return {
            decided: true,
            category: "utility",
            reason: `Player${farPlayers.length > 1 ? "s" : ""} more than ${this.config.followTriggerDistance}m away`,
            output: {
                actions: [{
                        id: `heuristic-follow-${Date.now()}`,
                        type: "follow_player",
                        target: {},
                        priority: 3,
                        reason: "utility_follow_player",
                    }],
            },
            confidence: 0.80,
        };
    }
    checkPickup(nearby) {
        if (nearby.items.length === 0)
            return null;
        // Filter items within pickup range
        const inRange = nearby.items.filter((item) => {
            const distMatch = item.match(/\((\d+(?:\.\d+)?)m\)/);
            if (distMatch) {
                return parseFloat(distMatch[1]) <= this.config.pickupRange;
            }
            return true; // Can't parse distance, assume in range
        });
        if (inRange.length === 0)
            return null;
        return {
            decided: true,
            category: "utility",
            reason: `${inRange.length} item(s) within pickup range`,
            output: {
                actions: [{
                        id: `heuristic-pickup-${Date.now()}`,
                        type: "collect_nearby_items",
                        target: {},
                        priority: 2,
                        reason: "utility_collect_items",
                    }],
            },
            confidence: 0.90,
        };
    }
    // ─── Quick Utility ───────────────────────────────────
    /**
     * Get a quick action preference without generating full output.
     * Useful for rate-limiting decisions or pre-filtering.
     */
    quickCheck(params) {
        const healthPct = (params.botState.health / 20) * 100;
        return {
            shouldFlee: healthPct <= this.config.fleeHealthPercent && params.nearby.hostiles.length > 0,
            shouldEat: params.botState.food < this.config.eatHungerThreshold,
            shouldDodge: params.nearby.projectiles.length > 0 || params.nearby.hostiles.some((h) => /creeper|tnt/i.test(h)),
        };
    }
}
//# sourceMappingURL=heuristic-engine.js.map