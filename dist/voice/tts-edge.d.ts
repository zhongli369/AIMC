/**
 * TTS — Microsoft Edge TTS engine.
 * Free HTTP-based text-to-speech synthesis with streaming MP3 output.
 * Supports SSML, voice selection, sentence-level streaming, and interruption.
 */
import { EventEmitter } from "node:events";
export interface TTSConfig {
    /** Voice name (Edge TTS format: e.g. "en-US-GuyNeural") */
    voice: string;
    /** Speech rate modifier (-50 to +100 percent) */
    rate: number;
    /** Pitch modifier in Hz or semitones */
    pitch: string;
    /** Audio output format */
    outputFormat: string;
    /** Max characters per synthesis request */
    maxChunkSize: number;
    /** Base endpoint for Edge TTS */
    endpoint: string;
    /** Request timeout in ms */
    timeoutMs: number;
}
export declare const EDGE_VOICES: {
    readonly male: {
        readonly us: "en-US-GuyNeural";
        readonly uk: "en-GB-RyanNeural";
        readonly au: "en-AU-WilliamNeural";
    };
    readonly female: {
        readonly us: "en-US-JennyNeural";
        readonly uk: "en-GB-SoniaNeural";
        readonly au: "en-AU-NatashaNeural";
    };
    readonly default: "en-US-GuyNeural";
};
export interface TTSAudioChunk {
    /** Raw MP3 audio data */
    data: Buffer;
    /** Whether this is the last chunk of the utterance */
    isFinal: boolean;
    /** Sequence index for ordering */
    index: number;
}
export interface TTSSynthesisState {
    speaking: boolean;
    queuedChunks: number;
    currentText: string | null;
}
export declare class EdgeTTS extends EventEmitter {
    private config;
    private abortController;
    private speaking;
    private queue;
    private currentText;
    constructor(config?: Partial<TTSConfig>);
    /**
     * Synthesize and stream text as audio.
     * Yields TTSAudioChunk events for playback.
     * Returns when all audio has been synthesized.
     *
     * Call stop() to interrupt playback at any time.
     */
    speak(text: string, options?: {
        voice?: string;
        rate?: number;
        pitch?: string;
    }): Promise<void>;
    /** Hard stop — cancel all synthesis and clear queue. */
    stop(): void;
    isSpeaking(): boolean;
    getState(): TTSSynthesisState;
    setVoice(voice: string): void;
    getConfig(): Readonly<TTSConfig>;
    /** Build an SSML document for Edge TTS. */
    buildSSML(text: string, options?: {
        voice?: string;
        rate?: number;
        pitch?: string;
    }): string;
    private synthesizeChunk;
    private splitIntoChunks;
}
export type { EventEmitter } from "node:events";
//# sourceMappingURL=tts-edge.d.ts.map