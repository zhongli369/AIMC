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

// ─── Team Modes ──────────────────────────────────────

export type TeamMode =
  | "peaceful"     // No threats, following player casually
  | "mining"       // Player is mining, assist with gathering
  | "combat"       // Hostiles engaged, protect mode
  | "exploration"  // Moving through new terrain
  | "retreat";     // Falling back, prioritize survival

// ─── Member State ─────────────────────────────────────

export interface TeamMemberState {
  /** Player/entity name */
  name: string;
  /** Approximate position */
  position: { x: number; y: number; z: number } | null;
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

export type PlayerAction =
  | "idle"
  | "mining"
  | "building"
  | "fighting"
  | "fleeing"
  | "gathering"
  | "exploring"
  | "unknown";

// ─── Active Threat ────────────────────────────────────

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

// ─── Team State ───────────────────────────────────────

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

// ─── Factory ──────────────────────────────────────────

export function createEmptyTeamState(): TeamState {
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
export function buildTeamState(params: {
  botPosition: { x: number; y: number; z: number } | null;
  botHealth: number;
  nearbyEntities: string[];
  nearbyPlayers: string[];
  nearbyHostiles: string[];
  playerDistances?: Map<string, number>;
}): TeamState {
  const botPos = params.botPosition;
  const members: TeamMemberState[] = [];

  // Classify each nearby player
  for (const playerStr of params.nearbyPlayers) {
    const name = playerStr.replace(/ \(\d+m\)$/, "");
    const distMatch = playerStr.match(/\((\d+)m\)/);
    const distance = distMatch ? parseInt(distMatch[1], 10) : 50;

    const member: TeamMemberState = {
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
    } else if (distance > 32) {
      member.currentAction = "exploring";
    }

    members.push(member);
  }

  // Classify active threats
  const threats: ActiveThreat[] = [];
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
  let teamMode: TeamMode = "peaceful";
  const botThreatLevel = computeBotThreatLevel(params.botHealth, threats);

  if (botThreatLevel > 0.7 || params.botHealth < 8) {
    teamMode = "retreat";
  } else if (threats.length >= 3) {
    teamMode = "combat";
  } else if (threats.length >= 1) {
    teamMode = "combat";
  } else {
    // Check member actions for mode hints
    const fightingCount = members.filter((m) => m.currentAction === "fighting").length;
    if (fightingCount > 0) {
      teamMode = "combat";
    } else if (members.some((m) => m.currentAction === "mining")) {
      teamMode = "mining";
    } else if (members.some((m) => m.currentAction === "exploring") || members.length === 0) {
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

function computeBotThreatLevel(health: number, threats: ActiveThreat[]): number {
  let threat = 0;
  if (health < 10) threat += 0.4;
  if (health < 6) threat += 0.3;
  if (threats.length >= 5) threat += 0.3;
  else if (threats.length >= 3) threat += 0.2;
  else if (threats.length >= 1) threat += 0.1;
  return Math.min(1.0, threat);
}
