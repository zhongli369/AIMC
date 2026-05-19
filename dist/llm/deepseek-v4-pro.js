/**
 * DeepSeekV4Pro — streaming LLM client for DeepSeek API (OpenAI-compatible).
 *
 * Features:
 * - Streaming SSE response parsing
 * - AbortController cancellation
 * - Retry (max 2) with exponential backoff
 * - Hard timeout (3-6 seconds)
 * - JSON-only enforcement via stream parser
 * - Fallback idle intent on any failure
 */
import { StreamParser } from "./stream-parser.js";
const DEFAULT_CONFIG = {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    timeoutMs: 6000,
    maxRetries: 2,
    temperature: 0.3,
    maxTokens: 1024,
};
// ─── Fallback Idle Intent ────────────────────────────
export const FALLBACK_IDLE_OUTPUT = {
    intent: "chat",
    actions: [
        {
            id: "fallback-idle",
            type: "wait",
            target: { ms: 1000 },
            priority: 1,
            reason: "Fallback safe state — LLM pipeline failed",
        },
    ],
    internal_state: { mood: "neutral", confidence: 0.0, energy: 0.5 },
};
// ─── Client ──────────────────────────────────────────
export class DeepSeekV4Pro {
    config;
    abortController = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ─── Public API ────────────────────────────────────
    /**
     * Send messages and get a validated AgentOutput.
     * This is the primary method — handles streaming, parsing, validation, retry.
     */
    async generate(messages, options) {
        const startTime = Date.now();
        let lastError = "";
        // Create internal abort controller (can be triggered by timeout or external signal)
        this.abortController = new AbortController();
        // Forward external abort signal
        if (options?.signal) {
            options.signal.addEventListener("abort", () => {
                this.abortController?.abort();
            });
        }
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            // Check if already aborted
            if (this.abortController.signal.aborted) {
                return {
                    success: false,
                    output: FALLBACK_IDLE_OUTPUT,
                    error: "Request cancelled",
                    timedOut: false,
                    cancelled: true,
                    retriesUsed: attempt,
                    latencyMs: Date.now() - startTime,
                };
            }
            try {
                const result = await this.singleRequest(messages);
                const latency = Date.now() - startTime;
                if (result.success) {
                    return {
                        success: true,
                        output: result.output,
                        rawJson: result.rawJson,
                        retriesUsed: attempt,
                        latencyMs: latency,
                        timedOut: false,
                        cancelled: false,
                        tokensUsed: result.tokensUsed,
                    };
                }
                lastError = result.error || "Unknown error";
                // Don't retry if it was a schema validation failure (retrying won't fix it)
                if (result.error?.includes("schema")) {
                    break;
                }
            }
            catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
                // Don't retry on abort
                if (this.abortController.signal.aborted) {
                    break;
                }
            }
            // Wait before retry
            if (attempt < this.config.maxRetries) {
                const delay = Math.min(500 * Math.pow(2, attempt), 2000);
                await new Promise((r) => {
                    const timer = setTimeout(() => r(), delay);
                    this.abortController.signal.addEventListener("abort", () => {
                        clearTimeout(timer);
                        r();
                    });
                });
            }
        }
        // All attempts failed — return fallback
        return {
            success: false,
            output: FALLBACK_IDLE_OUTPUT,
            error: lastError || "All retries exhausted",
            timedOut: lastError.includes("timeout"),
            cancelled: this.abortController.signal.aborted,
            retriesUsed: this.config.maxRetries + 1,
            latencyMs: Date.now() - startTime,
        };
    }
    /**
     * Cancel any in-flight request.
     */
    cancel() {
        this.abortController?.abort();
    }
    // ─── Single Request ────────────────────────────────
    async singleRequest(messages) {
        const timeoutMs = this.config.timeoutMs;
        const timeoutId = setTimeout(() => this.abortController?.abort(), timeoutMs);
        try {
            const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.config.apiKey}`,
                    "Accept": "text/event-stream",
                },
                body: JSON.stringify({
                    model: this.config.model,
                    messages,
                    stream: true,
                    temperature: this.config.temperature,
                    max_tokens: this.config.maxTokens,
                    response_format: { type: "json_object" },
                }),
                signal: this.abortController.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
                };
            }
            // Read streaming response
            const parser = new StreamParser();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const streamTimeoutMs = 15000;
            let streamTimer = setTimeout(() => {
                this.abortController?.abort();
            }, streamTimeoutMs);
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    // Reset stream timeout on each chunk
                    if (streamTimer)
                        clearTimeout(streamTimer);
                    streamTimer = setTimeout(() => {
                        this.abortController?.abort();
                    }, streamTimeoutMs);
                    const text = decoder.decode(value, { stream: true });
                    // Parse SSE chunks: extract "delta"."content" from each line
                    const chunks = this.parseSSEChunks(text);
                    for (const chunk of chunks) {
                        const feedResult = parser.feed(chunk);
                        // Early termination: valid JSON found, stop streaming
                        if (feedResult.state === "done") {
                            reader.cancel().catch(() => { });
                            break;
                        }
                    }
                    if (parser.getState() === "done")
                        break;
                }
            }
            catch {
                // Stream read error — try to parse what we have
            }
            finally {
                if (streamTimer)
                    clearTimeout(streamTimer);
            }
            // Release reader lock
            try {
                reader.releaseLock();
            }
            catch { /* already released */ }
            // Finalize and get result
            const finalResult = parser.finalize();
            if (finalResult.state === "done" && finalResult.output) {
                return {
                    success: true,
                    output: finalResult.output,
                    rawJson: finalResult.rawJson,
                };
            }
            return {
                success: false,
                error: finalResult.error || "Stream completed without valid AgentOutput JSON",
            };
        }
        catch (err) {
            clearTimeout(timeoutId);
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("abort") || msg.includes("AbortError")) {
                return {
                    success: false,
                    error: `Request timed out after ${timeoutMs}ms`,
                };
            }
            return { success: false, error: msg };
        }
    }
    // ─── SSE Parser ────────────────────────────────────
    /**
     * Parse Server-Sent Events chunks from DeepSeek streaming response.
     * Extracts content deltas from: data: {"choices":[{"delta":{"content":"..."}}]}
     */
    parseSSEChunks(raw) {
        const chunks = [];
        const lines = raw.split("\n");
        for (const line of lines) {
            if (!line.startsWith("data: "))
                continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]")
                continue;
            try {
                const parsed = JSON.parse(data);
                const content = parsed?.choices?.[0]?.delta?.content;
                if (typeof content === "string") {
                    chunks.push(content);
                }
            }
            catch {
                // Skip unparseable SSE lines
            }
        }
        return chunks;
    }
}
//# sourceMappingURL=deepseek-v4-pro.js.map