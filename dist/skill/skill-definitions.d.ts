/**
 * Skill definitions — built-in skills that compose IntentActions for common tasks.
 * Each skill is a named, parameterized action-sequence generator.
 */
import type { IntentAction } from "../interfaces/intent.js";
import type { BotState } from "../interfaces/minecraft.js";
export type SkillCategory = "movement" | "combat" | "gathering" | "building" | "social" | "utility";
export interface SkillContext {
    botState: BotState | null;
    nearbyEntities: string[];
    nearbyPlayers: string[];
    nearbyHostiles: string[];
}
export interface SkillDefinition {
    name: string;
    description: string;
    category: SkillCategory;
    /** Whether this skill supports retry on execution failure. Default true. */
    retryable?: boolean;
    /** Fallback skill name if this skill fails all retries. */
    fallback?: string;
    /** Generate the sequence of IntentActions from parameters and context. */
    plan(params: Record<string, unknown>, ctx: SkillContext): IntentAction[];
}
export declare const BUILTIN_SKILLS: SkillDefinition[];
//# sourceMappingURL=skill-definitions.d.ts.map