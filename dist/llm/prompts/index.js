export { SYSTEM_PROMPT } from "./system.js";
export { SAFETY_POLICY_PROMPT } from "./safety.js";
export { BEHAVIOR_PROMPT } from "./behavior.js";
export { INTENT_FORMAT_PROMPT } from "./intent-format.js";
import { SYSTEM_PROMPT } from "./system.js";
import { SAFETY_POLICY_PROMPT } from "./safety.js";
import { BEHAVIOR_PROMPT } from "./behavior.js";
import { INTENT_FORMAT_PROMPT } from "./intent-format.js";
/** Full assembled system prompt for the LLM. */
export function buildSystemPrompt() {
    return [
        SYSTEM_PROMPT,
        "",
        "---",
        "",
        SAFETY_POLICY_PROMPT,
        "",
        "---",
        "",
        BEHAVIOR_PROMPT,
        "",
        "---",
        "",
        INTENT_FORMAT_PROMPT,
    ].join("\n");
}
/** Estimate token count (rough: ~4 chars per token for English). */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
//# sourceMappingURL=index.js.map