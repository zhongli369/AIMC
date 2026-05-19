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
import type { VoicePressureSignal, VoicePressureLevel, VoicePressureSource } from "./voice-pressure.js";
import { computeTimingModifiers, computeSkillBias, createNeutralSignal } from "./voice-pressure.js";

// ─── Config ──────────────────────────────────────────

export interface VoiceIntentConfig {
  /** Window for detecting repetition (ms) */
  repetitionWindowMs: number;
  /** Max recent transcripts to keep for repetition detection */
  maxRecentTranscripts: number;
  /** Interrupt threshold for escalating pressure */
  interruptThreshold: number;
}

const DEFAULT_CONFIG: VoiceIntentConfig = {
  repetitionWindowMs: 30_000,
  maxRecentTranscripts: 5,
  interruptThreshold: 2,
};

// ─── Urgency Keywords ─────────────────────────────────

const URGENCY_KEYWORDS: Record<VoicePressureLevel, { zh: string[]; en: string[] }> = {
  critical: {
    zh: ["救命", "被围攻", "要死了", "有人在打", "紧急", "危险", "快跑", "逃命", "help", "sos"],
    en: ["help", "emergency", "dying", "under attack", "surrounded", "critical", "sos", "save me"],
  },
  urgent: {
    zh: ["快", "快点", "马上", "赶紧", "立刻", "现在", "急", "迅速", "加速", "冲"],
    en: ["quick", "fast", "now", "hurry", "urgent", "rush", "immediately", "asap", "go go"],
  },
  normal: {
    zh: ["去", "挖", "跟着", "过来", "收集", "建造", "探索"],
    en: ["go", "mine", "follow", "come", "collect", "build", "explore", "get"],
  },
  calm: {
    zh: ["等等", "别急", "慢慢", "不急", "休息", "停下", "待着", "等着"],
    en: ["wait", "slow", "hold", "relax", "pause", "rest", "stay", "stop for now"],
  },
};

// ─── Analyzer ─────────────────────────────────────────

export class VoiceIntentAnalyzer {
  private config: VoiceIntentConfig;
  private recentTranscripts: Array<{ text: string; timestamp: number }> = [];
  private interruptCount = 0;
  private lastPressureSignal: VoicePressureSignal = createNeutralSignal();

