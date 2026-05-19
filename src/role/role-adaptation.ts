/**
 * RoleAdaptationEngine — long-term behavior pattern analysis.
 *
 * Observes skill execution patterns over time and slowly adjusts
 * companion role identity. Prevents rapid role switching.
 *
 * This is ANALYSIS ONLY. It does NOT:
 *   - Execute actions
 *   - Call bot.*() directly
 *   - Create new execution paths
 *   - Bypass SkillRouter
 *
 * Output: role switch recommendations consumed by AgentCore → SkillRouter.
 */

import type { CompanionRole, CompanionIdentity, BehaviorTrait } from "./role-identity.js";
import { ALL_ROLES, ROLE_PROFILES, createIdentity } from "./role-identity.js";

// ─── Config ──────────────────────────────────────────

export interface AdaptationConfig {
  /** Minimum ms between role switches */
  minSwitchIntervalMs: number;
  /** Confidence must exceed current by this margin to switch */
  switchThreshold: number;
  /** EMA smoothing factor for confidence updates (0–1, lower = slower) */
  confidenceSmoothing: number;
  /** Max confidence cap */
  maxConfidence: number;
  /** Observation threshold before trait is considered "dominant" */
  traitThreshold: number;
  /** Max observation window (older observations decay) */
  observationWindowMs: number;
}

const DEFAULT_ADAPTATION_CONFIG: AdaptationConfig = {
  minSwitchIntervalMs: 300_000,  // 5 minutes
  switchThreshold: 0.15,
  confidenceSmoothing: 0.1,      // Very slow adaptation
  maxConfidence: 0.95,
  traitThreshold: 5,
  observationWindowMs: 600_000,  // 10 minutes
};

// ─── Trait Mapping ───────────────────────────────────

const TRAIT_SKILL_MAP: Record<string, string[]> = {
  mining_heavy: ["mine_resource", "collect_items"],
  combat_frequent: ["attack_target", "defend_player"],
  exploration_heavy: ["explore_area"],
  support_oriented: ["follow_player", "defend_player", "gather_food"],
};

// ─── Engine ──────────────────────────────────────────

export class RoleAdaptationEngine {
  private identity: CompanionIdentity;
  private config: AdaptationConfig;
  /** Per-skill observation counts with timestamps */
  private skillObservations: Map<string, { count: number; lastSeen: number }> = new Map();
  /** Implicit confidence scores for each role (derived from observations) */
  private implicitConfidence: Map<CompanionRole, number> = new Map();

  constructor(identity?: CompanionIdentity, config?: Partial<AdaptationConfig>) {
    this.identity = identity ?? createIdentity();
    this.config = { ...DEFAULT_ADAPTATION_CONFIG, ...config };

    // Initialize implicit confidence from current identity
    for (const role of ALL_ROLES) {
      this.implicitConfidence.set(role, role === this.identity.currentRole ? this.identity.confidence : 0.1);
    }
  }

  // ─── Observation ──────────────────────────────────

  /**
   * Record a skill execution observation.
   * Call after each skill execution completes (success or failure).
   */
  observe(skillName: string, success: boolean): void {
    const existing = this.skillObservations.get(skillName);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
    } else {
      this.skillObservations.set(skillName, { count: 1, lastSeen: Date.now() });
    }

    // Update dominant traits
    this.updateTraits();

    // Update implicit confidence for each role
    this.updateImplicitConfidence();

