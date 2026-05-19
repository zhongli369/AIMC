import { BUILTIN_SKILLS } from "./skill-definitions.js";
export class SkillRegistry {
    skills = new Map();
    constructor() {
        for (const skill of BUILTIN_SKILLS) {
            this.register(skill);
        }
    }
    /** Register a new skill or override an existing one. */
    register(skill) {
        this.skills.set(skill.name, skill);
    }
    /** Get a skill by name. */
    get(name) {
        return this.skills.get(name);
    }
    /** List all registered skill names. */
    list() {
        return [...this.skills.keys()];
    }
    /** List all skills with metadata. */
    listAll() {
        return [...this.skills.values()].map((s) => ({
            name: s.name,
            description: s.description,
            category: s.category,
        }));
    }
    /**
     * Generate IntentActions for a named skill with given params and context.
     * Returns empty array if skill not found.
     */
    plan(name, params, ctx) {
        const skill = this.skills.get(name);
        if (!skill)
            return [];
        return skill.plan(params, ctx);
    }
    /**
     * Get the fallback skill for a given skill name.
     * Returns undefined if the skill has no fallback or doesn't exist.
     */
    getFallback(name) {
        const skill = this.skills.get(name);
        return skill?.fallback;
    }
    /**
     * Check if a skill supports retry on execution failure.
     * Defaults to true if not explicitly set.
     */
    isRetryable(name) {
        const skill = this.skills.get(name);
        return skill?.retryable !== false;
    }
    /**
     * Resolve the fallback chain. Returns the final fallback skill
     * or undefined if no fallback is configured.
     * Max depth: 2 hops (prevents infinite loops).
     */
    resolveFallback(name, maxDepth = 2) {
        let current = name;
        for (let i = 0; i < maxDepth; i++) {
            const fb = this.getFallback(current);
            if (!fb || fb === current)
                return i === 0 ? undefined : current;
            current = fb;
        }
        return current;
    }
}
//# sourceMappingURL=skill-registry.js.map