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
import type { CompanionRole } from "../role/role-identity.js";
import { ROLE_PROFILES } from "../role/role-identity.js";

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

  // ─── Skill Selection Bias ──────────────────────────

  /**
   * Compute personality preference weight for a given skill.
   * Maps skill categories to personality dimensions.
   */
  getSkillWeight(skillName: string): number {
    let weight = 1.0;
    const traits = this.profile.traits;

    const combatSkills = ["attack_target", "defend_player"];
    const gatheringSkills = ["mine_resource", "gather_food", "collect_items"];
    const explorationSkills = ["explore_area"];
    const socialSkills = ["follow_player"];
    const buildingSkills = ["build_shelter"];

    if (combatSkills.includes(skillName)) {
      weight *= 0.5 + traits.aggressiveness * 1.5;
      weight *= 0.7 + traits.cautiousness * 0.6; // inverse
    }
    if (gatheringSkills.includes(skillName)) {
      weight *= 0.5 + traits.curiosity * 1.0;
      weight *= 0.6 + traits.independence * 0.8;
    }
    if (explorationSkills.includes(skillName)) {
      weight *= 0.5 + traits.curiosity * 1.5;
      weight *= 0.4 + traits.independence * 1.2;
    }
    if (socialSkills.includes(skillName)) {
      weight *= 0.3 + traits.sociability * 1.4;
      weight *= 0.4 + traits.helpfulness * 1.2;
    }
    if (buildingSkills.includes(skillName)) {
      weight *= 0.4 + traits.helpfulness * 1.2;
      weight *= 1.2 - traits.aggressiveness * 0.5;
    }

    // Emotional modulation
    const state = this.emotion.getState();
    if (state.type === "alert" || state.type === "protective") {
      if (combatSkills.includes(skillName)) weight *= 1.0 + state.intensity * 0.5;
      if (explorationSkills.includes(skillName)) weight *= 1.0 - state.intensity * 0.5;
    }
    if (state.type === "frustrated") {
      if (combatSkills.includes(skillName)) weight *= 1.0 + state.intensity * 0.3;
    }

    return Math.max(0.1, Math.min(3.0, weight));
  }

  /**
   * Rank skills by personality preference.
   * Returns sorted skill names with weights.
   */
  rankSkills(skillNames: string[]): Array<{ skillName: string; weight: number }> {
    return skillNames
      .map((name) => ({ skillName: name, weight: this.getSkillWeight(name) }))
      .sort((a, b) => b.weight - a.weight);
  }

  // ─── Phase 4-A: Voice Tone Modulation ───────────────

  /**
   * Voice tone for TTS output based on bot activity state.
   *
   * Maps state → speech tone. Affects ONLY voice output, NOT decisions.
   * Decision-making continues to use getBehaviorHints() and trait-based weights.
   *
   * Tone categories:
   *   focused  — mining, building, crafting (concentrated attention)
   *   alert    — combat, hostiles nearby (urgent, concise)
   *   calm     — idle, following player, observing
   *   cautious — fallback activated, low health, recent failures
   *   curious  — exploring new area, finding resources
   *   friendly  — chatting, social interaction
   */
  getVoiceTone(activityContext: {
    currentSkill?: string;
    skillFailed?: boolean;
    fallbackActive?: boolean;
    healthLow?: boolean;
    hostilesNearby?: boolean;
    isExploring?: boolean;
    isChatting?: boolean;
    isIdle?: boolean;
  }): "focused" | "alert" | "calm" | "cautious" | "curious" | "friendly" {
    // Priority-ordered tone selection

    // 1. Combat / danger → alert (highest priority)
    if (activityContext.hostilesNearby || activityContext.healthLow) {
      return this.profile.traits.aggressiveness > 0.7 ? "alert" : "cautious";
    }

    // 2. Fallback / failure → cautious
    if (activityContext.fallbackActive || activityContext.skillFailed) {
      return "cautious";
    }

    // 3. Active skill execution → focused
    if (activityContext.currentSkill) {
      const combatSkills = ["attack_target", "defend_player"];
      const exploreSkills = ["explore_area"];
      if (combatSkills.includes(activityContext.currentSkill)) return "alert";
      if (exploreSkills.includes(activityContext.currentSkill)) return "curious";
      return "focused";
    }

    // 4. Chatting → friendly
    if (activityContext.isChatting) {
      return "friendly";
    }

    // 5. Exploring → curious
    if (activityContext.isExploring) {
      return "curious";
    }

    // 6. Idle → calm (or curious if high curiosity trait)
    if (activityContext.isIdle) {
      return this.profile.traits.curiosity > 0.6 ? "curious" : "calm";
    }

    // Default: personality-driven
    if (this.profile.traits.sociability > 0.7) return "friendly";
    if (this.profile.traits.aggressiveness > 0.6) return "alert";
    return "calm";
  }

  /**
   * Get SSML prosody hints for Edge TTS based on voice tone.
   * Returns rate and pitch modifiers that match the emotional tone.
   *
   * Output ONLY — does not affect decision-making.
   */
  getVoiceProsody(tone: ReturnType<typeof this.getVoiceTone>): {
    rate: number;
    pitch: string;
  } {
    switch (tone) {
      case "alert":
        return { rate: 15, pitch: "+2Hz" };       // Slightly faster, higher pitch
      case "focused":
        return { rate: -5, pitch: "+0Hz" };        // Steady, neutral
      case "cautious":
        return { rate: -15, pitch: "-2Hz" };       // Slower, lower pitch
      case "curious":
        return { rate: 5, pitch: "+1Hz" };         // Slightly upbeat
      case "friendly":
        return { rate: 0, pitch: "+0Hz" };         // Natural
      case "calm":
      default:
        return { rate: -10, pitch: "-1Hz" };       // Relaxed
    }
  }

  // ─── Phase 4-D: Role-Influenced Narration ────────────

  /**
   * Get role-based voice profile for narration style (Phase 4-D).
   *
   * Maps companion role → voice characteristics.
   * Affects NARRATION ONLY — not decision-making, not execution.
   *
   * Role mappings:
   *   fighter  → direct, decisive, faster pacing
   *   miner    → practical, task-focused, neutral pacing
   *   scout    → curious, observant, slightly faster pacing
   *   support  → calm, reassuring, slightly slower pacing
   *   balanced → versatile, adaptable, neutral pacing
   */
  getRoleVoiceProfile(role: CompanionRole): {
    voiceStyle: "direct" | "calm" | "curious" | "practical" | "versatile";
    confidenceStyle: "decisive" | "reassuring" | "observant" | "task-focused" | "adaptable";
    narrationPacing: number;
    label: string;
  } {
    const profile = ROLE_PROFILES[role];
    return {
      voiceStyle: profile.voiceStyle,
      confidenceStyle: profile.confidenceStyle,
      narrationPacing: profile.narrationPacing,
      label: profile.label,
    };
  }

  /**
   * Adjust voice tone selection based on companion role (Phase 4-D).
   *
   * Role acts as an overlay on the base personality+emotion tone:
   *   - fighter overrides cautious/calm → alert (if danger) or focused
   *   - support always prefers calm/reassuring unless combat
   *   - scout prefers curious unless danger
   *   - miner prefers focused/practical
   *   - balanced uses personality default (no override)
   */
  applyRoleToVoiceTone(
    baseTone: ReturnType<typeof this.getVoiceTone>,
    role: CompanionRole,
  ): "focused" | "alert" | "calm" | "cautious" | "curious" | "friendly" {
    const profile = ROLE_PROFILES[role];

    switch (profile.voiceStyle) {
      case "direct":
        // Fighter: prefer alert, never cautious unless health critical
        if (baseTone === "cautious") return "alert";
        if (baseTone === "calm" || baseTone === "friendly") return "focused";
        return baseTone === "curious" ? "alert" : baseTone;

      case "calm":
        // Support: prefer calm/reassuring, never alert unless forced
        if (baseTone === "alert") return "cautious";
        if (baseTone === "focused") return "calm";
        return baseTone;

      case "curious":
        // Scout: prefer curious/friendly unless combat
        if (baseTone === "alert") return "cautious";
        if (baseTone === "focused") return "curious";
        return baseTone;

      case "practical":
        // Miner: task-focused, neutral
        if (baseTone === "curious") return "focused";
        if (baseTone === "alert") return "cautious";
        return baseTone;

      case "versatile":
      default:
        // Balanced: no override
        return baseTone;
    }
  }

  // ─── Phase 4-E: Companion Interaction Evolution ──────

  /**
   * Get interaction warmth modifier based on relationship familiarity (Phase 4-E).
   *
   * Scales the companion's interaction style:
   *   Low familiarity (0–25)  → more formal, explanatory, respectful distance
   *   Medium (25–60)          → friendly, supportive, growing trust
   *   High (60–85)            → close, natural references, proactive support
   *   Very high (85–100)      → familial, shorthand communication, high initiative
   *
   * Returns modifiers for: formality, explanation level, initiative, phrasing style
   */
  getInteractionWarmth(familiarityLevel: number, trustLevel: number): {
    formality: number;       // 0–1, higher = more formal
    explanationLevel: number; // 0–1, higher = more explanatory
    initiativeComfort: number; // 0–1, higher = more proactive
    phrasingStyle: "respectful" | "friendly" | "casual" | "intimate";
    /** How much to reference shared history in speech */
    callbackFrequency: number; // 0–1
  } {
    const fam = familiarityLevel / 100;
    const trust = trustLevel / 100;

    return {
      formality: Math.max(0.05, 1.0 - fam * 0.9),
      explanationLevel: Math.max(0.1, 1.0 - fam * 0.85),
      initiativeComfort: Math.min(0.95, fam * 0.6 + trust * 0.4),
      phrasingStyle:
        familiarityLevel >= 85 ? "intimate"
        : familiarityLevel >= 55 ? "casual"
        : familiarityLevel >= 25 ? "friendly"
        : "respectful",
      callbackFrequency: Math.min(0.8, fam * 0.7 + trust * 0.3),
    };
  }

  /**
   * Generate familiarity-aware speech guidance (Phase 4-E).
   *
   * Returns short behavioral guidance strings for LLM context.
   * These affect TONE and PHRASING only — NOT decisions.
   */
  getFamiliarityHints(familiarityLevel: number, trustLevel: number): string[] {
    const hints: string[] = [];
    const warmth = this.getInteractionWarmth(familiarityLevel, trustLevel);

    switch (warmth.phrasingStyle) {
      case "respectful":
        hints.push("Speak with polite respect — you are still building rapport");
        hints.push("Explain your actions clearly, don't assume the player knows your habits");
        break;
      case "friendly":
        hints.push("Speak in a warm, friendly tone — you're becoming comfortable teammates");
        hints.push("Occasionally reference your growing familiarity with the player");
        break;
      case "casual":
        hints.push("Speak naturally and casually — you're close teammates now");
        hints.push("Reference shared past experiences naturally in conversation");
        hints.push("You can use shorter, more informal phrasing");
        break;
      case "intimate":
        hints.push("Speak like an old friend — shorthand and inside references are welcome");
        hints.push("Your bond is strong. Show genuine care and deep familiarity");
        hints.push("Proactive support should feel natural, not forced");
        break;
    }

    if (trustLevel >= 80) {
      hints.push("You trust this player completely — act with confident familiarity");
    } else if (trustLevel < 20) {
      hints.push("Trust is still building — be reliable but not presumptuous");
    }

    return hints;
  }

  /**
   * Compute trust-aware speech confidence (Phase 4-E).
   *
   * High trust → companion phrases suggestions more confidently.
   * Low trust → companion is more tentative, explains reasoning.
   */
  getTrustSpeechConfidence(trustLevel: number): number {
    return 0.3 + (trustLevel / 100) * 0.65; // 0.3 → 0.95
  }

  /**
   * Get companion tone drift based on long-term familiarity (Phase 4-E).
   *
   * Over long periods, the companion's base personality traits
   * slightly shift to reflect the relationship:
   *   - sociability increases with familiarity
   *   - cautiousness decreases with trust
   *   - helpfulness increases with affinity
   *
   * Returns MODIFIERS only — does not change stored profile.
   */
  getLongTermToneDrift(params: {
    familiarityLevel: number;
    trustLevel: number;
    emotionalAffinity: number;
  }): {
    sociabilityDrift: number;
    cautiousnessDrift: number;
    helpfulnessDrift: number;
    humorDrift: number;
  } {
    const fam = params.familiarityLevel / 100;
    const trust = params.trustLevel / 100;
    const affinity = (params.emotionalAffinity + 1) / 2; // -1..1 → 0..1

    return {
      sociabilityDrift: fam * 0.2 + affinity * 0.1,
      cautiousnessDrift: -(trust * 0.15), // Less cautious with trusted player
      helpfulnessDrift: fam * 0.15 + affinity * 0.1,
      humorDrift: fam * 0.25 + affinity * 0.15, // More humor with close friends
    };
  }

  // ─── Phase 4-F: Relationship-Aware Cooperation ────────

  /**
   * Get familiarity-based initiative confidence (Phase 4-F).
   *
   * Low trust: asks before major support actions, stays conservative.
   * High trust: proactively guards, auto-assists, tighter formation.
   *
   * Affects INITIATIVE CONFIDENCE ONLY — NOT execution permissions.
   */
  getCooperativeInitiative(params: {
    familiarityLevel: number;
    trustLevel: number;
    teamworkScore: number;
  }): {
    /** 0–1, how confidently the companion acts without being asked */
    initiativeConfidence: number;
    /** Whether companion should ask before major actions */
    askBeforeMajorAction: boolean;
    /** How likely companion is to auto-assist mining */
    autoAssistMining: boolean;
    /** How likely companion is to auto-guard */
    autoGuardEnabled: boolean;
    /** How tightly to maintain formation (0 = loose, 1 = tight) */
    formationTightness: number;
  } {
    const fam = params.familiarityLevel / 100;
    const trust = params.trustLevel / 100;
    const tw = params.teamworkScore / 100;

    const initiativeConfidence = fam * 0.4 + trust * 0.35 + tw * 0.25;

    return {
      initiativeConfidence: Math.min(0.95, initiativeConfidence),
      askBeforeMajorAction: params.trustLevel < 30 || params.familiarityLevel < 25,
      autoAssistMining: params.familiarityLevel >= 30 && params.trustLevel >= 25,
      autoGuardEnabled: params.familiarityLevel >= 20 || params.teamworkScore >= 40,
      formationTightness: Math.min(0.9, fam * 0.5 + trust * 0.3 + tw * 0.2),
    };
  }

  /**
   * Trust-aware proactive behavior hints (Phase 4-F).
   *
   * Returns behavioral guidance that adjusts how the companion
   * expresses support intentions. These affect SPEECH AND TONE ONLY.
   */
  getCooperativeHints(params: {
    familiarityLevel: number;
    trustLevel: number;
    teamworkScore: number;
  }): string[] {
    const hints: string[] = [];
    const coop = this.getCooperativeInitiative(params);

    if (coop.askBeforeMajorAction) {
      hints.push("Ask before initiating major support actions");
      hints.push("Be more tentative in suggestions — let the player lead");
    } else {
      hints.push("Feel free to proactively assist without asking");
    }

    if (coop.autoGuardEnabled) {
      hints.push("Automatically guard the player when they're occupied");
    }

    if (coop.autoAssistMining) {
      hints.push("Assist with mining naturally — you know their patterns");
    }

    if (params.teamworkScore >= 70) {
      hints.push("You two make a great team — your coordination is seamless");
    } else if (params.teamworkScore >= 40) {
      hints.push("Your teamwork is improving — coordinate actively");
    }

    if (params.familiarityLevel >= 60) {
      hints.push("You know this player well — anticipate their needs");
    }

    return hints;
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
