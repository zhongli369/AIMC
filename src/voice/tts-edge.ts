/**
 * TTS — Microsoft Edge TTS engine.
 * Free HTTP-based text-to-speech synthesis with streaming MP3 output.
 * Supports SSML, voice selection, sentence-level streaming, and interruption.
 */
import { EventEmitter } from "node:events";

// ─── Config ──────────────────────────────────────────

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

const DEFAULT_TTS_CONFIG: TTSConfig = {
  voice: "en-US-GuyNeural",
  rate: 0,
  pitch: "+0Hz",
  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
  maxChunkSize: 2000,
  endpoint: "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1",
  timeoutMs: 10_000,
};

// ─── Common Edge TTS voices ──────────────────────────

export const EDGE_VOICES = {
  male: {
    us: "en-US-GuyNeural",
    uk: "en-GB-RyanNeural",
    au: "en-AU-WilliamNeural",
  },
  female: {
    us: "en-US-JennyNeural",
    uk: "en-GB-SoniaNeural",
    au: "en-AU-NatashaNeural",
  },
  default: "en-US-GuyNeural",
} as const;

// ─── Result Types ────────────────────────────────────

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

// ─── TTS Engine ──────────────────────────────────────

export class EdgeTTS extends EventEmitter {
  private config: TTSConfig;
  private abortController: AbortController | null = null;
  private speaking = false;
  private queue: TTSAudioChunk[] = [];
  private currentText: string | null = null;

  constructor(config?: Partial<TTSConfig>) {
    super();
    this.config = { ...DEFAULT_TTS_CONFIG, ...config };
  }

  // ─── Speak ─────────────────────────────────────────

  /**
   * Synthesize and stream text as audio.
   * Yields TTSAudioChunk events for playback.
   * Returns when all audio has been synthesized.
   *
   * Call stop() to interrupt playback at any time.
   */
  async speak(text: string, options?: {
    voice?: string;
    rate?: number;
    pitch?: string;
  }): Promise<void> {
    if (!text.trim()) return;

    this.stop(); // Cancel any current speech
    this.abortController = new AbortController();
    this.speaking = true;
    this.currentText = text;

    try {
      // Split into sentence-level chunks for streaming
      const chunks = this.splitIntoChunks(text);

      for (let i = 0; i < chunks.length; i++) {
        if (this.abortController.signal.aborted) break;

        const audio = await this.synthesizeChunk(
          chunks[i],
          options,
          this.abortController.signal,
        );

        if (audio && audio.length > 0) {
          const chunk: TTSAudioChunk = {
            data: audio,
            isFinal: i === chunks.length - 1,
            index: i,
          };

          this.queue.push(chunk);
          this.emit("audio", chunk);
        }
      }
    } catch (err) {
      if (!this.abortController.signal.aborted) {
        this.emit("error", err);
      }
    } finally {
      this.speaking = false;
      this.currentText = null;
      if (!this.abortController.signal.aborted) {
        this.emit("done");
      }
    }
  }

  // ─── Stop / Interrupt ──────────────────────────────

  /** Hard stop — cancel all synthesis and clear queue. */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.speaking = false;
    this.queue = [];
    this.currentText = null;
    this.emit("interrupted");
  }

  // ─── State ─────────────────────────────────────────

  isSpeaking(): boolean {
    return this.speaking;
  }

  getState(): TTSSynthesisState {
    return {
      speaking: this.speaking,
      queuedChunks: this.queue.length,
      currentText: this.currentText,
    };
  }

  // ─── Config ────────────────────────────────────────

  setVoice(voice: string): void {
    this.config.voice = voice;
  }

  getConfig(): Readonly<TTSConfig> {
    return this.config;
  }

  // ─── SSML Builder ──────────────────────────────────

  /** Build an SSML document for Edge TTS. */
  buildSSML(text: string, options?: {
    voice?: string;
    rate?: number;
    pitch?: string;
  }): string {
    const voice = options?.voice || this.config.voice;
    const rate = options?.rate ?? this.config.rate;
    const pitch = options?.pitch || this.config.pitch;

    // Escape XML entities in text
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="${voice}">
    <prosody rate="${rate >= 0 ? "+" : ""}${rate}%" pitch="${pitch}">
      ${escaped}
    </prosody>
  </voice>
</speak>`;
  }

  // ─── Internals ─────────────────────────────────────

  private async synthesizeChunk(
    text: string,
    options?: { voice?: string; rate?: number; pitch?: string },
    signal?: AbortSignal,
  ): Promise<Buffer | null> {
    const ssml = this.buildSSML(text, options);

    const response = await fetch(`${this.config.endpoint}?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4`, {
      method: "POST",
      headers: {
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": this.config.outputFormat,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: ssml,
      signal,
    });

    if (!response.ok) {
      throw new Error(`Edge TTS HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private splitIntoChunks(text: string): string[] {
    if (text.length <= this.config.maxChunkSize) return [text];

    // Split on sentence boundaries
    const sentencePattern = /([^.!?\n]+[.!?\n]+)/g;
    const sentences: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = sentencePattern.exec(text)) !== null) {
      sentences.push(match[1]);
    }

    // If no sentence boundaries found or remainder, add it
    const matched = sentences.join("");
    if (matched.length < text.length) {
      sentences.push(text.slice(matched.length));
    }

    if (sentences.length === 0) return [text];

    // Coalesce sentences up to maxChunkSize
    const chunks: string[] = [];
    let current = "";

    for (const s of sentences) {
      if (current.length + s.length > this.config.maxChunkSize && current.length > 0) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += s;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }
}

// ─── Re-export types ───────────────────────────────

export type { EventEmitter } from "node:events";
