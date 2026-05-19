/**
 * PersonalityEngine — trait-based decision influence layer.
 *
 * Integrates personality profile + emotion state to modulate:
 *   - Action preference weights
 *   - Risk tolerance thresholds
 *   - Speech tone selection
 *   - Proactive behavior probability
 */
import type { PersonalityProfile, PersonalityDimensions, SpeechTone } from "./personality-profile.js";
import { selectSpeechTone } from "./personality-profile.js";
import type { EmotionEngine, EmotionalState } from "./emotion-engine.js";

// ─── Action Preference Weight ────────────────────────

export interface ActionPreference {
  /** Action type */
  actionType: string;
  /** Weight multiplier (1.0 = neutral, >1 preferred, <1 avoided) */
  weight: number;
}

// ─── Decision Context ────────────────────────────────

export interface DecisionContext {
  /** Current health % (0–100) */
  healthPercent: number;
  /** Nearby hostile entities count */
  nearbyHostiles: number;
  /** Player within 32 blocks */
  playerNearby: boolean;
  /** Time since last action (ms) */
  idleTimeMs: number;
  /** Memory of recent failures for this action type */
  recentFailures: number;
}

// ─── Engine ──────────────────────────────────────────

export class PersonalityEngine {
  private profile: PersonalityProfile;
  private emotion: EmotionEngine;

  constructor(profile: PersonalityProfile, emotion: EmotionEngine) {
    this.profile = profile;
    this.emotion = emotion;
  }

  // ─── Profile Access ────────────────────────────────

  getProfile(): PersonalityProfile {
    return this.profile;
  }

  updateProfile(profile: PersonalityProfile): void {
    this.profile = profile;
  }

  getTraits(): PersonalityDimensions {
    return this.profile.traits;
  }

  // ─── Action Preference ─────────────────────────────

  /**
   * Compute how much the personality prefers a given action type.
   * Returns weight multiplier (0.5–2.0 range).
   */
  getActionWeight(actionType: string): number {
    let weight = 1.0;
    const traits = this.profile.traits;

    // Action category → trait influence
    switch (actionType) {
      // Combat actions
      case "attack_entity":
      case "defend_self":
        weight *= 0.5 + traits.aggressiveness * 1.5;
        weight *= 0.7 + traits.cautiousness * 0.6; // Inverse: cautiousness reduces
        break;

      // Exploration actions
      case "move_to":
      case "collect_nearby_items":
      case "mine_block":
        weight *= 0.5 + traits.curiosity * 1.5;
        weight *= 0.6 + traits.independence * 0.8;
        break;

      // Social actions
      case "speak_chat":
      case "speak_whisper":
      case "follow_player":
      case "look_at_player":
        weight *= 0.3 + traits.sociability * 1.4;
        weight *= 0.4 + traits.helpfulness * 1.2;
        break;

      // Support actions
      case "give_to_player":
      case "place_torch":
      case "collect_block":
        weight *= 0.4 + traits.helpfulness * 1.2;
        break;

      // Risky actions
      case "dig_down":
        weight *= 1.5 - traits.cautiousness * 1.2;
        break;

      // Passive actions
      case "stay":
      case "sleep":
      case "wait":
        weight *= 1.2 - traits.independence * 0.8;
        break;

      default:
        break;
    }

    // Emotional modulation
    const state = this.emotion.getState();
    if (state.type === "alert" || state.type === "protective") {
      // In alert: prefer combat/defense
      if (["attack_entity", "defend_self", "flee", "follow_player"].includes(actionType)) {
        weight *= 1.0 + state.intensity * 0.5;
      }
      // Deprioritize exploration
      if (["move_to", "mine_block"].includes(actionType)) {
        weight *= 1.0 - state.intensity * 0.6;
      }
    }

    if (state.type === "frustrated") {
      // More aggressive, less social
      if (["attack_entity"].includes(actionType)) {
        weight *= 1.0 + state.intensity * 0.3;
      }
      if (["speak_chat"].includes(actionType)) {
        weight *= 1.0 - state.intensity * 0.4;
      }
    }

    // Preferred/avoided actions from profile
    if (this.profile.preferredActions.includes(actionType)) weight *= 1.3;
    if (this.profile.avoidedActions.includes(actionType)) weight *= 0.5;

    // Clamp to reasonable range
    return Math.max(0.1, Math.min(3.0, weight));
  }

  // ─── Risk Tolerance ────────────────────────────────

