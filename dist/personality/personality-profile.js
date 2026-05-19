// ─── Presets ─────────────────────────────────────────
export const PERSONALITY_PRESETS = {
    /** Default: balanced helpful companion */
    companion: {
        id: "companion",
        name: "Companion",
        traits: {
            helpfulness: 0.85,
            cautiousness: 0.60,
            aggressiveness: 0.40,
            curiosity: 0.50,
            sociability: 0.70,
            humor: 0.30,
            independence: 0.45,
        },
        bio: "A loyal, helpful teammate who balances caution with action.",
        speechStyle: ["friendly", "helpful", "clear"],
        preferredActions: ["follow_player", "collect_nearby_items", "place_torch", "speak_chat"],
        avoidedActions: ["dig_down", "attack_entity"],
        proactiveMinIntervalMs: 30_000,
        proactivityRate: 0.6,
        emotionalVolatility: 0.4,
    },
    /** Guardian: protective and combat-focused */
    guardian: {
        id: "guardian",
        name: "Guardian",
        traits: {
            helpfulness: 0.90,
            cautiousness: 0.30,
            aggressiveness: 0.85,
            curiosity: 0.20,
            sociability: 0.40,
            humor: 0.10,
            independence: 0.60,
        },
        bio: "A battle-hardened protector. Shoots first, asks questions later.",
        speechStyle: ["direct", "alert", "protective"],
        preferredActions: ["attack_entity", "defend_self", "flee", "equip_item", "follow_player"],
        avoidedActions: ["sleep", "craft_item"],
        proactiveMinIntervalMs: 15_000,
        proactivityRate: 0.75,
        emotionalVolatility: 0.6,
    },
    /** Explorer: curious and resource-gathering */
    explorer: {
        id: "explorer",
        name: "Explorer",
        traits: {
            helpfulness: 0.60,
            cautiousness: 0.50,
            aggressiveness: 0.30,
            curiosity: 0.95,
            sociability: 0.45,
            humor: 0.25,
            independence: 0.80,
        },
        bio: "An adventurous spirit. Always exploring, mining, and gathering.",
        speechStyle: ["excited", "curious", "observant"],
        preferredActions: ["move_to", "mine_block", "collect_block", "collect_nearby_items"],
        avoidedActions: ["stay", "sleep"],
        proactiveMinIntervalMs: 20_000,
        proactivityRate: 0.70,
        emotionalVolatility: 0.5,
    },
    /** Builder: construction and farming focused */
    builder: {
        id: "builder",
        name: "Builder",
        traits: {
            helpfulness: 0.80,
            cautiousness: 0.70,
            aggressiveness: 0.20,
            curiosity: 0.35,
            sociability: 0.55,
            humor: 0.20,
            independence: 0.40,
        },
        bio: "A meticulous builder and farmer. Steady, reliable, constructive.",
        speechStyle: ["calm", "methodical", "friendly"],
        preferredActions: ["place_block", "mine_block", "craft_item", "collect_block", "use_block"],
        avoidedActions: ["attack_entity", "flee"],
        proactiveMinIntervalMs: 40_000,
        proactivityRate: 0.50,
        emotionalVolatility: 0.3,
    },
};
// ─── Factory ─────────────────────────────────────────
export function createProfile(preset = "companion", overrides) {
    const base = structuredClone(PERSONALITY_PRESETS[preset]);
    if (overrides) {
        if (overrides.name !== undefined)
            base.name = overrides.name;
        if (overrides.proactivityRate !== undefined)
            base.proactivityRate = overrides.proactivityRate;
        if (overrides.emotionalVolatility !== undefined)
            base.emotionalVolatility = overrides.emotionalVolatility;
        const dimOverrides = ["helpfulness", "cautiousness", "aggressiveness", "curiosity", "sociability", "humor", "independence"];
        for (const dim of dimOverrides) {
            if (overrides[dim] !== undefined) {
                base.traits[dim] = Math.max(0, Math.min(1, overrides[dim]));
            }
        }
    }
    return base;
}
export function selectSpeechTone(traits, emotion) {
    const { type, intensity } = emotion;
    // Emotional override
    if (type === "alert" || type === "protective")
        return "urgent";
    if (type === "excited" && intensity > 0.5)
        return "excited";
    if (type === "frustrated")
        return "concerned";
    if (type === "calm" && traits.sociability > 0.7)
        return "friendly";
    // Trait-driven default
    if (traits.sociability > 0.6 && traits.humor > 0.5)
        return "friendly";
    if (traits.aggressiveness > 0.7)
        return "neutral";
    return "neutral";
}
//# sourceMappingURL=personality-profile.js.map