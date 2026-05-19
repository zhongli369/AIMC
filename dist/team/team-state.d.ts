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
export type TeamMode = "peaceful" | "mining" | "combat" | "exploration" | "retreat";
export interface TeamMemberState {
    /** Player/entity name */
    name: string;
    /** Approximate position */
    position: {
        x: number;
        y: number;
        z: number;
    } | null;
    /** Health (0–20) if known */
    health: number | null;
    /** Food/hunger (0–20) if known */
    hunger: number | null;
    /** Estimated armor level (0=none, 1=leather, 2=iron, 3=diamond) */
    armorLevel: number;
    /** What the player appears to be doing */
    currentAction: PlayerAction;
    /** Threat level (0–1) based on hostiles nearby, low health */
    threatLevel: number;
    /** Distance from bot in blocks */
    distanceToBot: number;
    /** When the member was last observed (epoch ms) */
    lastSeenAt: number;
}
export type PlayerAction = "idle" | "mining" | "building" | "fighting" | "fleeing" | "gathering" | "exploring" | "unknown";
export interface ActiveThreat {
    /** Entity type */
    entityType: string;
    /** Entity name (display) */
    entityName: string;
    /** Distance from nearest team member */
    distanceToTeam: number;
    /** Distance from bot */
    distanceToBot: number;
    /** How many team members are targeted */
    targetsCount: number;
}
export interface TeamState {
    /** Nearby players (within 64 blocks) */
    nearbyPlayers: TeamMemberState[];
    /** Current team leader (closest player or self) */
    currentLeader: string;
    /** Active threats within range */
    activeThreats: ActiveThreat[];
    /** Current coordination mode */
    teamMode: TeamMode;
    /** Bot's own threat level (0–1) */
    botThreatLevel: number;
    /** Whether the bot is isolated from the team (>32 blocks) */
    isIsolated: boolean;
    /** Timestamp of this snapshot */
    snapshotAt: number;
}
export declare function createEmptyTeamState(): TeamState;
/**
 * Build a TeamState snapshot from raw data sources.
 * This is the ONLY function that should construct TeamState.
 *
 * Input data comes from read-only sources:
 *   - globalThis.__WORLD_STATE__ (nearby entities)
 *   - globalThis.__botState__ (bot health, position)
 *   - EventBus (player events)
 */
export declare function buildTeamState(params: {
    botPosition: {
        x: number;
        y: number;
        z: number;
    } | null;
    botHealth: number;
    nearbyEntities: string[];
    nearbyPlayers: string[];
    nearbyHostiles: string[];
    playerDistances?: Map<string, number>;
}): TeamState;
//# sourceMappingURL=team-state.d.ts.map