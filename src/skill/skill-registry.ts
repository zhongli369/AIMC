/**
 * SkillRegistry — central registry for all skills.
 * Supports register, lookup, list, and plan-generation.
 */
import type { IntentAction } from "../interfaces/intent.js";
import type { SkillDefinition, SkillContext } from "./skill-definitions.js";
import { BUILTIN_SKILLS } from "./skill-definitions.js";

export type { SkillDefinition, SkillContext, SkillCategory } from "./skill-definitions.js";

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  constructor() {
    for (const skill of BUILTIN_SKILLS) {
      this.register(skill);
    }
  }

  /** Register a new skill or override an existing one. */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  /** Get a skill by name. */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /** List all registered skill names. */
  list(): string[] {
    return [...this.skills.keys()];
  }

  /** List all skills with metadata. */
  listAll(): Array<{ name: string; description: string; category: string }> {
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
  plan(name: string, params: Record<string, unknown>, ctx: SkillContext): IntentAction[] {
    const skill = this.skills.get(name);
    if (!skill) return [];
    return skill.plan(params, ctx);
  }

  /**
   * Get the fallback skill for a given skill name.
   * Returns undefined if the skill has no fallback or doesn't exist.
   */
  getFallback(name: string): string | undefined {
    const skill = this.skills.get(name);
    return skill?.fallback;
  }

  /**
   * Check if a skill supports retry on execution failure.
   * Defaults to true if not explicitly set.
   */
  isRetryable(name: string): boolean {
    const skill = this.skills.get(name);
    return skill?.retryable !== false;
  }

  /**
   * Resolve the fallback chain. Returns the final fallback skill
   * or undefined if no fallback is configured.
   * Max depth: 2 hops (prevents infinite loops).
   */
  resolveFallback(name: string, maxDepth = 2): string | undefined {
    let current = name;
    for (let i = 0; i < maxDepth; i++) {
      const fb = this.getFallback(current);
      if (!fb || fb === current) return i === 0 ? undefined : current;
      current = fb;
    }
    return current;
  }
}
