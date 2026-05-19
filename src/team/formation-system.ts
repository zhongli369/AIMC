/**
 * FormationSystem — dynamic squad positioning (Phase 4-F).
 *
 * Manages companion positioning relative to player.
 * ADVISORY ONLY — all movement still flows through SkillRouter.
 *
 * Formation modes: follow_close, follow_loose, flank_left, flank_right,
 *                  rear_guard, scout_ahead
 *
 * MUST NOT:
 *   - Execute movement directly
 *   - Bypass SkillRouter
 *   - Access bot.*() directly
 */

import type { TeamState, TeamMode } from "./team-state.js";
import type { PlayerIntentType } from "./intent-prediction.js";

// ─── Formation Types ────────────────────────────────────

export type FormationMode =
  | "follow_close"    // Within 2–3 blocks, tight escort
  | "follow_loose"    // Within 5–8 blocks, relaxed following
  | "flank_left"      // 4–6 blocks to player's left
  | "flank_right"     // 4–6 blocks to player's right
  | "rear_guard"      // 3–5 blocks behind, watching back
  | "scout_ahead";    // 10–20 blocks ahead, checking path

export interface FormationPosition {
  /** Desired offset from player */
  offsetX: number;
  offsetZ: number;
  /** Desired distance from player */
  distance: number;
  /** Whether position is relative to player facing direction */
  relativeToFacing: boolean;
  /** Tolerance before repositioning */
  toleranceRadius: number;
}

export interface FormationConfig {
  /** Default formation when no specific context */
  defaultFormation: FormationMode;
  /** Min distance before "too close" trigger */
  minDistance: number;
  /** Max distance before "too far" trigger */
  maxDistance: number;
  /** How often to re-evaluate formation (ms) */
  evaluationIntervalMs: number;
  /** Whether to avoid blocking player's line of sight */
  avoidBlockingLoS: boolean;
}

const DEFAULT_FORMATION_CONFIG: FormationConfig = {
  defaultFormation: "follow_loose",
  minDistance: 1.5,
  maxDistance: 32,
  evaluationIntervalMs: 2000,
  avoidBlockingLoS: true,
};

// ─── Formation Positions ────────────────────────────────

const FORMATION_POSITIONS: Record<FormationMode, Omit<FormationPosition, "distance">> = {
  follow_close: {
    offsetX: 0,
    offsetZ: -2,
    relativeToFacing: true,
    toleranceRadius: 1.0,
  },
  follow_loose: {
    offsetX: 0,
    offsetZ: -5,
    relativeToFacing: true,
    toleranceRadius: 2.0,
  },
  flank_left: {
    offsetX: -4,
    offsetZ: 2,
    relativeToFacing: true,
    toleranceRadius: 1.5,
  },
  flank_right: {
    offsetX: 4,
    offsetZ: 2,
    relativeToFacing: true,
    toleranceRadius: 1.5,
  },
  rear_guard: {
    offsetX: 0,
    offsetZ: 4,
    relativeToFacing: true,
    toleranceRadius: 1.5,
  },
  scout_ahead: {
    offsetX: 0,
    offsetZ: -12,
    relativeToFacing: true,
    toleranceRadius: 3.0,
  },
};

// ─── System ──────────────────────────────────────────────

export class FormationSystem {
  private currentFormation: FormationMode;
  private config: FormationConfig;
  private lastEvaluation = 0;
  private formationHistory: { mode: FormationMode; timestamp: number; reason: string }[] = [];

  constructor(config?: Partial<FormationConfig>) {
    this.config = { ...DEFAULT_FORMATION_CONFIG, ...config };
    this.currentFormation = this.config.defaultFormation;
  }

  // ─── Formation Mode ────────────────────────────────

  getCurrentFormation(): FormationMode {
    return this.currentFormation;
  }

