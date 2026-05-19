/**
 * StreamParser — incremental JSON reconstruction from LLM streaming output.
 * Handles: partial chunks, markdown fences, hallucinated text, truncated streams.
 * Only emits complete, validated AgentOutput objects.
 */
import { AgentOutputSchema } from "../runtime/intent-schema.js";
// ─── Parser ──────────────────────────────────────────
export class StreamParser {
    buffer = "";
    state = "waiting_for_json";
    result = null;
    totalChunks = 0;
    // ─── Feed chunk ────────────────────────────────────
    /**
     * Feed a text chunk from the LLM stream.
     * Returns the current parser result after processing the chunk.
     */
    feed(chunk) {
        if (this.state === "done" || this.state === "error") {
            return this.result;
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
                    output: validation.data,
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
    finalize() {
        if (this.state === "done" || this.state === "error") {
            return this.result;
        }
        // Last-resort extraction: try to find ANY valid JSON object
        const extracted = this.tryExtractJson();
        if (extracted) {
            const validation = AgentOutputSchema.safeParse(extracted);
            if (validation.success) {
                this.state = "done";
                this.result = {
                    state: "done",
                    output: validation.data,
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
                    output: validation.data,
                    rawJson: this.buffer.trim(),
                    earlyTermination: false,
                };
                return this.result;
            }
        }
        catch {
            // Not valid JSON
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
    reset() {
        this.buffer = "";
        this.state = "waiting_for_json";
        this.result = null;
        this.totalChunks = 0;
    }
    getBuffer() {
        return this.buffer;
    }
    getState() {
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
    tryExtractJson() {
        let text = this.buffer;
        // Strip markdown code fences
        text = this.stripMarkdownFences(text);
        // Strategy 1: Find the outermost { } pair in the stripped text
        const braceObject = this.extractBraceObject(text);
        if (braceObject) {
            try {
                return JSON.parse(braceObject);
            }
            catch {
                // Not valid JSON yet — continue collecting
            }
        }
        // Strategy 2: Try parsing the whole stripped text as-is
        try {
            return JSON.parse(text);
        }
        catch {
            // Not valid JSON yet
        }
        // Strategy 3: Try parsing the raw buffer (with fences stripped)
        const raw = this.stripMarkdownFences(this.buffer);
        if (raw !== text) {
            try {
                return JSON.parse(raw);
            }
            catch {
                // Not valid
            }
        }
        return null;
    }
    // ─── Brace Extraction ──────────────────────────────
    /**
     * Extract the outermost complete { } object from text.
     * Uses depth tracking with string and escape awareness.
     */
    extractBraceObject(text) {
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
            if (inString)
                continue;
            if (ch === "{") {
                if (depth === 0)
                    start = i;
                depth++;
            }
            else if (ch === "}") {
                depth--;
                if (depth === 0 && start >= 0) {
                    return text.slice(start, i + 1);
                }
            }
        }
        return null;
    }
    // ─── Markdown Fence Removal ────────────────────────
    stripMarkdownFences(text) {
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
    // ─── Malformed Detection ────────────────────────────
    /**
     * Heuristic: check if the extracted JSON is definitively malformed
     * (as opposed to incomplete — still collecting chunks).
     */
    isDefinitivelyMalformed(obj) {
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
        if (typeof obj.actions === "string" && obj.actions.length > 1000) {
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
export function parseAgentOutput(text) {
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
//# sourceMappingURL=stream-parser.js.map