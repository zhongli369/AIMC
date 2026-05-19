/**
 * RelationshipState — long-term companion relationship model (Phase 4-E).
 *
 * Tracks familiarity, trust, and teamwork metrics across sessions.
 * This is SOCIAL CONTINUITY ONLY — NOT a second memory system.
 *
 * MUST NOT:
 *   - Execute actions
 *   - Create autonomous planning
 *   - Bypass execution chain
 *   - Access Mineflayer directly
 *
 * All state flows through normal AgentCore → SkillRouter pipeline.
 */
// ─── Factory ───────────────────────────────────────────
export function createRelationshipState() {
    return {
        familiarityLevel: 5,
        trustLevel: 10,
        teamworkScore: 5,
        lastSeenAt: Date.now(),
        sessionsTogether: 1,
        totalPlayTimeMs: 0,
        rescueCount: 0,
        sharedVictories: 0,
        sharedDeaths: 0,
        favoriteActivities: [],
        recentMemories: [],
        emotionalAffinity: 0.05,
        interactionStyle: "formal",
        firstSessionAt: Date.now(),
        activitiesCount: {},
        schemaVersion: 1,
    };
}
const DEFAULT_RELATIONSHIP_CONFIG = {
    decayRatePerHour: 0.005,
    maxRecentMemories: 20,
    friendlyThreshold: 25,
    closeThreshold: 55,
    familialThreshold: 80,
    trustDamping: 0.15,
    affinityDamping: 0.1,
    maxLevel: 100,
};
// ─── Engine ────────────────────────────────────────────
export class RelationshipEngine {
    state;
    config;
    constructor(state, config) {
        this.state = state ?? createRelationshipState();
        this.config = { ...DEFAULT_RELATIONSHIP_CONFIG, ...config };
        this.updateInteractionStyle();
    }
    // ─── State Access ──────────────────────────────────
    getState() {
        return this.state;
    }
    /** Generate a lightweight snapshot safe for LLM context injection. */
    getSnapshot() {
        const { familiarityLevel, trustLevel, teamworkScore, emotionalAffinity, interactionStyle } = this.state;
        let summary;
        if (familiarityLevel < 20) {
            summary = "刚认识的玩家，还在熟悉中。";
        }
        else if (familiarityLevel < 45) {
            summary = "已经一起玩过一段时间了，配合越来越好。";
        }
        else if (familiarityLevel < 70) {
            summary = "配合默契的队友，互相信任。";
        }
        else {
            summary = "像老朋友一样的长期伙伴，完全信任。";
        }
        const promptSafe = [
            `Relationship: ${interactionStyle} style, familiarity ${familiarityLevel}/100, trust ${trustLevel}/100`,
            `Teamwork score: ${teamworkScore}/100`,
            `Shared victories: ${this.state.sharedVictories}, rescues: ${this.state.rescueCount}`,
            this.state.favoriteActivities.length > 0
                ? `Favorite activities: ${this.state.favoriteActivities.slice(0, 3).map((a) => a.activity).join(", ")}`
                : null,
            this.state.recentMemories.length > 0
                ? `Recent: ${this.state.recentMemories.slice(0, 3).join("; ")}`
                : null,
        ].filter(Boolean).join(". ");
        return {
            familiarity: familiarityLevel,
            trust: trustLevel,
            teamwork: teamworkScore,
            affinity: emotionalAffinity,
            style: interactionStyle,
            summary,
            promptSafe,
            generatedAt: Date.now(),
        };
    }
    // ─── Trust ──────────────────────────────────────────
    increaseTrust(amount, reason) {
        const damped = amount * this.config.trustDamping;
        this.state.trustLevel = Math.min(this.config.maxLevel, this.state.trustLevel + damped);
        console.log(`[Relationship] Trust +${damped.toFixed(1)} (now ${this.state.trustLevel.toFixed(0)}) — ${reason}`);
    }
    decreaseTrust(amount, reason) {
        const damped = amount * this.config.trustDamping;
        this.state.trustLevel = Math.max(0, this.state.trustLevel - damped);
        console.log(`[Relationship] Trust -${damped.toFixed(1)} (now ${this.state.trustLevel.toFixed(0)}) — ${reason}`);
    }
    // ─── Familiarity ────────────────────────────────────
    increaseFamiliarity(amount) {
        this.state.familiarityLevel = Math.min(this.config.maxLevel, this.state.familiarityLevel + amount);
        this.updateInteractionStyle();
    }
    /** Apply decay based on time since last seen. */
    applyAbsenceDecay(absenceMs) {
        const hours = absenceMs / 3600_000;
        const decay = hours * this.config.decayRatePerHour * 100;
        // Familiarity decays; trust decays less
        this.state.familiarityLevel = Math.max(0, this.state.familiarityLevel - decay * 0.5);
        this.state.trustLevel = Math.max(0, this.state.trustLevel - decay * 0.2);
        this.updateInteractionStyle();
    }
    // ─── Events ─────────────────────────────────────────
    registerVictory(type, playerInvolved) {
        if (playerInvolved) {
            this.state.sharedVictories++;
            this.increaseFamiliarity(2);
            this.increaseTrust(3, `Shared victory: ${type}`);
        }
        this.state.teamworkScore = Math.min(this.config.maxLevel, this.state.teamworkScore + 1);
        this.trackActivity("combat");
    }
    registerFailure(type, playerInvolved) {
        if (playerInvolved) {
            this.state.sharedDeaths++;
            this.increaseFamiliarity(1); // Shared failure still builds familiarity
            // Trust impact depends on context — slight decrease by default
            this.decreaseTrust(0.5, `Shared failure: ${type}`);
        }
        this.trackActivity("combat");
    }
    registerRescue(playerWasRescued) {
        if (playerWasRescued) {
            this.state.rescueCount++;
            this.increaseTrust(8, "Companion rescued player");
            this.increaseFamiliarity(3);
            this.state.emotionalAffinity = Math.min(1.0, this.state.emotionalAffinity + 0.05);
        }
        else {
            this.increaseTrust(5, "Player rescued companion");
            this.increaseFamiliarity(2);
            this.state.emotionalAffinity = Math.min(1.0, this.state.emotionalAffinity + 0.03);
        }
        this.state.teamworkScore = Math.min(this.config.maxLevel, this.state.teamworkScore + 2);
        this.trackActivity("rescue");
    }
    registerSessionStart() {
        const now = Date.now();
        if (this.state.lastSeenAt > 0) {
            const absence = now - this.state.lastSeenAt;
            if (absence > 3600_000) {
                this.applyAbsenceDecay(absence);
            }
        }
        this.state.lastSeenAt = now;
        this.state.sessionsTogether++;
        this.increaseFamiliarity(1);
    }
    registerSessionEnd(sessionDurationMs) {
        this.state.totalPlayTimeMs += sessionDurationMs;
        this.state.lastSeenAt = Date.now();
    }
    registerDiscovery(description) {
        this.trackActivity("exploration");
        this.increaseFamiliarity(0.5);
        this.addRecentMemory(`发现了${description}`);
    }
    registerBuild(description) {
        this.trackActivity("building");
        this.increaseFamiliarity(0.5);
        this.addRecentMemory(`一起建造了${description}`);
    }
    // ─── Activities ─────────────────────────────────────
    trackActivity(activity) {
        this.state.activitiesCount[activity] = (this.state.activitiesCount[activity] || 0) + 1;
        // Update favorite activities ranking
        const sorted = Object.entries(this.state.activitiesCount)
            .map(([a, c]) => ({ activity: a, count: c }))
            .sort((a, b) => b.count - a.count);
        this.state.favoriteActivities = sorted.slice(0, 8);
    }
    // ─── Memories ───────────────────────────────────────
    addRecentMemory(summary) {
        this.state.recentMemories.unshift(summary);
        if (this.state.recentMemories.length > this.config.maxRecentMemories) {
            this.state.recentMemories = this.state.recentMemories.slice(0, this.config.maxRecentMemories);
        }
    }
    // ─── Warmth ─────────────────────────────────────────
    /**
     * Get companionship warmth factor (0–1).
     * Influences narration tone, proactive behavior confidence, voice style.
     */
    getWarmthFactor() {
        const familiarityNorm = this.state.familiarityLevel / 100;
        const trustNorm = this.state.trustLevel / 100;
        const affinityNorm = (this.state.emotionalAffinity + 1) / 2; // -1..1 → 0..1
        return (familiarityNorm * 0.4 + trustNorm * 0.35 + affinityNorm * 0.25);
    }
    /**
     * Get initiative confidence (0–1).
     * How confident the companion is to act proactively.
     * High familiarity + high trust = more initiative.
     */
    getInitiativeConfidence() {
        const warmth = this.getWarmthFactor();
        const teamworkNorm = this.state.teamworkScore / 100;
        return Math.min(0.95, warmth * 0.6 + teamworkNorm * 0.4);
    }
    // ─── Internal ───────────────────────────────────────
    updateInteractionStyle() {
        const f = this.state.familiarityLevel;
        if (f >= this.config.familialThreshold) {
            this.state.interactionStyle = "familial";
        }
        else if (f >= this.config.closeThreshold) {
            this.state.interactionStyle = "close";
        }
        else if (f >= this.config.friendlyThreshold) {
            this.state.interactionStyle = "friendly";
        }
        else {
            this.state.interactionStyle = "formal";
        }
    }
    /** Replace state entirely (for loading from persistence). */
    setState(state) {
        this.state = state;
        this.updateInteractionStyle();
    }
}
//# sourceMappingURL=relationship-state.js.map