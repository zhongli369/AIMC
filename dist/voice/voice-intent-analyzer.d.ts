/**
 * VoiceIntentAnalyzer — analyzes STT transcripts for urgency signals.
 *
 * Detects:
 *   - Urgency keywords (language-aware: zh + en)
 *   - Repetition frequency (user repeating the same command)
 *   - Punctuation intensity (!, !!, ?!)
 *   - Interruption patterns
 *
 * Output: VoicePressureSignal consumed by AgentCore → SkillRouter / TaskPlanner.
 *
 * This is ANALYSIS ONLY. It does NOT:
 *   - Execute actions
 *   - Route skills
 *   - Modify the execution chain
 */
import type { VoicePressureSignal } from "./voice-pressure.js";
import { computeTimingModifiers, computeSkillBias } from "./voice-pressure.js";
export interface VoiceIntentConfig {
    /** Window for detecting repetition (ms) */
    repetitionWindowMs: number;
    /** Max recent transcripts to keep for repetition detection */
    maxRecentTranscripts: number;
    /** Interrupt threshold for escalating pressure */
    interruptThreshold: number;
}
export declare class VoiceIntentAnalyzer {
    private config;
    private recentTranscripts;
    private interruptCount;
    private lastPressureSignal;
    constructor(config?: Partial<VoiceIntentConfig>);
    /**
     * Analyze a voice transcript and produce a pressure signal.
     *
     * Called by AgentCore after STT produces text but before think().
     * The resulting signal flows as read-only context through the pipeline.
     */
    analyze(transcript: string): VoicePressureSignal;
    /** Notify analyzer of a voice interrupt event. */
    recordInterrupt(): void;
    /** Reset interrupt counter (call per cycle). */
    resetInterrupts(): void;
    /** Get the last computed pressure signal. */
    getLastSignal(): VoicePressureSignal;
    /**
     * Convenience: analyze transcript and return both signal + modifiers + bias.
     */
    analyzeFull(transcript: string): {
        signal: VoicePressureSignal;
        timingModifiers: ReturnType<typeof computeTimingModifiers>;
        skillBias: ReturnType<typeof computeSkillBias>;
    };
    private detectKeywords;
    private detectRepetition;
    private detectPunctuationIntensity;
    private classifyLevel;
    private computeIntensity;
    private computeConfidence;
    /** Simple Jaccard-like similarity for short Chinese/English text. */
    private textSimilarity;
    /** Reset all internal state. */
    reset(): void;
}
//# sourceMappingURL=voice-intent-analyzer.d.ts.map