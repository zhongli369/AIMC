/**
 * IntentPrediction — cooperative intent anticipation (Phase 4-F).
 *
 * Predicts short-term player intentions from observable context.
 * ADVISORY ONLY — predictions NEVER execute directly.
 * Output flows through normal AgentCore → SkillRouter pipeline.
 *
 * MUST NOT:
 *   - Execute actions independently
 *   - Create hidden task queues
 *   - Bypass SkillRouter or ActionDispatcher
 *   - Access Mineflayer directly
 */
const DEFAULT_PREDICTION_CONFIG = {
    minConfidenceForAssist: 0.4,
    familiarityBoost: 0.15,
    maxSupportActions: 2,
};
// ─── Predictor ──────────────────────────────────────────
export class IntentPredictor {
    config;
    predictionHistory = [];
    constructor(config) {
        this.config = { ...DEFAULT_PREDICTION_CONFIG, ...config };
    }
    /**
     * Predict the player's current short-term intent.
     *
     * DETERMINISTIC analysis — no AI, no randomness.
     * Uses weighted evidence scoring across multiple signals.
     */
    predict(context) {
        const scores = new Map();
        const evidence = [];
        // Initialize all intents
        for (const intent of ALL_PLAYER_INTENTS) {
            scores.set(intent, 0);
        }
        // ── Signal: Held item ──────────────────────────
        if (context.heldItem) {
            const item = context.heldItem.toLowerCase();
            if (/pickaxe|pick/.test(item)) {
                this.addScore(scores, "mining", 0.4, `Holding ${context.heldItem}`, evidence);
            }
            else if (/sword|axe/.test(item)) {
                this.addScore(scores, "combat", 0.35, `Holding ${context.heldItem}`, evidence);
            }
            else if (/shovel/.test(item)) {
                this.addScore(scores, "building", 0.2, `Holding ${context.heldItem}`, evidence);
            }
            else if (/torch/.test(item)) {
                this.addScore(scores, "exploration", 0.3, `Holding ${context.heldItem}`, evidence);
            }
            else if (/food|bread|steak|porkchop|apple|golden_apple/.test(item)) {
                this.addScore(scores, "inventory_management", 0.25, `Holding food`, evidence);
            }
            else if (/bow|crossbow/.test(item)) {
                this.addScore(scores, "combat", 0.4, `Holding ranged weapon`, evidence);
            }
        }
        // ── Signal: Nearby blocks ──────────────────────
        const oreBlocks = context.nearbyBlocks.filter((b) => /ore|diamond|emerald|gold|iron|coal|redstone|lapis|copper/.test(b));
        if (oreBlocks.length >= 3) {
            this.addScore(scores, "mining", 0.5, `${oreBlocks.length} ore blocks nearby`, evidence);
        }
        else if (oreBlocks.length > 0) {
            this.addScore(scores, "mining", 0.3, "Ore blocks visible", evidence);
        }
        const stoneBlocks = context.nearbyBlocks.filter((b) => /stone|cobblestone|deepslate/.test(b));
        if (stoneBlocks.length >= 10 && oreBlocks.length === 0) {
            this.addScore(scores, "mining", 0.2, "Dense stone — possible mining", evidence);
        }
        // ── Signal: Nearby entities ────────────────────
        const hostiles = context.nearbyEntities.filter((e) => /zombie|skeleton|creeper|spider|witch|hoglin|piglin_brute|enderman|blaze|ghast/i.test(e));
        if (hostiles.length >= 3) {
            this.addScore(scores, "combat", 0.7, `${hostiles.length} hostiles nearby`, evidence);
            this.addScore(scores, "retreat", 0.3, "Dangerous enemy count", evidence);
        }
        else if (hostiles.length > 0) {
            this.addScore(scores, "combat", 0.4, "Hostile mobs present", evidence);
        }
        // ── Signal: Movement patterns ──────────────────
        if (context.movementSpeed !== undefined) {
            if (context.movementSpeed < 0.5) {
                this.addScore(scores, "idle", 0.3, "Very slow movement", evidence);
                this.addScore(scores, "inventory_management", 0.15, "Standing still", evidence);
            }
            else if (context.movementSpeed < 2) {
                this.addScore(scores, "mining", 0.1, "Slow, deliberate movement", evidence);
                this.addScore(scores, "building", 0.1, "Slow movement", evidence);
            }
            else if (context.movementSpeed > 5) {
                this.addScore(scores, "travel", 0.4, "Fast movement", evidence);
                if (hostiles.length > 0) {
                    this.addScore(scores, "retreat", 0.5, "Running with hostiles nearby", evidence);
                }
            }
        }
        // ── Signal: Recent actions ─────────────────────
        for (const action of context.recentActions) {
            const a = action.toLowerCase();
            if (/attack|hit|strike|fight/.test(a))
                this.addScore(scores, "combat", 0.25, "Recent attack", evidence);
            if (/mine|dig|break/.test(a))
                this.addScore(scores, "mining", 0.3, "Recent mining", evidence);
            if (/place|build/.test(a))
                this.addScore(scores, "building", 0.3, "Recent building", evidence);
            if (/run|sprint|flee/.test(a)) {
                this.addScore(scores, "retreat", 0.35, "Recent fleeing", evidence);
                this.addScore(scores, "travel", 0.15, "Fast movement", evidence);
            }
            if (/eat|consume/.test(a))
                this.addScore(scores, "inventory_management", 0.2, "Recent eating", evidence);
            if (/open|chest|inventory/.test(a))
                this.addScore(scores, "inventory_management", 0.35, "Inventory access", evidence);
        }
        // ── Signal: Team state ─────────────────────────
        if (context.teamState) {
            if (context.teamState.teamMode === "combat") {
                this.addScore(scores, "combat", 0.5, "Team in combat mode", evidence);
            }
            else if (context.teamState.teamMode === "mining") {
                this.addScore(scores, "mining", 0.4, "Team in mining mode", evidence);
            }
            else if (context.teamState.teamMode === "exploration") {
                this.addScore(scores, "exploration", 0.4, "Team in exploration mode", evidence);
            }
            else if (context.teamState.teamMode === "retreat") {
                this.addScore(scores, "retreat", 0.6, "Team in retreat mode", evidence);
            }
            if (context.teamState.isIsolated) {
                this.addScore(scores, "regroup", 0.4, "Isolated from team", evidence);
            }
        }
        // ── Signal: Player condition ───────────────────
        if (context.playerHealth !== undefined && context.playerHealth < 8) {
            this.addScore(scores, "retreat", 0.5, "Player low health", evidence);
            this.addScore(scores, "inventory_management", 0.2, "May need to eat/heal", evidence);
        }
        if (context.playerHunger !== undefined && context.playerHunger < 6) {
            this.addScore(scores, "inventory_management", 0.3, "Player hungry", evidence);
        }
        // ── Signal: Game time ──────────────────────────
        if (context.gameTime !== undefined) {
            // Night time (13000–23000) = more cautious
            if (context.gameTime > 13000 && context.gameTime < 23000) {
                this.addScore(scores, "exploration", -0.1, "Nighttime — less exploration", evidence);
            }
        }
        // ── Find best prediction ───────────────────────
        let bestIntent = "idle";
        let bestScore = -999;
        for (const [intent, score] of scores) {
            if (score > bestScore) {
                bestScore = score;
                bestIntent = intent;
            }
        }
        // Normalize to 0–1 confidence
        const confidence = Math.min(0.95, Math.max(0.1, (bestScore + 0.5) / 1.5));
        // Familiarity boost — more familiar = better prediction accuracy
        const familiarityBoost = (context.familiarityLevel / 100) * this.config.familiarityBoost;
        const adjustedConfidence = Math.min(0.95, confidence + familiarityBoost);
        const prediction = {
            intentType: bestIntent,
            confidence: adjustedConfidence,
            estimatedDurationMs: this.estimateDuration(bestIntent),
            supportOpportunity: this.mapSupportOpportunity(bestIntent, context),
            reasoning: `Best match: ${bestIntent} (score: ${bestScore.toFixed(2)}, evidence: ${evidence.length} signals)`,
            evidence,
        };
        // Track history
        this.predictionHistory.unshift(prediction);
        if (this.predictionHistory.length > 20) {
            this.predictionHistory = this.predictionHistory.slice(0, 20);
        }
        return prediction;
    }
    /**
     * Determine if companion should assist given a prediction.
     *
     * Returns true when:
     *   - Confidence exceeds threshold
     *   - Support opportunity is not "none"
     *   - Intent is one where assistance is genuinely helpful
     */
    shouldAssist(prediction) {
        if (prediction.confidence < this.config.minConfidenceForAssist)
            return false;
        if (prediction.supportOpportunity === "none")
            return false;
        // Never auto-assist for inventory management or idle
        if (prediction.intentType === "inventory_management" || prediction.intentType === "idle") {
            return false;
        }
        return true;
    }
    /**
     * Get the priority of support (1–5, 5 = most urgent).
     */
    getSupportPriority(prediction, context) {
        let priority = 3;
        // Combat support is highest priority
        if (prediction.intentType === "combat" || prediction.intentType === "retreat") {
            priority = 5;
        }
        // Rescue/regroup is high priority
        else if (prediction.supportOpportunity === "regroup") {
            priority = 4;
        }
        // Guard during mining is important
        else if (prediction.intentType === "mining" && prediction.supportOpportunity === "guard") {
            priority = 4;
        }
        // Exploration support is medium
        else if (prediction.intentType === "exploration") {
            priority = 2;
        }
        // Boost priority if player is in danger
        if (context.playerHealth !== undefined && context.playerHealth < 6) {
            priority = Math.min(5, priority + 1);
        }
        // Higher familiarity → slightly higher priority (companion cares more)
        if (context.familiarityLevel > 60) {
            priority = Math.min(5, priority + 1);
        }
        return priority;
    }
    /** Get prediction history for pattern analysis. */
    getHistory(limit) {
        return this.predictionHistory.slice(0, limit ?? 10);
    }
    /** Get the most recent prediction. */
    getLastPrediction() {
        return this.predictionHistory[0] || null;
    }
    // ─── Internal ──────────────────────────────────────
    addScore(scores, intent, delta, reason, evidence) {
        const current = scores.get(intent) ?? 0;
        scores.set(intent, current + delta);
        if (delta > 0 && !evidence.includes(reason)) {
            evidence.push(reason);
        }
    }
    estimateDuration(intent) {
        switch (intent) {
            case "mining": return 60000;
            case "combat": return 15000;
            case "exploration": return 45000;
            case "retreat": return 8000;
            case "building": return 90000;
            case "regroup": return 10000;
            case "inventory_management": return 12000;
            case "travel": return 30000;
            case "idle": return 5000;
        }
    }
    mapSupportOpportunity(intent, context) {
        switch (intent) {
            case "mining":
                // If hostiles nearby → guard; otherwise assist mining
                const hasNearbyHostiles = context.nearbyEntities.some((e) => /zombie|skeleton|creeper|spider/i.test(e));
                return hasNearbyHostiles ? "guard" : "assist_mining";
            case "combat":
                return "combat_backup";
            case "exploration":
                return context.nearbyEntities.some((e) => /zombie|skeleton|creeper|spider/i.test(e))
                    ? "scout_ahead"
                    : "collect_drops";
            case "retreat":
                return "regroup";
            case "building":
                return "guard";
            case "regroup":
                return "regroup";
            case "inventory_management":
                return "hold_position";
            case "travel":
                return "scout_ahead";
            case "idle":
            default:
                return "none";
        }
    }
}
const ALL_PLAYER_INTENTS = [
    "mining", "combat", "exploration", "retreat", "building",
    "regroup", "inventory_management", "travel", "idle",
];
//# sourceMappingURL=intent-prediction.js.map