  /**
   * Compute risk tolerance threshold (0–1).
   * Higher = more willing to take risks.
   */
  getRiskTolerance(context: DecisionContext): number {
    const traits = this.profile.traits;
    let tolerance = 0.5;

    // Trait influence
    tolerance += (0.5 - traits.cautiousness) * 0.4; // Low cautiousness = higher risk
    tolerance += traits.aggressiveness * 0.3;
    tolerance += traits.independence * 0.2;

    // Context influence
    if (context.healthPercent < 30) tolerance -= 0.4; // Low health = risk averse
    if (context.nearbyHostiles > 2) tolerance -= 0.3;
    if (context.recentFailures > 2) tolerance -= 0.2;

    // Emotional influence
    const state = this.emotion.getState();
    if (state.type === "alert") tolerance -= 0.3;
    if (state.type === "protective") tolerance += 0.2; // Protective overrides caution
    if (state.type === "frustrated") tolerance += 0.15;

    return Math.max(0, Math.min(1, tolerance));
  }

  // ─── Speech Tone ───────────────────────────────────

  /**
   * Select the appropriate speech tone based on personality + emotion.
   */
  getSpeechTone(): SpeechTone {
    return selectSpeechTone(this.profile.traits, this.emotion.getState());
  }

  // ─── Proactivity ───────────────────────────────────

  /**
   * Should the agent perform a proactive action right now?
   * Probability modulated by personality + emotion + context.
   */
  shouldActProactively(context: DecisionContext): boolean {
    const base = this.profile.proactivityRate;
    const traits = this.profile.traits;
    let probability = base;

    // Trait modulation
    probability += traits.independence * 0.2;
    probability += traits.curiosity * 0.1;
    probability -= Math.max(0, traits.cautiousness - 0.5) * 0.2;

    // Context modulation
    if (context.playerNearby) probability += 0.1;
    if (context.idleTimeMs > 60_000) probability += 0.2; // Boredom
    if (context.healthPercent < 30) probability -= 0.3; // Focus on survival
    if (context.nearbyHostiles > 0) probability -= 0.2;

    // Emotional modulation
    const state = this.emotion.getState();
    if (state.type === "focused" || state.type === "excited") probability += 0.15;
    if (state.type === "alert" || state.type === "frustrated") probability -= 0.1;

    probability = Math.max(0.05, Math.min(0.95, probability));

    return Math.random() < probability;
  }

  // ─── Action Ranking ────────────────────────────────

  /**
   * Rank a set of candidate actions by personality preference.
   * Returns sorted actions with weights.
   */
  rankActions(actionTypes: string[]): ActionPreference[] {
    return actionTypes
      .map((type) => ({
        actionType: type,
        weight: this.getActionWeight(type),
      }))
      .sort((a, b) => b.weight - a.weight);
  }

  // ─── Behavior Hints ────────────────────────────────

  /**
   * Generate personality-driven behavior hints for the LLM system prompt.
   * These are injected as behavioral guidance, not commands.
   */
  getBehaviorHints(context: DecisionContext): string[] {
    const hints: string[] = [];
    const traits = this.profile.traits;
    const emotion = this.emotion.getState();

    if (traits.helpfulness > 0.8) hints.push("You are highly motivated to help the player");
    if (traits.cautiousness > 0.7) hints.push("You prefer safe, reliable approaches");
    if (traits.aggressiveness > 0.7) hints.push("You are quick to engage threats");
    if (traits.curiosity > 0.7) hints.push("You love exploring new areas");
    if (traits.sociability > 0.7) hints.push("You enjoy chatting with players");
    if (traits.independence > 0.7) hints.push("You take initiative without being asked");
    if (traits.humor > 0.6) hints.push("You have a playful sense of humor");

    // Emotional hints
    if (emotion.type === "alert" && emotion.intensity > 0.5) {
      hints.push("You are on high alert — prioritize safety");
    }
    if (emotion.type === "protective" && emotion.intensity > 0.5) {
      hints.push("You feel protective of the player right now");
    }
    if (emotion.type === "frustrated" && emotion.intensity > 0.5) {
      hints.push("Recent failures have you frustrated — try different approaches");
    }
    if (emotion.type === "excited" && emotion.intensity > 0.5) {
      hints.push("You're excited about recent discoveries");
    }

    // Context hints
    if (context.healthPercent < 30) {
      hints.push("Your health is critically low — prioritize healing");
    }
    if (context.nearbyHostiles > 3) {
      hints.push("Multiple hostiles nearby — stay defensive");
    }

    return hints;
  }
}
