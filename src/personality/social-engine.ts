/**
 * SocialEngine — contextual dialogue, memory-aware conversation,
 * relationship continuity.
 *
 * AI remembers: player habits, repeated phrases, preferences, past experiences.
 */
import type { PersonalityProfile, SpeechTone } from "./personality-profile.js";
import type { EmotionEngine } from "./emotion-engine.js";
import type { MemoryRetriever, RetrievalResult } from "../memory/retriever.js";
import type { SQLiteMemoryStore } from "../memory/sqlite-store.js";

// ─── Relationship State ──────────────────────────────

export interface PlayerRelationship {
  playerName: string;
  /** How well the AI knows this player (0–100) */
  familiarity: number;
  /** Positive/negative sentiment (-1 to 1) */
  sentiment: number;
  /** Total interactions count */
  interactionCount: number;
  /** Last interaction timestamp */
  lastInteraction: number;
  /** Known player preferences */
  knownPreferences: string[];
  /** Topics the player has discussed */
  discussedTopics: string[];
  /** Player's play style (heuristic) */
  playStyle: "unknown" | "builder" | "explorer" | "fighter" | "social";
}

// ─── Dialogue Context ────────────────────────────────

export interface DialogueContext {
  playerName: string;
  message: string;
  relationship: PlayerRelationship;
  recentMemories: string[];
  currentEmotion: string;
  personalityTraits: string[];
}

export interface SocialResponse {
  /** Shaped response text */
  text: string;
  /** Suggested speech tone */
  tone: SpeechTone;
  /** Whether to proactively start conversation */
  initiateConversation: boolean;
  /** Suggested conversation topic */
  topicSuggestion?: string;
}

// ─── Config ──────────────────────────────────────────

interface SocialConfig {
  /** Min interval between proactive chat initiations (ms) */
  chatCooldownMs: number;
  /** Chance of greeting on first interaction */
  greetOnFirstInteraction: boolean;
  /** Max familiarity (caps at this value) */
  maxFamiliarity: number;
  /** Familiarity gained per interaction */
  familiarityPerInteraction: number;
}

const DEFAULT_CONFIG: SocialConfig = {
  chatCooldownMs: 30_000,
  greetOnFirstInteraction: true,
  maxFamiliarity: 100,
  familiarityPerInteraction: 2,
};

// ─── Engine ──────────────────────────────────────────

export class SocialEngine {
  private relationships: Map<string, PlayerRelationship> = new Map();
  private config: SocialConfig;
  private profile: PersonalityProfile;
  private emotion: EmotionEngine;
  private memoryStore: SQLiteMemoryStore | null = null;
  private memoryRetriever: MemoryRetriever | null = null;
  private lastChatInitiated = 0;
  private conversationTopics = new Set<string>([]);

  constructor(
    profile: PersonalityProfile,
    emotion: EmotionEngine,
    config?: Partial<SocialConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.profile = profile;
    this.emotion = emotion;
  }

  setMemoryBackend(store: SQLiteMemoryStore, retriever: MemoryRetriever): void {
    this.memoryStore = store;
    this.memoryRetriever = retriever;
  }

  // ─── Relationship Management ───────────────────────

  /** Get or create a relationship with a player. */
  getRelationship(playerName: string): PlayerRelationship {
    if (!this.relationships.has(playerName)) {
      this.relationships.set(playerName, {
        playerName,
        familiarity: 0,
        sentiment: 0,
        interactionCount: 0,
        lastInteraction: 0,
        knownPreferences: [],
        discussedTopics: [],
        playStyle: "unknown",
      });
    }
    return this.relationships.get(playerName)!;
  }

  /** Record an interaction with a player, updating relationship. */
  recordInteraction(playerName: string, message: string, isPlayerMessage: boolean): void {
    const rel = this.getRelationship(playerName);
    rel.interactionCount++;
    rel.lastInteraction = Date.now();
    rel.familiarity = Math.min(
      this.config.maxFamiliarity,
      rel.familiarity + this.config.familiarityPerInteraction,
    );

    // Track discussed topics
    const topics = this.extractTopics(message);
    for (const topic of topics) {
      if (!rel.discussedTopics.includes(topic)) {
        rel.discussedTopics.push(topic);
      }
      this.conversationTopics.add(topic);
    }

    // Update sentiment based on message tone
    if (isPlayerMessage) {
      const positivity = this.analyzeSentiment(message);
      rel.sentiment = Math.max(-1, Math.min(1, rel.sentiment + positivity * 0.1));
    }

    // Infer play style
    if (rel.interactionCount > 5 && rel.playStyle === "unknown") {
      rel.playStyle = this.inferPlayStyle(rel);
    }
  }

  /** Record a player preference from observed behavior. */
  recordPreference(playerName: string, preference: string): void {
    const rel = this.getRelationship(playerName);
    if (!rel.knownPreferences.includes(preference)) {
      rel.knownPreferences.push(preference);
    }
  }

  // ─── Dialogue Shaping ──────────────────────────────

