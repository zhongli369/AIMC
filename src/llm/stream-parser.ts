/**
 * StreamParser — incremental JSON reconstruction from LLM streaming output.
 * Handles: partial chunks, markdown fences, hallucinated text, truncated streams.
 * Only emits complete, validated AgentOutput objects.
 */
import { AgentOutputSchema, type ValidatedAgentOutput } from "../runtime/intent-schema.js";
import type { SchemaValidationResult } from "../runtime/intent-schema.js";

// ─── Result Types ────────────────────────────────────

export type ParserState = "waiting_for_json" | "collecting" | "done" | "error";

export interface ParserResult {
  state: ParserState;
  /** Complete validated output (only when state === "done") */
  output?: ValidatedAgentOutput;
  /** Raw JSON string that was parsed */
  rawJson?: string;
  /** Error info if state === "error" */
  error?: string;
  /** Whether early termination was triggered (valid JSON found before stream end) */
  earlyTermination: boolean;
}

// ─── Parser ──────────────────────────────────────────

export class StreamParser {
  private buffer = "";
  private state: ParserState = "waiting_for_json";
  private result: ParserResult | null = null;
  private totalChunks = 0;

  // ─── Feed chunk ────────────────────────────────────

  /**
   * Feed a text chunk from the LLM stream.
   * Returns the current parser result after processing the chunk.
   */
  feed(chunk: string): ParserResult {
    if (this.state === "done" || this.state === "error") {
      return this.result!;
    }

    this.totalChunks++;
    this.buffer += chunk;

    // Try to extract a complete JSON object
    const extracted = this.tryExtractJson();

    if (extracted) {
      const validation = AgentOutputSchema.safeParse(extracted);

      if (validation.success) {
        this.state = "done";
        this.result = {
          state: "done",
          output: validation.data as ValidatedAgentOutput,
          rawJson: JSON.stringify(extracted),
          earlyTermination: true, // we found valid JSON — stop streaming
        };
        return this.result;
      }

      // JSON parsed but failed Zod validation
      // If this is the final chunk or a clearly malformed output, flag as error
      // Otherwise keep collecting — more chunks might complete the object
      if (this.isDefinitivelyMalformed(extracted)) {
        this.state = "error";
        this.result = {
          state: "error",
          error: `JSON parsed but failed schema validation: ${validation.error?.issues.map(i => i.message).join("; ")}`,
          earlyTermination: false,
        };
        return this.result;
      }
    }

    this.state = "collecting";
    return {
      state: "collecting",
      earlyTermination: false,
    };
  }

  // ─── Finalize (stream ended) ───────────────────────

  /**
   * Called when the LLM stream ends. Makes a best-effort attempt
   * to extract valid JSON from whatever was received.
   */
  finalize(): ParserResult {
    if (this.state === "done" || this.state === "error") {
      return this.result!;
    }

    // Last-resort extraction: try to find ANY valid JSON object
    const extracted = this.tryExtractJson();

    if (extracted) {
      const validation = AgentOutputSchema.safeParse(extracted);
      if (validation.success) {
        this.state = "done";
        this.result = {
          state: "done",
          output: validation.data as ValidatedAgentOutput,
          rawJson: JSON.stringify(extracted),
          earlyTermination: false,
        };
        return this.result;
      }
    }

    // Check if the buffer itself is valid JSON (edge case)
    try {
      const direct = JSON.parse(this.buffer.trim());
      const validation = AgentOutputSchema.safeParse(direct);
      if (validation.success) {
        this.state = "done";
        this.result = {
          state: "done",
          output: validation.data as ValidatedAgentOutput,
          rawJson: this.buffer.trim(),
          earlyTermination: false,
        };
        return this.result;
      }
    } catch {
      // Not valid JSON — try repair then speech extraction
    }

    // Last-resort: attempt to extract speech from malformed buffer
    console.log(
      `[LLM-PARSE] failed — bufferSize=${this.buffer.length} rawPreview="${this.buffer.slice(0, 500).replace(/\n/g, " ")}"`
    );

    const speechOutput = this.extractSpeechFromBuffer();
    if (speechOutput) {
      const validation = AgentOutputSchema.safeParse(speechOutput);
      if (validation.success) {
        console.log(
          `[LLM-PARSE] speech-extracted text="${speechOutput.speech?.text?.slice(0, 60)}"`
        );
        this.state = "done";
        this.result = {
          state: "done",
          output: validation.data as ValidatedAgentOutput,
          rawJson: JSON.stringify(speechOutput),
          earlyTermination: false,
        };
        return this.result;
      }
    }

    // Could not extract valid JSON
    this.state = "error";
    this.result = {
      state: "error",
      error: `Stream ended without valid AgentOutput. Buffer size: ${this.buffer.length} chars. First 200 chars: "${this.buffer.slice(0, 200)}"`,
      earlyTermination: false,
    };
    return this.result;
  }

