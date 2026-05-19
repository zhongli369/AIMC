import type { AgentCore } from "../agent/agent-core.js";
export interface STTAdapterConfig {
    /** Minimum confidence threshold to accept transcript (0–1) */
    minConfidence: number;
    /** Auto-capitalize first letter of transcript */
    autoCapitalize: boolean;
    /** Trim whitespace from transcript */
    trim: boolean;
    /** Max transcript length (characters) */
    maxLength: number;
}
export declare class SpeechToTextAdapter {
    private config;
    private agentCore;
    constructor(config?: Partial<STTAdapterConfig>);
    /** Wire to AgentCore for direct input injection. */
    setAgentCore(core: AgentCore): void;
    /**
     * Process a raw transcript from STT engine.
     * Normalizes, validates, and routes through the chat pipeline.
     *
     * Path: transcript → validate → voice:input event → AgentCore.think()
     * This IS the existing chat pipeline — just with a different source.
     */
    handleTranscript(rawText: string, source?: "microphone" | "push_to_talk"): Promise<void>;
    private normalize;
}
//# sourceMappingURL=speech-to-text.d.ts.map