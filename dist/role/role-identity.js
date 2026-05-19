/**
 * RoleIdentity — persistent companion role specialization model.
 *
 * Defines 5 companion roles, their behavioral profiles, and
 * the CompanionIdentity that persists across play sessions.
 *
 * This is a DATA MODEL only. It does NOT:
 *   - Execute actions
 *   - Bypass the execution chain
 *   - Create autonomous behavior
 *   - Access Mineflayer
 */
export const ALL_ROLES = [
    "miner", "fighter", "scout", "support", "balanced",
];
// ─── Role Profiles ────────────────────────────────────
export const ROLE_PROFILES = {
    miner: {
        role: "miner",
        label: "Miner",
        description: "Specializes in resource gathering and block collection. Prefers mining over combat.",
        preferredSkills: ["mine_resource", "collect_items", "gather_food"],
        avoidedSkills: ["attack_target", "defend_player"],
        skillWeights: {
            mine_resource: 2.0,
            collect_items: 1.8,
            gather_food: 1.5,
            explore_area: 1.3,
            follow_player: 1.0,
            build_shelter: 0.8,
            attack_target: 0.2,
            defend_player: 0.5,
        },
        retryBias: 1,
        explorationBias: 0.6,
        supportBias: 0.4,
        combatBias: 0.2,
        voiceStyle: "practical",
        narrationPacing: 1.0,
        confidenceStyle: "task-focused",
    },
    fighter: {
        role: "fighter",
        label: "Fighter",
        description: "Combat-focused protector. Engages threats aggressively and defends teammates.",
        preferredSkills: ["attack_target", "defend_player", "follow_player"],
        avoidedSkills: ["build_shelter", "gather_food"],
        skillWeights: {
            attack_target: 2.5,
            defend_player: 2.0,
            follow_player: 1.5,
            explore_area: 0.8,
            collect_items: 0.5,
            mine_resource: 0.3,
            gather_food: 0.4,
            build_shelter: 0.1,
        },
        retryBias: 2,
        explorationBias: 0.3,
        supportBias: 0.7,
        combatBias: 0.9,
        voiceStyle: "direct",
        narrationPacing: 0.8,
        confidenceStyle: "decisive",
    },
    scout: {
        role: "scout",
        label: "Scout",
        description: "Exploration specialist. Roams ahead, finds resources, maps terrain.",
        preferredSkills: ["explore_area", "collect_items", "follow_player"],
        avoidedSkills: ["build_shelter", "attack_target"],
        skillWeights: {
            explore_area: 2.5,
            collect_items: 1.5,
            follow_player: 1.2,
            mine_resource: 1.0,
            gather_food: 0.8,
            attack_target: 0.3,
            defend_player: 0.5,
            build_shelter: 0.2,
        },
        retryBias: 0,
        explorationBias: 0.9,
        supportBias: 0.3,
        combatBias: 0.3,
        voiceStyle: "curious",
        narrationPacing: 1.1,
        confidenceStyle: "observant",
    },
    support: {
        role: "support",
        label: "Support",
        description: "Teammate-focused helper. Follows, protects, assists with any task.",
        preferredSkills: ["follow_player", "defend_player", "collect_items", "gather_food"],
        avoidedSkills: ["attack_target", "explore_area"],
        skillWeights: {
            follow_player: 2.5,
            defend_player: 1.8,
            collect_items: 1.8,
            gather_food: 1.5,
            build_shelter: 1.0,
            mine_resource: 0.8,
            explore_area: 0.3,
            attack_target: 0.4,
        },
        retryBias: 1,
        explorationBias: 0.2,
        supportBias: 0.9,
        combatBias: 0.5,
        voiceStyle: "calm",
        narrationPacing: 0.9,
        confidenceStyle: "reassuring",
    },
    balanced: {
        role: "balanced",
        label: "Balanced",
        description: "Versatile companion. Adapts to whatever the situation demands.",
        preferredSkills: [],
        avoidedSkills: [],
        skillWeights: {
            follow_player: 1.2,
            collect_items: 1.1,
            mine_resource: 1.0,
            explore_area: 1.0,
            gather_food: 1.0,
            attack_target: 1.0,
            defend_player: 1.1,
            build_shelter: 1.0,
        },
        retryBias: 0,
        explorationBias: 0.5,
        supportBias: 0.5,
        combatBias: 0.5,
        voiceStyle: "versatile",
        narrationPacing: 1.0,
        confidenceStyle: "adaptable",
    },
};
// ─── Factory ──────────────────────────────────────────
export function createIdentity(initialRole = "balanced") {
    return {
        currentRole: initialRole,
        confidence: 0.3,
        roleHistory: [{
                role: initialRole,
                confidence: 0.3,
                reason: "Initial role assignment",
                timestamp: Date.now(),
            }],
        dominantTraits: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}
export function getRoleProfile(role) {
    return ROLE_PROFILES[role];
}
/**
 * Get the default skill weight for a given skill under a given role.
 * Returns 1.0 if not explicitly defined.
 */
export function getRoleSkillWeight(role, skillName) {
    return ROLE_PROFILES[role].skillWeights[skillName] ?? 1.0;
}
//# sourceMappingURL=role-identity.js.map