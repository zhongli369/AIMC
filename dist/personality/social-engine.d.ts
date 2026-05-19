/**
 * SocialEngine — contextual dialogue, memory-aware conversation,
 * relationship continuity.
 *
 * AI remembers: player habits, repeated phrases, preferences, past experiences.
 */
import type { PersonalityProfile, SpeechTone } from "./personality-profile.js";
import type { EmotionEngine } from "./emotion-engine.js";
import type { MemoryRetriever } from "../memory/retriever.js";
import type { SQLiteMemoryStore } from "../memory/sqlite-store.js";
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
export declare class SocialEngine {
    private relationships;
    private config;
    private profile;
    private emotion;
    private memoryStore;
    private memoryRetriever;
    private lastChatInitiated;
    private conversationTopics;
    constructor(profile: PersonalityProfile, emotion: EmotionEngine, config?: Partial<SocialConfig>);
    setMemoryBackend(store: SQLiteMemoryStore, retriever: MemoryRetriever): void;
    /** Get or create a relationship with a player. */
    getRelationship(playerName: string): PlayerRelationship;
    /** Record an interaction with a player, updating relationship. */
    recordInteraction(playerName: string, message: string, isPlayerMessage: boolean): void;
    /** Record a player preference from observed behavior. */
    recordPreference(playerName: string, preference: string): void;
    /**
     * Shape a dialogue response based on personality, emotion, and relationship.
     */
    shapeDialogue(ctx: DialogueContext): Promise<SocialResponse>;
    /**
     * Check if the AI should proactively start a conversation.
     */
    shouldInitiateConversation(playerName: string): {
        should: boolean;
        topic?: string;
    };
    private analyzeSentiment;
    private extractTopics;
    private inferPlayStyle;
    getRelationshipSummary(playerName: string): string;
    getAllRelationships(): PlayerRelationship[];
}
export {};
//# sourceMappingURL=social-engine.d.ts.map