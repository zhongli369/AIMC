// ─── Rare Item Names ──────────────────────────────────
const RARE_ITEMS = new Set([
    "diamond", "diamond_ore", "diamond_block", "diamond_pickaxe", "diamond_sword",
    "netherite", "netherite_ingot", "netherite_scrap", "ancient_debris",
    "elytra", "dragon_egg", "dragon_head", "nether_star", "beacon",
    "enchanted_golden_apple", "totem_of_undying", "trident", "heart_of_the_sea",
    "ender_pearl", "ender_eye", "blaze_rod", "ghast_tear", "wither_skull",
    "shulker_shell", "spawner", "enchanted_book", "music_disc",
]);
const RARE_ENTITIES = new Set([
    "ender_dragon", "wither", "elder_guardian", "warden",
    "piglin_brute", "ravager", "evoker", "vindicator",
]);
// ─── Keyword Patterns ────────────────────────────────
const DEATH_KEYWORDS = ["died", "death", "killed", "slain", "respawn", "grave"];
const COMBAT_KEYWORDS = ["attacked", "damage", "hit", "explosion", "creeper", "skeleton", "zombie", "spider", "combat", "fight", "defend"];
const WARNING_KEYWORDS = ["emergency", "danger", "low health", "starving", "lava", "void", "falling", "drowning", "fire"];
const INTERACTION_KEYWORDS = ["player", "said", "chat", "asked", "told", "gave", "shared"];
// ─── Engine ─────────────────────────────────────────
export class ImportanceEngine {
    /**
     * Score a memory candidate. Returns importance from 1 to 10.
     * Uses additive scoring: each factor contributes points, total capped at 10.
     */
    score(candidate) {
        let score = 1; // Base score — everything gets at least 1
        // Death / near-death: +9 (dominates)
        score += this.scoreDeathProximity(candidate);
        // Combat: up to +6
        score += this.scoreCombat(candidate);
        // Rare items/entities: up to +5
        score += this.scoreRareItems(candidate);
        // Player interaction: up to +4
        score += this.scorePlayerInteraction(candidate);
        // System warnings: up to +5
        score += this.scoreSystemWarnings(candidate);
        // Repeated patterns: up to +3
        score += this.scoreRepeatedPatterns(candidate);
        // Emotional valence boost: up to +2 for strong emotions
        if (Math.abs(candidate.emotionalValence || 0) > 0.7) {
            score += 2;
        }
        // Type-based bonus
        if (candidate.type === "failure")
            score += 2;
        if (candidate.type === "emotional")
            score += 1;
        return Math.max(1, Math.min(10, Math.round(score)));
    }
    filterImportant(candidates, threshold = 3) {
        return candidates.filter((c) => this.score(c) >= threshold);
    }
    scoreBatch(candidates) {
        for (const c of candidates) {
            c.importance = this.score(c);
        }
        return candidates;
    }
    // ─── Individual Scoring Factors (return points to add) ────
    scoreDeathProximity(c) {
        const text = `${c.summary} ${c.details || ""}`.toLowerCase();
        for (const kw of DEATH_KEYWORDS) {
            if (text.includes(kw))
                return 9; // Maximum — death dominates importance
        }
        if (text.includes("low health") || text.includes("almost dead"))
            return 7;
        return 0;
    }
    scoreCombat(c) {
        const text = `${c.summary} ${c.details || ""}`.toLowerCase();
        let score = 0;
        for (const kw of COMBAT_KEYWORDS) {
            if (text.includes(kw))
                score += 3;
        }
        if (c.relatedEntities) {
            for (const entity of c.relatedEntities) {
                if (RARE_ENTITIES.has(entity.toLowerCase()))
                    score += 3;
            }
        }
        return Math.min(6, score);
    }
    scoreRareItems(c) {
        const text = `${c.summary} ${c.details || ""}`.toLowerCase();
        for (const item of RARE_ITEMS) {
            if (text.includes(item))
                return 5;
        }
        if (c.tags) {
            for (const tag of c.tags) {
                if (tag.toLowerCase().includes("rare") || tag.toLowerCase().includes("valuable")) {
                    return 3;
                }
            }
        }
        return 0;
    }
    scorePlayerInteraction(c) {
        const text = `${c.summary} ${c.details || ""}`.toLowerCase();
        let score = 0;
        for (const kw of INTERACTION_KEYWORDS) {
            if (text.includes(kw))
                score += 2;
        }
        if (c.tags) {
            for (const tag of c.tags) {
                if (["social", "chat", "teamwork", "help"].includes(tag.toLowerCase())) {
                    score += 1;
                }
            }
        }
        return Math.min(4, score);
    }
    scoreRepeatedPatterns(c) {
        if (!c.tags || c.tags.length === 0)
            return 0;
        const specificTags = c.tags.filter((t) => !["event", "general", "misc"].includes(t.toLowerCase()));
        return Math.min(3, specificTags.length);
    }
    scoreSystemWarnings(c) {
        const text = `${c.summary} ${c.details || ""}`.toLowerCase();
        for (const kw of WARNING_KEYWORDS) {
            if (text.includes(kw))
                return 5;
        }
        return 0;
    }
}
// ─── Convenience Export ──────────────────────────────
/** Quick score a single candidate with default weights. */
export function scoreImportance(candidate) {
    const engine = new ImportanceEngine();
    return engine.score(candidate);
}
//# sourceMappingURL=importance.js.map