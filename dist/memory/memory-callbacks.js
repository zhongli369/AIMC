/**
 * MemoryCallbackGenerator — deterministic natural companion references (Phase 4-E).
 *
 * Generates contextual callbacks referencing shared history.
 * Examples:
 *   "上次我们在矿洞也遇到过苦力怕"
 *   "你之前挖矿的时候喜欢往左探路"
 *   "上次我救过你一次，这次别乱冲了"
 *
 * TEMPLATE-DRIVEN ONLY. NO LLM calls. NO external APIs.
 * Callbacks are OPTIONAL flavor — never block execution.
 *
 * Bilingual: zh (primary) + en (fallback).
 */
const COMBAT_CALLBACKS = {
    zh: [
        "上次我们在{location}也遇到过{enemy}，这次小心点。",
        "记得上次打{enemy}的时候吗？差点翻车。",
        "跟{enemy}交手这么多次，你应该知道怎么打了。",
        "上次{enemy}差点把你炸飞，这次站我后面。",
        "我们打{enemy}已经有经验了，配合好就行。",
        "又来{enemy}？上次的教训还记得吧。",
    ],
    en: [
        "Last time we fought a {enemy} at {location}, remember to be careful.",
        "We've handled {enemy} before, we know the drill.",
        "Remember when a {enemy} almost got us? Stay alert.",
        "We've got experience with {enemy} — let's coordinate.",
    ],
};
const EXPLORATION_CALLBACKS = {
    zh: [
        "你之前探路的时候喜欢往{direction}走，这次呢？",
        "上次我们在这附近发现了{discovery}，再找找看。",
        "我记得你喜欢{direction}方向探索，这次还走那边？",
        "上次探索{location}的时候挺有意思的。",
        "这片区域我们好像来过，上次你在这里挖了不少矿。",
        "你的探索风格我很熟悉了，{direction}边对吧？",
    ],
    en: [
        "You tend to explore {direction} — shall we go that way again?",
        "Last time near here we found {discovery}. Let's look again.",
        "I remember you like heading {direction} when exploring.",
        "We've been to {location} before, I remember it well.",
    ],
};
const RESCUE_CALLBACKS = {
    zh: [
        "上次我救过你一次，这次别乱冲了。",
        "记得之前我把你从{location}救出来吗？注意安全。",
        "我们互相救过好几次了，这就是队友的默契。",
        "上次你救我于{enemy}之口，现在换我保护你。",
        "又被困住了？跟我上次救你的时候一模一样。",
    ],
    en: [
        "I've saved you before — let's not repeat that, okay?",
        "Remember when I pulled you out of {location}? Stay safe.",
        "We've rescued each other plenty of times. That's team默契.",
        "You saved me from {enemy} last time — now it's my turn.",
    ],
};
const MINING_CALLBACKS = {
    zh: [
        "你之前挖矿的时候喜欢{style}，效率不错。",
        "上次我们在这挖到了{resource}，继续往下挖吧。",
        "你挖矿的习惯我记住了，{depth}层最有效率。",
        "记得上次我们一起挖{resource}吗？收获不错。",
    ],
    en: [
        "You like to mine {style} — it works well for us.",
        "Last time we found {resource} here. Let's keep digging.",
        "I remember your mining patterns. Let's hit {depth} level.",
    ],
};
const BUILDING_CALLBACKS = {
    zh: [
        "上次你建的{building}挺好看的，还继续扩建吗？",
        "记得之前我们一起建的{building}吗？是时候升级了。",
        "你的建筑风格我熟悉，需要帮忙的话说一声。",
    ],
    en: [
        "That {building} you built last time was great. Shall we expand?",
        "Remember the {building} we built together? Time for an upgrade.",
    ],
};
const MILESTONE_CALLBACKS = {
    zh: [
        "说起来，我们已经一起玩了{sessions}次了，越来越有默契。",
        "从第一次见面到现在，我们的配合成熟了不少。",
        "这段时间跟你一起玩很开心，感觉像老朋友一样。",
        "我们经历过{events}，已经是配合默契的老搭档了。",
    ],
    en: [
        "We've played together {sessions} times now. Feels natural.",
        "From our first meeting to now — we've grown into a real team.",
        "I enjoy adventuring with you. We've been through {events} together.",
    ],
};
const FAILURE_CALLBACKS = {
    zh: [
        "上次{event}的教训还记得吧，这次换个策略。",
        "失败没什么，上次{event}之后我们不是变强了吗？",
        "记得上次{event}的时候吗？吃一堑长一智。",
    ],
    en: [
        "We learned from {event} last time. Different approach this time?",
        "Failure happens — after {event} last time, we came back stronger.",
    ],
};
const FUNNY_CALLBACKS = {
    zh: [
        "哈哈哈，这让我想起上次{event}的事。",
        "你还记得上次{event}吗？现在想起来都想笑。",
        "跟上次{event}一样搞笑，跟你一起玩总是有意思。",
    ],
    en: [
        "Haha, this reminds me of {event} last time.",
        "Remember {event}? Still makes me laugh thinking about it.",
        "Just like {event} last time — you're always entertaining.",
    ],
};
// ─── Category → Template Map ──────────────────────────
const CATEGORY_TEMPLATES = {
    combat: COMBAT_CALLBACKS,
    exploration: EXPLORATION_CALLBACKS,
    rescue: RESCUE_CALLBACKS,
    mining: MINING_CALLBACKS,
    building: BUILDING_CALLBACKS,
    milestone: MILESTONE_CALLBACKS,
    failure: FAILURE_CALLBACKS,
    funny: FUNNY_CALLBACKS,
};
// ─── Context Extraction Helpers ───────────────────────
function extractPlaceholders(exp) {
    const placeholders = {
        enemy: "",
        location: "",
        discovery: "",
        direction: "",
        resource: "",
        style: "",
        building: "",
        event: "",
        sessions: "",
        events: "",
        depth: "",
    };
    const s = exp.summary;
    const tags = exp.tags;
    // Enemy detection
    const enemyMatch = s.match(/僵尸|骷髅|苦力怕|蜘蛛|末影人|女巫|猪灵|烈焰人|恶魂|zombie|skeleton|creeper|spider|enderman|witch|piglin|blaze|ghast/i);
    if (enemyMatch)
        placeholders.enemy = enemyMatch[0];
    // Location detection
    const locMatch = s.match(/矿洞|洞穴|山顶|地下|森林|沙漠|海洋|下界|末地|cave|mountain|underground|forest|desert|ocean|nether/i);
    if (locMatch)
        placeholders.location = locMatch[0];
    else if (exp.location)
        placeholders.location = `${exp.location.x.toFixed(0)},${exp.location.z.toFixed(0)}附近`;
    // Direction detection
    const dirMatch = s.match(/左边|右边|东|南|西|北|前方|left|right|east|west|north|south/i);
    if (dirMatch)
        placeholders.direction = dirMatch[0];
    // Resource detection
    const resMatch = s.match(/铁矿|金矿|钻石|煤炭|红石|青金石|铜|铁|金|钻石|iron|gold|diamond|coal|redstone|lapis|copper/i);
    if (resMatch)
        placeholders.resource = resMatch[0];
    // Use tags as fallbacks
    for (const tag of tags) {
        if (!placeholders.enemy && /zombie|skeleton|creeper|spider|苦力怕|僵尸|骷髅/i.test(tag))
            placeholders.enemy = tag;
        if (!placeholders.location && /cave|mine|矿洞|地下/i.test(tag))
            placeholders.location = tag;
        if (!placeholders.resource && /ore|矿|iron|gold|diamond/i.test(tag))
            placeholders.resource = tag;
        if (!placeholders.building && /house|base|shelter|房子|基地|建筑/i.test(tag))
            placeholders.building = tag;
    }
    return placeholders;
}
// ─── Generator ─────────────────────────────────────────
export class MemoryCallbackGenerator {
    usedCallbacks = new Set();
    language;
    constructor(language = "zh") {
        this.language = language;
    }
    /** Set output language. */
    setLanguage(lang) {
        this.language = lang;
    }
    /**
     * Generate a contextual callback referencing shared experience.
     * Returns null if no relevant memory or template available.
     *
     * This is DETERMINISTIC — no AI, no randomness beyond template selection.
     */
    getContextualCallback(experiences, currentContext) {
        if (experiences.length === 0)
            return null;
        // Pick the most relevant experience
        let exp;
        if (currentContext?.category) {
            const categoryMatches = experiences.filter((e) => e.category === currentContext.category);
            exp = categoryMatches[0] || experiences[0];
        }
        else {
            exp = experiences[0];
        }
        return this.generateForExperience(exp);
    }
    /** Generate a combat-specific callback. */
    getCombatCallback(combatExperiences) {
        if (combatExperiences.length === 0)
            return null;
        const exp = combatExperiences[0];
        return this.generateForExperience(exp);
    }
    /** Generate an exploration-specific callback. */
    getExplorationCallback(explorationExperiences) {
        if (explorationExperiences.length === 0)
            return null;
        const exp = explorationExperiences[0];
        return this.generateForExperience(exp);
    }
    /** Generate a rescue callback from shared rescue experiences. */
    getRescueCallback(rescueExperiences) {
        if (rescueExperiences.length === 0)
            return null;
        const exp = rescueExperiences[0];
        return this.generateForExperience(exp);
    }
    /** Generate a milestone callback. */
    getMilestoneCallback(milestoneExperiences, extra) {
        const templates = MILESTONE_CALLBACKS;
        const lang = this.language;
        const options = templates[lang];
        if (options.length === 0)
            return null;
        let template = this.pickLeastUsed(options);
        template = template.replace("{sessions}", String(extra?.sessionsTogether ?? "很多"));
        template = template.replace("{events}", String(extra?.eventsCount ?? "那么多事"));
        // If there's a specific milestone experience, incorporate it
        if (milestoneExperiences.length > 0) {
            const exp = milestoneExperiences[0];
            const ph = extractPlaceholders(exp);
            for (const [key, value] of Object.entries(ph)) {
                if (value)
                    template = template.replace(`{${key}}`, value);
            }
        }
        return this.finalize(template);
    }
    /** Get a generic relationship callback based on warmth level. */
    getRelationshipCallback(warmthFactor) {
        const lang = this.language;
        if (warmthFactor < 0.25) {
            return lang === "zh" ? "我们慢慢熟悉彼此吧。" : "Let's get to know each other better.";
        }
        if (warmthFactor < 0.5) {
            return lang === "zh" ? "跟你配合越来越有感觉了。" : "We're getting the hang of working together.";
        }
        if (warmthFactor < 0.75) {
            return lang === "zh" ? "跟你一起冒险总是很有意思。" : "Adventuring with you is always fun.";
        }
        return lang === "zh" ? "像老朋友一样，不用说太多就知道该怎么做。" : "Like old friends — we just know what to do.";
    }
    // ─── Internal ───────────────────────────────────────
    generateForExperience(exp) {
        const templates = CATEGORY_TEMPLATES[exp.category];
        if (!templates)
            return null;
        const lang = this.language;
        const options = templates[lang];
        if (options.length === 0)
            return null;
        let template = this.pickLeastUsed(options);
        const placeholders = extractPlaceholders(exp);
        for (const [key, value] of Object.entries(placeholders)) {
            if (value) {
                template = template.replace(`{${key}}`, value);
            }
        }
        // Clean up any remaining unreplaced placeholders
        template = template.replace(/\{[a-z]+\}/g, "").replace(/\s+/g, " ").trim();
        return this.finalize(template);
    }
    /** Pick the least recently used template to reduce repetition. */
    pickLeastUsed(options) {
        // Try to find one not recently used
        for (const opt of options) {
            if (!this.usedCallbacks.has(opt)) {
                return opt;
            }
        }
        // All used — clear history and start fresh
        this.usedCallbacks.clear();
        return options[0];
    }
    finalize(template) {
        const cleaned = template.trim();
        if (!cleaned)
            return null;
        // Track usage
        this.usedCallbacks.add(cleaned);
        // Keep set bounded
        if (this.usedCallbacks.size > 50) {
            const entries = [...this.usedCallbacks];
            this.usedCallbacks = new Set(entries.slice(-25));
        }
        return cleaned;
    }
    /** Reset usage tracking. */
    reset() {
        this.usedCallbacks.clear();
    }
}
//# sourceMappingURL=memory-callbacks.js.map