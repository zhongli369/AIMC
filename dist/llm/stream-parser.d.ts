/**
 * StreamParser — incremental JSON reconstruction from LLM streaming output.
 * Handles: partial chunks, markdown fences, hallucinated text, truncated streams.
 * Only emits complete, validated AgentOutput objects.
 */
import { type ValidatedAgentOutput } from "../runtime/intent-schema.js";
import type { SchemaValidationResult } from "../runtime/intent-schema.js";
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
export declare class StreamParser {
    private buffer;
    private state;
    private result;
    private totalChunks;
    /**
     * Feed a text chunk from the LLM stream.
     * Returns the current parser result after processing the chunk.
     */
    feed(chunk: string): ParserResult;
    /**
     * Called when the LLM stream ends. Makes a best-effort attempt
     * to extract valid JSON from whatever was received.
     */
    finalize(): ParserResult;
    reset(): void;
    getBuffer(): string;
    getState(): ParserState;
    /**
     * Try to find a complete JSON object in the buffer.
     * Handles common LLM wrapping patterns:
     * - ```json ... ``` fences
     * - Leading prose before JSON
     * - Trailing text after JSON
     */
    private tryExtractJson;
    /**
     * Extract the outermost complete { } object from text.
     * Uses depth tracking with string and escape awareness.
     */
    private extractBraceObject;
    private stripMarkdownFences;
    /**
     * Apply conservative repairs to malformed LLM JSON output.
     * Only fixes structural issues — never changes semantic content.
     * Safe: repairs only enable JSON.parse to succeed; Zod still validates.
     */
    private repairJson;
    /**
     * Extract a speech-only ValidatedAgentOutput from raw LLM text buffer.
     * Used as a last resort when JSON repair also fails.
     * Returns null if no recognizable speech text is found.
     */
    private extractSpeechFromBuffer;
    /**
     * Heuristic: check if the extracted JSON is definitively malformed
     * (as opposed to incomplete — still collecting chunks).
     */
    private isDefinitivelyMalformed;
}
/**
 * Parse a complete (non-streaming) response from the LLM.
 * Use this for testing or non-streaming fallback paths.
 */
export declare function parseAgentOutput(text: string): SchemaValidationResult;
//# sourceMappingURL=stream-parser.d.ts.map