  /**
   * Shape a dialogue response based on personality, emotion, and relationship.
   */
  async shapeDialogue(ctx: DialogueContext): Promise<SocialResponse> {
    const traits = this.profile.traits;
    const tone = this.profile.traits.sociability > 0.6 ? "friendly" as const : "neutral" as const;

    // Memory-aware context
    let memoryContext = "";
    if (this.memoryRetriever && this.memoryStore) {
      try {
        const retrieval = await this.memoryRetriever.retrieve({
          store: this.memoryStore,
          queryText: `${ctx.playerName} ${ctx.message}`,
          types: ["event", "relationship", "preference"],
          limit: 3,
        });
        if (retrieval.contextText) {
          memoryContext = `\nRelevant memories:\n${retrieval.contextText}`;
        }
      } catch {
        // Memory retrieval failure is non-fatal
      }
    }

    // Build personality-flavored response guidance
    const guidance: string[] = [];
    if (traits.humor > 0.6) guidance.push("Be playful and witty");
    if (traits.helpfulness > 0.7) guidance.push("Be supportive and helpful");
    if (ctx.relationship.familiarity > 50) guidance.push("Talk like you know them well");
    if (ctx.currentEmotion === "excited") guidance.push("Express enthusiasm");

    return {
      text: memoryContext
        ? `${memoryContext}\n${ctx.message}`
        : ctx.message,
      tone,
      initiateConversation: false,
    };
  }

  /**
   * Check if the AI should proactively start a conversation.
   */
  shouldInitiateConversation(playerName: string): {
    should: boolean;
    topic?: string;
  } {
    const now = Date.now();
    const rel = this.getRelationship(playerName);

    // Cooldown
    if (now - this.lastChatInitiated < this.config.chatCooldownMs) {
      return { should: false };
    }

    // Only proactive if sociability is high enough
    if (this.profile.traits.sociability < 0.5) {
      return { should: false };
    }

    // Probability based on relationship and traits
    const baseProb = this.profile.traits.sociability * 0.3;
    const familiarityBoost = (rel.familiarity / 100) * 0.2;
    const probability = baseProb + familiarityBoost;

    if (Math.random() < probability) {
      this.lastChatInitiated = now;

      // Pick a topic
      let topic: string | undefined;
      if (rel.discussedTopics.length > 0) {
        topic = rel.discussedTopics[Math.floor(Math.random() * rel.discussedTopics.length)];
      } else if (this.conversationTopics.size > 0) {
        const topics = [...this.conversationTopics];
        topic = topics[Math.floor(Math.random() * topics.length)];
      }

      return { should: true, topic };
    }

    return { should: false };
  }

  // ─── Sentiment Analysis (heuristic) ────────────────

  private analyzeSentiment(text: string): number {
    const lower = text.toLowerCase();
    const positive = ["thanks", "good", "great", "nice", "awesome", "love", "yay", "well done", "ty", "thank"];
    const negative = ["bad", "stop", "no", "hate", "stupid", "wrong", "idiot", "useless", "annoying", "dumb"];

    let score = 0;
    for (const word of positive) {
      if (lower.includes(word)) score += 1;
    }
    for (const word of negative) {
      if (lower.includes(word)) score -= 1;
    }

    return Math.max(-1, Math.min(1, score * 0.3));
  }

  // ─── Topic Extraction ──────────────────────────────

  private extractTopics(text: string): string[] {
    const lower = text.toLowerCase();
    const topicKeywords = [
      "mine", "build", "farm", "explore", "fight", "defend", "craft",
      "diamond", "iron", "gold", "nether", "ender", "village",
      "house", "base", "cave", "food", "tree", "wood", "stone",
    ];

    return topicKeywords.filter((kw) => lower.includes(kw));
  }

  // ─── Play Style Inference ──────────────────────────

  private inferPlayStyle(rel: PlayerRelationship): PlayerRelationship["playStyle"] {
    const topics = rel.discussedTopics.join(" ");
    const lower = topics.toLowerCase();

    if (lower.includes("fight") || lower.includes("defend") || lower.includes("kill")) return "fighter";
    if (lower.includes("build") || lower.includes("craft") || lower.includes("house")) return "builder";
    if (lower.includes("explore") || lower.includes("cave") || lower.includes("find")) return "explorer";
    if (rel.interactionCount > 8 && rel.sentiment > 0.3) return "social";

    return "unknown";
  }

  // ─── Relationship Summary ──────────────────────────

  getRelationshipSummary(playerName: string): string {
    const rel = this.getRelationship(playerName);
    const parts: string[] = [];

    parts.push(`${playerName}: familiarity ${rel.familiarity}/100`);
    parts.push(`sentiment ${rel.sentiment > 0 ? "+" : ""}${rel.sentiment.toFixed(1)}`);
    parts.push(`${rel.interactionCount} interactions`);

    if (rel.knownPreferences.length > 0) {
      parts.push(`prefers: ${rel.knownPreferences.join(", ")}`);
    }

    return parts.join(" | ");
  }

  getAllRelationships(): PlayerRelationship[] {
    return [...this.relationships.values()];
  }
}
