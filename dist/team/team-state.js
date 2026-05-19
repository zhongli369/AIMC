/**
 * TeamState — lightweight tactical awareness model.
 *
 * Provides a READ-ONLY snapshot of nearby players, threats, and
 * team coordination mode. This is a perception layer only.
 *
 * MUST NOT:
 *   - Write to Mineflayer
 *   - Execute actions
 *   - Bypass the execution chain
 */
// ─── Factory ──────────────────────────────────────────
export function createEmptyTeamState() {
    return {
        nearbyPlayers: [],
        currentLeader: "self",
        activeThreats: [],
        teamMode: "peaceful",
        botThreatLevel: 0,
        isIsolated: false,
        snapshotAt: Date.now(),
    };
}
/**
 * Build a TeamState snapshot from raw data sources.
 * This is the ONLY function that should construct TeamState.
 *
 * Input data comes from read-only sources:
 *   - globalThis.__WORLD_STATE__ (nearby entities)
 *   - globalThis.__botState__ (bot health, position)
 *   - EventBus (player events)
 */
export function buildTeamState(params) {
    const botPos = params.botPosition;
    const members = [];
    // Classify each nearby player
    for (const playerStr of params.nearbyPlayers) {
        const name = playerStr.replace(/ \(\d+m\)$/, "");
        const distMatch = playerStr.match(/\((\d+)m\)/);
        const distance = distMatch ? parseInt(distMatch[1], 10) : 50;
        const member = {
            name,
            position: null, // Can't get exact from entity strings
            health: null,
            hunger: null,
            armorLevel: 0,
            currentAction: "unknown",
            threatLevel: params.nearbyHostiles.length > 0 ? 0.5 : 0.1,
            distanceToBot: distance,
            lastSeenAt: Date.now(),
        };
        // Heuristic: infer action from surroundings
        if (params.nearbyHostiles.length > 2) {
            member.currentAction = "fighting";
            member.threatLevel = 0.8;
        }
        else if (distance > 32) {
            member.currentAction = "exploring";
        }
        members.push(member);
    }
    // Classify active threats
    const threats = [];
    for (const hostile of params.nearbyHostiles) {
        const name = hostile.replace(/ \(\d+m\)$/, "");
        const distMatch = hostile.match(/\((\d+)m\)/);
        const distance = distMatch ? parseInt(distMatch[1], 10) : 30;
        threats.push({
            entityType: name,
            entityName: name,
            distanceToTeam: distance,
            distanceToBot: distance,
            targetsCount: 1,
        });
    }
    // Determine team mode
    let teamMode = "peaceful";
    const botThreatLevel = computeBotThreatLevel(params.botHealth, threats);
    if (botThreatLevel > 0.7 || params.botHealth < 8) {
        teamMode = "retreat";
    }
    else if (threats.length >= 3) {
        teamMode = "combat";
    }
    else if (threats.length >= 1) {
        teamMode = "combat";
    }
    else {
        // Check member actions for mode hints
        const fightingCount = members.filter((m) => m.currentAction === "fighting").length;
        if (fightingCount > 0) {
            teamMode = "combat";
        }
        else if (members.some((m) => m.currentAction === "mining")) {
            teamMode = "mining";
        }
        else if (members.some((m) => m.currentAction === "exploring") || members.length === 0) {
            teamMode = "exploration";
        }
    }
    const isIsolated = members.length === 0 || members.every((m) => m.distanceToBot > 32);
    return {
        nearbyPlayers: members,
        currentLeader: members.length > 0 ? members[0].name : "self",
        activeThreats: threats,
        teamMode,
        botThreatLevel,
        isIsolated,
        snapshotAt: Date.now(),
    };
}
function computeBotThreatLevel(health, threats) {
    let threat = 0;
    if (health < 10)
        threat += 0.4;
    if (health < 6)
        threat += 0.3;
    if (threats.length >= 5)
        threat += 0.3;
    else if (threats.length >= 3)
        threat += 0.2;
    else if (threats.length >= 1)
        threat += 0.1;
    return Math.min(1.0, threat);
}
//# sourceMappingURL=team-state.js.map