  constructor(config?: Partial<VoiceIntentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze a voice transcript and produce a pressure signal.
   *
   * Called by AgentCore after STT produces text but before think().
   * The resulting signal flows as read-only context through the pipeline.
   */
  analyze(transcript: string): VoicePressureSignal {
    // Detect keywords
    const keywords = this.detectKeywords(transcript);

    // Detect repetition
    const repetitionCount = this.detectRepetition(transcript);

    // Detect punctuation intensity
    const punctuationIntensity = this.detectPunctuationIntensity(transcript);

    // Classify level
    const level = this.classifyLevel(keywords, repetitionCount, punctuationIntensity);
    const intensity = this.computeIntensity(level, keywords, repetitionCount, punctuationIntensity);
    const confidence = this.computeConfidence(keywords, repetitionCount);

    const source: VoicePressureSource = {
      keywords,
      repetitionCount,
      punctuationIntensity,
      interruptCount: this.interruptCount,
    };

    const signal: VoicePressureSignal = {
      level,
      intensity: Math.min(1.0, intensity),
      confidence,
      source,
      timestamp: Date.now(),
    };

    // Track for repetition detection
    this.recentTranscripts.push({ text: transcript, timestamp: Date.now() });
    while (this.recentTranscripts.length > this.config.maxRecentTranscripts) {
      this.recentTranscripts.shift();
    }

    // Persist
    this.lastPressureSignal = signal;
    return signal;
  }

  /** Notify analyzer of a voice interrupt event. */
  recordInterrupt(): void {
    this.interruptCount++;
  }

  /** Reset interrupt counter (call per cycle). */
  resetInterrupts(): void {
    this.interruptCount = 0;
  }

  /** Get the last computed pressure signal. */
  getLastSignal(): VoicePressureSignal {
    return this.lastPressureSignal;
  }

  /**
   * Convenience: analyze transcript and return both signal + modifiers + bias.
   */
  analyzeFull(transcript: string): {
    signal: VoicePressureSignal;
    timingModifiers: ReturnType<typeof computeTimingModifiers>;
    skillBias: ReturnType<typeof computeSkillBias>;
  } {
    const signal = this.analyze(transcript);
    return {
      signal,
      timingModifiers: computeTimingModifiers(signal),
      skillBias: computeSkillBias(signal),
    };
  }

  // ─── Detection Methods ──────────────────────────────

  private detectKeywords(text: string): string[] {
    const found: string[] = [];
    const lower = text.toLowerCase();

    for (const level of ["critical", "urgent", "normal", "calm"] as VoicePressureLevel[]) {
      const kw = URGENCY_KEYWORDS[level];
      for (const keyword of [...kw.zh, ...kw.en]) {
        if (lower.includes(keyword.toLowerCase())) {
          found.push(keyword);
        }
      }
    }

    return found;
  }

  private detectRepetition(text: string): number {
    const cutoff = Date.now() - this.config.repetitionWindowMs;
    const recent = this.recentTranscripts.filter((t) => t.timestamp >= cutoff);

    // Count how many recent transcripts are similar to this one
    const similarityThreshold = 0.6;
    let count = 0;

    for (const entry of recent) {
      if (this.textSimilarity(text, entry.text) >= similarityThreshold) {
        count++;
      }
    }

    return count;
  }

  private detectPunctuationIntensity(text: string): number {
    let score = 0;

    // "!!" = high intensity
    const doubleBang = (text.match(/！！|!!/g) || []).length;
    score += doubleBang * 0.3;

    // "!" = moderate intensity
    const singleBang = (text.match(/！|!/g) || []).length;
    score += singleBang * 0.15;

    // "?!" = confusion + urgency
    const interrobang = (text.match(/？！|!\?|\?!|？!/g) || []).length;
    score += interrobang * 0.25;

    // ALL CAPS segments = shouting
    const capsSegments = text.match(/[A-Z一-鿿]{4,}/g) || [];
    score += capsSegments.length * 0.1;

    return Math.min(1.0, score);
  }

  private classifyLevel(
    keywords: string[],
    repetitionCount: number,
    punctuationIntensity: number,
  ): VoicePressureLevel {
    // Check critical keywords
    const criticalKw = [...URGENCY_KEYWORDS.critical.zh, ...URGENCY_KEYWORDS.critical.en];
    if (keywords.some((k) => criticalKw.includes(k))) return "critical";

    // High repetition + punctuation = urgent
    if (repetitionCount >= 3 || punctuationIntensity >= 0.6) return "urgent";

    // Urgent keywords
    const urgentKw = [...URGENCY_KEYWORDS.urgent.zh, ...URGENCY_KEYWORDS.urgent.en];
    if (keywords.some((k) => urgentKw.includes(k))) return "urgent";

    // Interrupt-based escalation
    if (this.interruptCount >= this.config.interruptThreshold) return "urgent";

    // Calm keywords
    const calmKw = [...URGENCY_KEYWORDS.calm.zh, ...URGENCY_KEYWORDS.calm.en];
    if (keywords.some((k) => calmKw.includes(k))) return "calm";

    return "normal";
  }

  private computeIntensity(
    level: VoicePressureLevel,
    keywords: string[],
    repetitionCount: number,
    punctuationIntensity: number,
  ): number {
    let intensity = 0;

    // Keyword contribution
    if (level === "critical") intensity += 0.7;
    else if (level === "urgent") intensity += 0.4;
    else if (level === "calm") intensity += 0.1;

    // Repetition = stronger intent
    intensity += Math.min(repetitionCount * 0.15, 0.3);

    // Punctuation emphasis
    intensity += punctuationIntensity * 0.3;

    // Interrupt escalation
    intensity += Math.min(this.interruptCount * 0.1, 0.2);

    return Math.min(1.0, intensity);
  }

  private computeConfidence(keywords: string[], repetitionCount: number): number {
    if (keywords.length >= 2) return 0.9;
    if (keywords.length === 1) return 0.7;
    if (repetitionCount >= 2) return 0.5;
    return 0.3;
  }

  /** Simple Jaccard-like similarity for short Chinese/English text. */
  private textSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(""));
    const setB = new Set(b.split(""));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /** Reset all internal state. */
  reset(): void {
    this.recentTranscripts = [];
    this.interruptCount = 0;
    this.lastPressureSignal = createNeutralSignal();
  }
}
