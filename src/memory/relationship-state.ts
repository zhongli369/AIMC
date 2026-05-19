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

import { randomUUID } from "node:crypto";

// ─── Relationship State ───────────────────────────────

export interface RelationshipState {
  /** 0–100: how familiar the companion is with this player */
  familiarityLevel: number;
  /** 0–100: how much the companion trusts the player */
  trustLevel: number;
  /** 0–100: how well they work together */
  teamworkScore: number;
  /** Unix ms of last session */
  lastSeenAt: number;
  /** Number of distinct sessions played together */
  sessionsTogether: number;
  /** Total ms played together */
  totalPlayTimeMs: number;
  /** Times companion rescued player from danger */
  rescueCount: number;
  /** Shared combat victories */
  sharedVictories: number;
  /** Times both died in same encounter */
  sharedDeaths: number;
  /** Most frequent shared activities */
  favoriteActivities: { activity: string; count: number }[];
  /** Last N shared memory summaries */
  recentMemories: string[];
  /** Emotional affinity (-1.0 dislike → 1.0 very close) */
  emotionalAffinity: number;
  /** How the companion interacts with this player */
  interactionStyle: "formal" | "friendly" | "close" | "familial";
  /** First session timestamp */
  firstSessionAt: number;
  /** Raw activity counter (internal) */
  activitiesCount: Record<string, number>;
  /** Schema version for persistence */
  schemaVersion: number;
}

// ─── Relationship Snapshot ─────────────────────────────

/** Lightweight summary safe for LLM prompt injection. */
export interface RelationshipSnapshot {
  /** 0–100 familiarity */
  familiarity: number;
  /** 0–100 trust */
  trust: number;
  /** 0–100 teamwork */
  teamwork: number;
  /** -1 to 1 emotional affinity */
  affinity: number;
  /** Interaction style label */
  style: string;
  /** 1-sentence relationship summary */
  summary: string;
  /** LLM-safe prompt line (bounded token size) */
  promptSafe: string;
  /** Generated at timestamp */
  generatedAt: number;
}

// ─── Factory ───────────────────────────────────────────