  // ─── Reset ─────────────────────────────────────────

  reset(): void {
    this.buffer = "";
    this.state = "waiting_for_json";
    this.result = null;
    this.totalChunks = 0;
  }

  getBuffer(): string {
    return this.buffer;
  }

  getState(): ParserState {
    return this.state;
  }

  // ─── JSON Extraction ───────────────────────────────

  /**
   * Try to find a complete JSON object in the buffer.
   * Handles common LLM wrapping patterns:
   * - ```json ... ``` fences
   * - Leading prose before JSON
   * - Trailing text after JSON
   */
  private tryExtractJson(): Record<string, unknown> | null {
    let text = this.buffer;

    // Strip markdown code fences
    text = this.stripMarkdownFences(text);

    // Strategy 0: Apply repair to the full text BEFORE brace extraction.
    // This fixes bare-string quotes that would otherwise fool extractBraceObject's
    // string-detection into swallowing closing braces.
    const preRepaired = this.repairJson(text);
    if (preRepaired !== text) {
      const braceObj = this.extractBraceObject(preRepaired);
      if (braceObj) {
        try {
          const result = JSON.parse(braceObj);
          console.log(
            `[LLM-PARSE] pre-repaired — rawPreview="${text.slice(0, 100)}"`
          );
          return result;
        } catch {
          // Still invalid after pre-repair
        }
      }
      // Also try parsing the whole pre-repaired text directly
      try {
        return JSON.parse(preRepaired);
      } catch {
        // Still not valid
      }
    }

    // Strategy 1: Find the outermost { } pair in the stripped text
    const braceObject = this.extractBraceObject(text);
    if (braceObject) {
      try {
        return JSON.parse(braceObject);
      } catch {
        // Try repair
        const repaired = this.repairJson(braceObject);
        if (repaired !== braceObject) {
          try {
            const result = JSON.parse(repaired);
            console.log(
              `[LLM-PARSE] repaired — bareString/ trailingComma — rawPreview="${braceObject.slice(0, 100)}"`
            );
            return result;
          } catch {
            // Repair didn't help
          }
        }
      }
    }

    // Strategy 2: Try parsing the whole stripped text as-is
    try {
      return JSON.parse(text);
    } catch {
      // Not valid JSON yet
    }

    // Strategy 3: Try parsing the raw buffer (with fences stripped)
    const raw = this.stripMarkdownFences(this.buffer);
    if (raw !== text) {
      try {
        return JSON.parse(raw);
      } catch {
        // Try repair on raw buffer
        const repairedRaw = this.repairJson(raw);
        if (repairedRaw !== raw) {
          try {
            return JSON.parse(repairedRaw);
          } catch {
            // Repair didn't help
          }
        }
      }
    }

    return null;
  }

  // ─── Brace Extraction ──────────────────────────────

  /**
   * Extract the outermost complete { } object from text.
   * Uses depth tracking with string and escape awareness.
   */
  private extractBraceObject(text: string): string | null {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === "\\" && inString) {
        escapeNext = true;
        continue;
      }

