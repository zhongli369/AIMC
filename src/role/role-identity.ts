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

// ─── Companion Roles ──────────────────────────────────

export type CompanionRole =
  | "miner"
  | "fighter"
  | "scout"
  | "support"
  | "balanced";

export const ALL_ROLES: CompanionRole[] = [
  "miner", "fighter", "scout", "support", "balanced",
];

// ─── Role Profile ─────────────────────────────────────

export interface RoleProfile {
  role: CompanionRole;
  /** Human-readable label */
  label: string;
  /** Natural-language description */
  description: string;
  /** Preferred skills (higher weight = more likely selected) */
  preferredSkills: string[];
  /** Avoided skills (lower weight) */
  avoidedSkills: string[];
  /** Base skill weight multipliers (1.0 = neutral) */
  skillWeights: Record<string, number>;
  /** How many extra retries for preferred skills */
  retryBias: number;
  /** How strongly the role biases exploration (0–1) */
  explorationBias: number;
  /** How strongly the role biases support behavior (0–1) */
  supportBias: number;
  /** How strongly the role biases combat engagement (0–1) */
  combatBias: number;
  /** Voice/narration style descriptor */
  voiceStyle: "direct" | "calm" | "curious" | "practical" | "versatile";
  /** Narration pacing modifier (< 1 = faster, > 1 = slower) */
  narrationPacing: number;
  /** Confidence wording style */
  confidenceStyle: "decisive" | "reassuring" | "observant" | "task-focused" | "adaptable";
}

// ─── Role Profiles ────────────────────────────────────

export const ROLE_PROFILES: Record<CompanionRole, RoleProfile> = {
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

// ─── Companion Identity ───────────────────────────────

export interface CompanionIdentity {
  /** Current active role */
  currentRole: CompanionRole;
  /** Confidence in current role (0–1). Stablizes over time. */
  confidence: number;
  /** Role history with timestamps */
  roleHistory: RoleHistoryEntry[];
  /** Most dominant behavior patterns (by observation count) */
  dominantTraits: BehaviorTrait[];
  /** When the identity was created */
  createdAt: number;
  /** When the identity was last updated */
  updatedAt: number;
}

export interface RoleHistoryEntry {
  role: CompanionRole;
  confidence: number;
  reason: string;
  timestamp: number;
}

export interface BehaviorTrait {
  trait: string;        // "mining_heavy", "combat_frequent", "exploration_heavy", "support_oriented"
  observationCount: number;
  lastObservedAt: number;
}

// ─── Factory ──────────────────────────────────────────

export function createIdentity(initialRole: CompanionRole = "balanced"): CompanionIdentity {
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

export function getRoleProfile(role: CompanionRole): RoleProfile {
  return ROLE_PROFILES[role];
}

/**
 * Get the default skill weight for a given skill under a given role.
 * Returns 1.0 if not explicitly defined.
 */
export function getRoleSkillWeight(role: CompanionRole, skillName: string): number {
  return ROLE_PROFILES[role].skillWeights[skillName] ?? 1.0;
}
