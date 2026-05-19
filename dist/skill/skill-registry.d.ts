/**
 * SkillRegistry — central registry for all skills.
 * Supports register, lookup, list, and plan-generation.
 */
import type { IntentAction } from "../interfaces/intent.js";
import type { SkillDefinition, SkillContext } from "./skill-definitions.js";
export type { SkillDefinition, SkillContext, SkillCategory } from "./skill-definitions.js";
export declare class SkillRegistry {
    private skills;
    constructor();
    /** Register a new skill or override an existing one. */
    register(skill: SkillDefinition): void;
    /** Get a skill by name. */
    get(name: string): SkillDefinition | undefined;
    /** List all registered skill names. */
    list(): string[];
    /** List all skills with metadata. */
    listAll(): Array<{
        name: string;
        description: string;
        category: string;
    }>;
    /**
     * Generate IntentActions for a named skill with given params and context.
     * Returns empty array if skill not found.
     */
    plan(name: string, params: Record<string, unknown>, ctx: SkillContext): IntentAction[];
    /**
     * Get the fallback skill for a given skill name.
     * Returns undefined if the skill has no fallback or doesn't exist.
     */
    getFallback(name: string): string | undefined;
    /**
     * Check if a skill supports retry on execution failure.
     * Defaults to true if not explicitly set.
     */
    isRetryable(name: string): boolean;
    /**
     * Resolve the fallback chain. Returns the final fallback skill
     * or undefined if no fallback is configured.
     * Max depth: 2 hops (prevents infinite loops).
     */
    resolveFallback(name: string, maxDepth?: number): string | undefined;
}
//# sourceMappingURL=skill-registry.d.ts.map