      if (ch === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  // ─── Markdown Fence Removal ────────────────────────

  private stripMarkdownFences(text: string): string {
    // Remove ```json ... ``` wrapping
    let result = text.trim();

    // Remove leading ```json or ``` fence
    const fenceStart = /^```(?:json|JSON)?\s*/;
    result = result.replace(fenceStart, "");

    // Remove trailing ``` fence
    const fenceEnd = /\s*```\s*$/;
    result = result.replace(fenceEnd, "");

    return result.trim();
  }

  // ─── JSON Repair (conservative) ──────────────────────

  /**
   * Apply conservative repairs to malformed LLM JSON output.
   * Only fixes structural issues — never changes semantic content.
   * Safe: repairs only enable JSON.parse to succeed; Zod still validates.
   */
  private repairJson(text: string): string {
    let repaired = text;

    // Fix 0: missing colon/closing-quote between known key and quoted value.
    // Handles two LLM malformation patterns:
    //   "text" "你好"  → "text": "你好"   (key properly closed, missing colon)
    //   "text "你好"   → "text": "你好"   (key missing closing quote, replaced by space)
    const knownFields = [
      "intent", "speech", "text", "tone", "mood", "type", "name",
      "reason", "target", "actions", "internal_state",
    ];
    const missingColonRe = new RegExp(
      `"(${knownFields.join("|")})"?(\\s+)(")`,
      "g",
    );
    repaired = repaired.replace(missingColonRe, '"$1":$2$3');

    // Fix 1: missing opening quote for bare string values
    // "intent":chat" → "intent":"chat"
    // Matches: colon/comma, optional space, bare word, closing quote
    const bareStringPattern = /([:,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(")/g;
    repaired = repaired.replace(
      bareStringPattern,
      (_full: string, prefix: string, word: string, closeQuote: string) => {
        if (word === "true" || word === "false" || word === "null") return _full;
        if (/^\d/.test(word)) return _full;
        return `${prefix}"${word}${closeQuote}`;
      },
    );

    // Fix 2: remove orphan quote after a properly-quoted value end
    // "friendly"}" → "friendly"}  (hallucinated extra quote after structural char)
    repaired = repaired.replace(
      /([a-zA-Z0-9_]"\s*[}\]])(")/g,
      (_full: string, before: string, _orphan: string) => before,
    );

    // Fix 3: trailing comma before } or ]
    repaired = repaired.replace(/,(\s*)([}\]])/g, "$1$2");

    return repaired;
  }

  /**
   * Extract a speech-only ValidatedAgentOutput from raw LLM text buffer.
   * Used as a last resort when JSON repair also fails.
   * Returns null if no recognizable speech text is found.
   */
  private extractSpeechFromBuffer(): ValidatedAgentOutput | null {
    const raw = this.buffer;

    // Try to find "text": "..." or "text "..." (missing colon) in the raw buffer
    const textMatch = raw.match(/"text"\s*:?\s*"((?:[^"\\]|\\.)*)"/);
    if (textMatch && textMatch[1].trim()) {
      const extracted = textMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, " ")
        .trim()
        .slice(0, 200);

      if (extracted.length >= 2) {
        return {
          intent: "chat",
          speech: { text: extracted, tone: "neutral" },
          actions: [],
          internal_state: { mood: "neutral", confidence: 0.3, energy: 0.5 },
        };
      }
    }

    // Fallback: extract CJK sentences, strip JSON field-name noise.
    // Only trigger when the text contains CJK characters.
    const cjkChars = raw.match(/[\p{Script=Han}]/gu);
    if (!cjkChars || cjkChars.length < 2) return null;

    // Strip known JSON field names and structural noise
    const fieldNoise = /\b(intent|speech|text|tone|mood|type|name|reason|target|actions|internal_state|confidence|energy|friendly|neutral|excited|happy|chat|id|playerName)\b\s*:?\s*/gi;
    let cleaned = raw
      .replace(fieldNoise, " ")
      .replace(/[{}[\]"'",:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Extract CJK text spans
    const cjkSpans = cleaned.match(/[\p{Script=Han}\p{P}\s]+/gu);
    if (cjkSpans) {
      cleaned = cjkSpans.join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
    }

    if (cleaned.length >= 4) {
      return {
        intent: "chat",
        speech: { text: cleaned, tone: "neutral" },
        actions: [],
        internal_state: { mood: "neutral", confidence: 0.2, energy: 0.5 },
      };
    }

    return null;
  }

  // ─── Malformed Detection ────────────────────────────

  /**
   * Heuristic: check if the extracted JSON is definitively malformed
   * (as opposed to incomplete — still collecting chunks).
   */
  private isDefinitivelyMalformed(obj: Record<string, unknown>): boolean {
    // If actions field is present but not an array — definitively wrong
    if (obj.actions !== undefined && !Array.isArray(obj.actions)) {
      return true;
    }

    // If the JSON contains fields that clearly aren't part of AgentOutput
    // and suggest the LLM is outputting free text disguised as JSON
    const knownFields = new Set([
      "speech", "actions", "memory_save", "task_update", "internal_state",
    ]);
    const keys = Object.keys(obj);
    const unknownKeys = keys.filter((k) => !knownFields.has(k));

    // If more than 3 unknown fields, likely hallucinated structure
    if (unknownKeys.length > 3) {
      return true;
    }

    // Check for obvious free-text injection in key positions
    if (typeof obj.actions === "string" && (obj.actions as string).length > 1000) {
      return true; // actions is a giant string — not our schema
    }

    return false;
  }
}

// ─── Convenience Function ────────────────────────────

/**
 * Parse a complete (non-streaming) response from the LLM.
 * Use this for testing or non-streaming fallback paths.
 */
export function parseAgentOutput(text: string): SchemaValidationResult {
  const parser = new StreamParser();
  const result = parser.feed(text);
  const final = result.state === "done" ? result : parser.finalize();

  if (final.output) {
    return { valid: true, data: final.output, errors: [] };
  }

  return {
    valid: false,
    errors: [{
      path: "root",
      message: final.error || "Failed to parse AgentOutput",
      code: "parse_failed",
    }],
  };
}
