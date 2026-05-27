/**
 * look_at_speaker reflex — bot looks at the player who just chatted.
 *
 * Does NOT consume the event — normal chat routing proceeds after.
 * Rate-limited: max 1 look per player per second.
 */
import type { ReflexBehavior } from "../reflex-manager.js";
export interface LookAtSpeakerConfig {
    rateLimitMs: number;
}
export declare function createLookAtSpeaker(config?: Partial<LookAtSpeakerConfig>): ReflexBehavior;
//# sourceMappingURL=look-at-speaker.d.ts.map