export function createRelationshipState(): RelationshipState {
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

// ─── Config ────────────────────────────────────────────

export interface RelationshipConfig {
  /** Decay rate per hour of absence (0–1) */
  decayRatePerHour: number;
  /** Max recent memories to retain */
  maxRecentMemories: number;
  /** Familiarity threshold for interaction style upgrades */
  friendlyThreshold: number;
  closeThreshold: number;
  familialThreshold: number;
  /** Trust change damping (lower = slower change) */
  trustDamping: number;
  /** Affinity change damping */
  affinityDamping: number;
  /** Max trust/familiarity cap */
  maxLevel: number;
}

const DEFAULT_RELATIONSHIP_CONFIG: RelationshipConfig = {
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
  private state: RelationshipState;
  private config: RelationshipConfig;

  constructor(state?: RelationshipState, config?: Partial<RelationshipConfig>) {
    this.state = state ?? createRelationshipState();
    this.config = { ...DEFAULT_RELATIONSHIP_CONFIG, ...config };
    this.updateInteractionStyle();
  }

  // ─── State Access ──────────────────────────────────

  getState(): Readonly<RelationshipState> {
    return this.state;
  }

  /** Generate a lightweight snapshot safe for LLM context injection. */
  getSnapshot(): RelationshipSnapshot {
    const { familiarityLevel, trustLevel, teamworkScore, emotionalAffinity, interactionStyle } = this.state;

    let summary: string;
    if (familiarityLevel < 20) {
      summary = "刚认识的玩家，还在熟悉中。";
    } else if (familiarityLevel < 45) {
      summary = "已经一起玩过一段时间了，配合越来越好。";
    } else if (familiarityLevel < 70) {
      summary = "配合默契的队友，互相信任。";
    } else {
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

  increaseTrust(amount: number, reason: string): void {
    const damped = amount * this.config.trustDamping;
    this.state.trustLevel = Math.min(this.config.maxLevel, this.state.trustLevel + damped);
    console.log(`[Relationship] Trust +${damped.toFixed(1)} (now ${this.state.trustLevel.toFixed(0)}) — ${reason}`);
  }

  decreaseTrust(amount: number, reason: string): void {
    const damped = amount * this.config.trustDamping;
    this.state.trustLevel = Math.max(0, this.state.trustLevel - damped);
    console.log(`[Relationship] Trust -${damped.toFixed(1)} (now ${this.state.trustLevel.toFixed(0)}) — ${reason}`);
  }

  // ─── Familiarity ────────────────────────────────────

  increaseFamiliarity(amount: number): void {
    this.state.familiarityLevel = Math.min(this.config.maxLevel, this.state.familiarityLevel + amount);
    this.updateInteractionStyle();
  }

  /** Apply decay based on time since last seen. */
  applyAbsenceDecay(absenceMs: number): void {
    const hours = absenceMs / 3600_000;
    const decay = hours * this.config.decayRatePerHour * 100;
    // Familiarity decays; trust decays less
    this.state.familiarityLevel = Math.max(0, this.state.familiarityLevel - decay * 0.5);
    this.state.trustLevel = Math.max(0, this.state.trustLevel - decay * 0.2);
    this.updateInteractionStyle();
  }

  // ─── Events ─────────────────────────────────────────

  registerVictory(type: string, playerInvolved: boolean): void {
    if (playerInvolved) {
      this.state.sharedVictories++;
      this.increaseFamiliarity(2);
      this.increaseTrust(3, `Shared victory: ${type}`);
    }
    this.state.teamworkScore = Math.min(this.config.maxLevel, this.state.teamworkScore + 1);
    this.trackActivity("combat");
  }

  registerFailure(type: string, playerInvolved: boolean): void {
    if (playerInvolved) {
      this.state.sharedDeaths++;
      this.increaseFamiliarity(1); // Shared failure still builds familiarity
      // Trust impact depends on context — slight decrease by default
      this.decreaseTrust(0.5, `Shared failure: ${type}`);
    }
    this.trackActivity("combat");
  }

  registerRescue(playerWasRescued: boolean): void {
    if (playerWasRescued) {
      this.state.rescueCount++;
      this.increaseTrust(8, "Companion rescued player");
      this.increaseFamiliarity(3);
      this.state.emotionalAffinity = Math.min(1.0, this.state.emotionalAffinity + 0.05);
    } else {
      this.increaseTrust(5, "Player rescued companion");
      this.increaseFamiliarity(2);
      this.state.emotionalAffinity = Math.min(1.0, this.state.emotionalAffinity + 0.03);
    }
    this.state.teamworkScore = Math.min(this.config.maxLevel, this.state.teamworkScore + 2);
    this.trackActivity("rescue");
  }

  registerSessionStart(): void {
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

  registerSessionEnd(sessionDurationMs: number): void {
    this.state.totalPlayTimeMs += sessionDurationMs;
    this.state.lastSeenAt = Date.now();
  }

  registerDiscovery(description: string): void {
    this.trackActivity("exploration");
    this.increaseFamiliarity(0.5);
    this.addRecentMemory(`发现了${description}`);
  }

  registerBuild(description: string): void {
    this.trackActivity("building");
    this.increaseFamiliarity(0.5);
    this.addRecentMemory(`一起建造了${description}`);
  }

  // ─── Activities ─────────────────────────────────────

  trackActivity(activity: string): void {
    this.state.activitiesCount[activity] = (this.state.activitiesCount[activity] || 0) + 1;

    // Update favorite activities ranking
    const sorted = Object.entries(this.state.activitiesCount)
      .map(([a, c]) => ({ activity: a, count: c }))
      .sort((a, b) => b.count - a.count);
    this.state.favoriteActivities = sorted.slice(0, 8);
  }

  // ─── Memories ───────────────────────────────────────

  addRecentMemory(summary: string): void {
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
  getWarmthFactor(): number {
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
  getInitiativeConfidence(): number {
    const warmth = this.getWarmthFactor();
    const teamworkNorm = this.state.teamworkScore / 100;
    return Math.min(0.95, warmth * 0.6 + teamworkNorm * 0.4);
  }

  // ─── Internal ───────────────────────────────────────

  private updateInteractionStyle(): void {
    const f = this.state.familiarityLevel;
    if (f >= this.config.familialThreshold) {
      this.state.interactionStyle = "familial";
    } else if (f >= this.config.closeThreshold) {
      this.state.interactionStyle = "close";
    } else if (f >= this.config.friendlyThreshold) {
      this.state.interactionStyle = "friendly";
    } else {
      this.state.interactionStyle = "formal";
    }
  }

  /** Replace state entirely (for loading from persistence). */
  setState(state: RelationshipState): void {
    this.state = state;
    this.updateInteractionStyle();
  }
}
