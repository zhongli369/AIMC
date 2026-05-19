import type { NarrationCategory } from "./voice-state.js";
import type { ExecutionResult } from "../interfaces/intent.js";
import { type VoiceProfile } from "./profile/voice-profile-loader.js";
import type { CompanionRole } from "../role/role-identity.js";
export interface TTSAdapterConfig {
    /** Enable action narration (bot speaks what it's doing) */
    narrateActions: boolean;
    /** Enable skill result narration */
    narrateSkillResults: boolean;
    /** Enable fallback narration */
    narrateFallbacks: boolean;
    /** Enable critical alerts */
    narrateAlerts: boolean;
    /** Max chars per narration utterance */
    maxUtteranceLength: number;
    /** Language for narration (affects phrasing) */
    language: "zh" | "en";
}
export declare class TextToSpeechAdapter {
    private config;
    private onSpeak;
    private voiceProfile;
    constructor(config?: Partial<TTSAdapterConfig>);
    /** Wire the actual TTS playback callback (EdgeTTS.speak, etc.). */
    setSpeaker(fn: (text: string, category: NarrationCategory) => void): void;
    /**
     * Apply a role-based voice profile to TTS output.
     * Adjusts pitch, rate, volume, and narration pacing.
     * P1 — Voice Profile System.
     */
    applyRoleVoiceProfile(role: CompanionRole): void;
    /** Get the current voice profile (for EdgeTTS to read pitch/rate/volume). */
    getCurrentVoiceProfile(): VoiceProfile | null;
    /** Narrate a chat response from AgentCore. */
    speakChatResponse(text: string): void;
    /** Narrate skill execution starting. */
    speakSkillStart(skillName: string, actionDesc?: string): void;
    /** Narrate skill execution completed. */
    speakSkillComplete(skillName: string, actionDesc?: string): void;
    /** Narrate skill execution failed. */
    speakSkillFailed(skillName: string, actionDesc?: string): void;
    /** Narrate fallback activation. */
    speakFallback(fromSkill: string, toSkill: string): void;
    /** Narrate a critical alert (danger, low health, etc.). */
    speakAlert(alertText: string): void;
    /** Narrate an idle observation. */
    speakIdleThought(observation: string): void;
    /** Narrate a proactive action. */
    speakProactiveAction(actionDesc: string): void;
    /** Narrate an execution result (auto-detects category from result). */
    speakExecutionResult(result: ExecutionResult, skillName?: string): void;
    private emit;
    private mute;
    private pickTemplate;
    private skillLabel;
    setLanguage(lang: "zh" | "en"): void;
    setNarrateActions(enabled: boolean): void;
}
//# sourceMappingURL=text-to-speech.d.ts.map