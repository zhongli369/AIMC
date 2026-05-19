export { SYSTEM_PROMPT } from "./system.js";
export { SAFETY_POLICY_PROMPT } from "./safety.js";
export { BEHAVIOR_PROMPT } from "./behavior.js";
export { INTENT_FORMAT_PROMPT } from "./intent-format.js";
/** Full assembled system prompt for the LLM. */
export declare function buildSystemPrompt(): string;
/** Estimate token count (rough: ~4 chars per token for English). */
export declare function estimateTokens(text: string): number;
//# sourceMappingURL=index.d.ts.map