    // Update identity timestamp
    this.identity.updatedAt = Date.now();
  }

  // ─── Evaluation ───────────────────────────────────

  /**
   * Evaluate whether role should change based on accumulated evidence.
   * Returns recommendation — caller decides whether to apply.
   */
  evaluate(): {
    shouldSwitch: boolean;
    recommendedRole: CompanionRole;
    confidence: number;
    currentConfidence: number;
    reason: string;
  } {
    // Find role with highest implicit confidence
    let bestRole: CompanionRole = this.identity.currentRole;
    let bestConfidence = this.identity.confidence;

    for (const role of ALL_ROLES) {
      const c = this.implicitConfidence.get(role) ?? 0;
      if (c > bestConfidence) {
        bestConfidence = c;
        bestRole = role;
      }
    }

    const timeSinceLastSwitch = Date.now() - this.identity.roleHistory[this.identity.roleHistory.length - 1]?.timestamp;
    const canSwitch = timeSinceLastSwitch >= this.config.minSwitchIntervalMs;
    const confidenceGap = bestConfidence - this.identity.confidence;

    if (bestRole !== this.identity.currentRole && confidenceGap >= this.config.switchThreshold && canSwitch) {
      return {
        shouldSwitch: true,
        recommendedRole: bestRole,
        confidence: bestConfidence,
        currentConfidence: this.identity.confidence,
        reason: `Behavior patterns match "${bestRole}" role (confidence gap: ${(confidenceGap * 100).toFixed(0)}%)`,
      };
    }

    return {
      shouldSwitch: false,
      recommendedRole: this.identity.currentRole,
      confidence: this.identity.confidence,
      currentConfidence: this.identity.confidence,
      reason: bestRole !== this.identity.currentRole
        ? `Role "${bestRole}" leads by ${(confidenceGap * 100).toFixed(0)}% but below threshold or too soon`
        : "Current role matches observed behavior",
    };
  }

  // ─── Role Switch ──────────────────────────────────

  /**
   * Apply a role switch. Updates identity history and resets transient state.
   */
  switchRole(role: CompanionRole, reason: string): void {
    const profile = ROLE_PROFILES[role];
    this.identity.currentRole = role;
    this.identity.confidence = 0.35; // Reset confidence — need to re-prove
    this.identity.roleHistory.push({
      role,
      confidence: 0.35,
      reason,
      timestamp: Date.now(),
    });
    this.identity.updatedAt = Date.now();

    // Reset implicit confidence for new role
    for (const r of ALL_ROLES) {
      this.implicitConfidence.set(r, r === role ? 0.35 : 0.1);
    }

    console.log(`[RoleAdaptation] Switched to "${profile.label}" — ${reason}`);
  }

  // ─── Identity Access ──────────────────────────────

  getIdentity(): Readonly<CompanionIdentity> {
    return this.identity;
  }

  /** Replace identity entirely (e.g., after loading from disk). */
  setIdentity(identity: CompanionIdentity): void {
    this.identity = identity;
    for (const role of ALL_ROLES) {
      this.implicitConfidence.set(role, role === identity.currentRole ? identity.confidence : 0.1);
    }
  }

  // ─── Skill Weights ────────────────────────────────

  /**
   * Get role-influenced skill weights.
   * Merges role profile weights with adaptation-derived biases.
   */
  getSkillWeights(): Record<string, number> {
    const profile = ROLE_PROFILES[this.identity.currentRole];
    const weights: Record<string, number> = { ...profile.skillWeights };

    // Slight boost for frequently-used skills (adaptation reinforcement)
    for (const [skill, obs] of this.skillObservations) {
      if (obs.count >= this.config.traitThreshold) {
        weights[skill] = (weights[skill] ?? 1.0) * 1.1;
      }
    }

    // Slight penalty for avoided skills
    for (const avoided of profile.avoidedSkills) {
      weights[avoided] = (weights[avoided] ?? 1.0) * 0.8;
    }

    return weights;
  }

  // ─── Internal: Trait Updates ──────────────────────

  private updateTraits(): void {
    const now = Date.now();
    const traits: Map<string, { count: number; lastSeen: number }> = new Map();

    // Aggregate observations into traits
    for (const [skill, obs] of this.skillObservations) {
      if (now - obs.lastSeen > this.config.observationWindowMs) continue;

      for (const [trait, skills] of Object.entries(TRAIT_SKILL_MAP)) {
        if (skills.includes(skill)) {
          const existing = traits.get(trait);
          if (existing) {
            existing.count += obs.count;
            existing.lastSeen = Math.max(existing.lastSeen, obs.lastSeen);
          } else {
            traits.set(trait, { count: obs.count, lastSeen: obs.lastSeen });
          }
        }
      }
    }

    // Convert to BehaviorTrait[]
    const dominantTraits: BehaviorTrait[] = [];
    for (const [trait, data] of traits) {
      if (data.count >= this.config.traitThreshold) {
        dominantTraits.push({
          trait,
          observationCount: data.count,
          lastObservedAt: data.lastSeen,
        });
      }
    }

    dominantTraits.sort((a, b) => b.observationCount - a.observationCount);
    this.identity.dominantTraits = dominantTraits.slice(0, 4); // Top 4
  }

  // ─── Internal: Implicit Confidence ────────────────

  private updateImplicitConfidence(): void {
    const now = Date.now();

    for (const role of ALL_ROLES) {
      const profile = ROLE_PROFILES[role];
      let matchScore = 0;
      let totalWeight = 0;

      // Compare observed skills against role's preferred/avoided skills
      for (const [skill, obs] of this.skillObservations) {
        if (now - obs.lastSeen > this.config.observationWindowMs) continue;
        const weight = Math.log(obs.count + 1); // Diminishing returns on high counts
        totalWeight += weight;

        if (profile.preferredSkills.includes(skill)) {
          matchScore += weight * 1.5; // Strong positive signal
        } else if (profile.avoidedSkills.includes(skill)) {
          matchScore -= weight * 1.0; // Negative signal
        } else {
          matchScore += weight * 0.5; // Neutral — weak positive
        }
      }

      // Normalize to 0–1 range
      const rawConfidence = totalWeight > 0
        ? 0.5 + (matchScore / totalWeight) * 0.5
        : 0.1;

      const clamped = Math.max(0.05, Math.min(this.config.maxConfidence, rawConfidence));

      // EMA smoothing
      const current = this.implicitConfidence.get(role) ?? 0.1;
      const smoothed = current + this.config.confidenceSmoothing * (clamped - current);
      this.implicitConfidence.set(role, smoothed);
    }

    // Slowly update identity confidence toward implicit confidence of current role
    const currentImplicit = this.implicitConfidence.get(this.identity.currentRole) ?? 0.1;
    this.identity.confidence = this.identity.confidence
      + this.config.confidenceSmoothing * (currentImplicit - this.identity.confidence);
  }
}
