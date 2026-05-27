import type { ValidatedAgentOutput } from "../runtime/intent-schema.js";
import type { LLMMessage } from "./context-assembler.js";
export interface DeepSeekConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    /** Hard timeout for entire request (ms) */
    timeoutMs: number;
    /** Max retries after initial attempt */
    maxRetries: number;
    /** Temperature for JSON mode */
    temperature: number;
    /** Max output tokens */
    maxTokens: number;
    /** Whether the provider supports response_format json_object (default true) */
    supportsJsonFormat?: boolean;
}
export interface DeepSeekResult {
    success: boolean;
    output?: ValidatedAgentOutput;
    rawJson?: string;
    error?: string;
    timedOut: boolean;
    cancelled: boolean;
    retriesUsed: number;
    latencyMs: number;
    tokensUsed?: number;
}
export declare const FALLBACK_IDLE_OUTPUT: ValidatedAgentOutput;
export declare class DeepSeekV4Pro {
    private config;
    private abortController;
    constructor(config: DeepSeekConfig);
    /**
     * Send messages and get a validated AgentOutput.
     * This is the primary method — handles streaming, parsing, validation, retry.
     */
    generate(messages: LLMMessage[], options?: {
        signal?: AbortSignal;
    }): Promise<DeepSeekResult>;
    /**
     * Cancel any in-flight request.
     */
    cancel(): void;
    private singleRequest;
    /**
     * Parse Server-Sent Events chunks from DeepSeek streaming response.
     * Extracts content deltas from: data: {"choices":[{"delta":{"content":"..."}}]}
     */
    private parseSSEChunks;
}
//# sourceMappingURL=deepseek-v4-pro.d.ts.map