  /**
   * Update formation mode based on context.
   * Returns the new formation and whether it changed.
   */
  updateFormationMode(params: {
    teamMode: TeamMode;
    predictedIntent: PlayerIntentType;
    hostilesNearby: boolean;
    isUnderground: boolean;
    playerHealth: number;
    familiarityLevel: number;
  }): { formation: FormationMode; changed: boolean } {
    const previous = this.currentFormation;
    let newFormation: FormationMode = this.currentFormation;

    // Priority-ordered formation selection
    if (params.teamMode === "combat" || params.hostilesNearby) {
      // Combat: flank formation for tactical coverage
      newFormation = Math.random() < 0.5 ? "flank_left" : "flank_right";
    } else if (params.teamMode === "retreat") {
      // Retreat: rear guard to cover withdrawal
      newFormation = "rear_guard";
    } else if (params.predictedIntent === "mining") {
      // Mining: close follow for guarding
      newFormation = params.isUnderground ? "follow_close" : "flank_left";
    } else if (params.predictedIntent === "exploration") {
      // Exploration: scout ahead or loose follow
      newFormation = params.familiarityLevel > 50 ? "scout_ahead" : "follow_loose";
    } else if (params.predictedIntent === "building") {
      // Building: loose follow, stay out of the way
      newFormation = "follow_loose";
    } else if (params.predictedIntent === "travel") {
      // Travel: flank for wider view
      newFormation = "flank_right";
    } else if (params.playerHealth < 8) {
      // Player vulnerable: close follow, protective
      newFormation = "follow_close";
    }

    const changed = newFormation !== previous;
    if (changed) {
      this.currentFormation = newFormation;
      this.formationHistory.push({
        mode: newFormation,
        timestamp: Date.now(),
        reason: `Context: ${params.teamMode}/${params.predictedIntent}`,
      });
      // Keep history bounded
      if (this.formationHistory.length > 50) {
        this.formationHistory = this.formationHistory.slice(-30);
      }
    }

    this.lastEvaluation = Date.now();
    return { formation: newFormation, changed };
  }

  /**
   * Get the desired position offset given current formation.
   * Returns the ideal offset from the player.
   */
  getDesiredFormationPosition(formation?: FormationMode): FormationPosition {
    const mode = formation ?? this.currentFormation;
    const base = FORMATION_POSITIONS[mode];
    const distance = Math.sqrt(base.offsetX ** 2 + base.offsetZ ** 2);
    return { ...base, distance };
  }

  /**
   * Determine if the companion should regroup (move closer to player).
   */
  shouldRegroup(params: {
    currentDistanceToPlayer: number;
    formation: FormationMode;
    isInDanger: boolean;
  }): boolean {
    // Always regroup if in danger and far
    if (params.isInDanger && params.currentDistanceToPlayer > 16) {
      return true;
    }

    // Regroup if exceeded max distance
    if (params.currentDistanceToPlayer > this.config.maxDistance) {
      return true;
    }

    // Check formation-specific distance
    const pos = FORMATION_POSITIONS[params.formation];
    const desiredDist = Math.sqrt(pos.offsetX ** 2 + pos.offsetZ ** 2);
    const threshold = desiredDist + pos.toleranceRadius + 5;

    return params.currentDistanceToPlayer > threshold;
  }

  /**
   * Check if companion is too close to player (blocking).
   */
  isTooClose(currentDistanceToPlayer: number): boolean {
    return currentDistanceToPlayer < this.config.minDistance;
  }

  /**
   * Whether the companion should adjust position to avoid blocking.
   */
  shouldAvoidBlocking(params: {
    distanceToPlayer: number;
    playerFacingDirection?: { dx: number; dz: number };
    botRelativeAngle?: number; // 0 = in front, π = behind
  }): boolean {
    if (!this.config.avoidBlockingLoS) return false;

    // If very close and roughly in front of player → blocking
    return params.distanceToPlayer < 3
      && params.botRelativeAngle !== undefined
      && Math.abs(params.botRelativeAngle) < Math.PI / 3; // ±60°
  }

  /** Get formation change history. */
  getFormationHistory(): ReadonlyArray<{ mode: FormationMode; timestamp: number; reason: string }> {
    return this.formationHistory;
  }

  /** Reset formation to default. */
  reset(): void {
    this.currentFormation = this.config.defaultFormation;
  }
}
