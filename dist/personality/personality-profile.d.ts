export interface PersonalityDimensions {
    helpfulness: number;
    cautiousness: number;
    aggressiveness: number;
    curiosity: number;
    sociability: number;
    humor: number;
    independence: number;
}
export interface PersonalityProfile {
    id: string;
    name: string;
    /** Core trait values (0–1) */
    traits: PersonalityDimensions;
    /** Natural language bio */
    bio: string;
    /** Speech style descriptors */
    speechStyle: string[];
    /** Preferred action categories */
    preferredActions: string[];
    /** Avoided action categories */
    avoidedActions: string[];
    /** Minimum interval between proactive actions (ms) */
    proactiveMinIntervalMs: number;
    /** Probability of proactive action per tick (0–1) */
    proactivityRate: number;
    /** How much emotion affects behavior (0–1) */
    emotionalVolatility: number;
}
export declare const PERSONALITY_PRESETS: Record<string, PersonalityProfile>;
export declare function createProfile(preset?: keyof typeof PERSONALITY_PRESETS, overrides?: Partial<PersonalityDimensions> & Partial<Pick<PersonalityProfile, "name" | "proactivityRate" | "emotionalVolatility">>): PersonalityProfile;
export type SpeechTone = "neutral" | "friendly" | "urgent" | "excited" | "concerned";
export declare function selectSpeechTone(traits: PersonalityDimensions, emotion: {
    type: string;
    intensity: number;
}): SpeechTone;
//# sourceMappingURL=personality-profile.d.ts.map