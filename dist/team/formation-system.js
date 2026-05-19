/**
 * FormationSystem — dynamic squad positioning (Phase 4-F).
 *
 * Manages companion positioning relative to player.
 * ADVISORY ONLY — all movement still flows through SkillRouter.
 *
 * Formation modes: follow_close, follow_loose, flank_left, flank_right,
 *                  rear_guard, scout_ahead
 *
 * MUST NOT:
 *   - Execute movement directly
 *   - Bypass SkillRouter
 *   - Access bot.*() directly
 */
const DEFAULT_FORMATION_CONFIG = {
    defaultFormation: "follow_loose",
    minDistance: 1.5,
    maxDistance: 32,
    evaluationIntervalMs: 2000,
    avoidBlockingLoS: true,
};
// ─── Formation Positions ────────────────────────────────
const FORMATION_POSITIONS = {
    follow_close: {
        offsetX: 0,
        offsetZ: -2,
        relativeToFacing: true,
        toleranceRadius: 1.0,
    },
    follow_loose: {
        offsetX: 0,
        offsetZ: -5,
        relativeToFacing: true,
        toleranceRadius: 2.0,
    },
    flank_left: {
        offsetX: -4,
        offsetZ: 2,
        relativeToFacing: true,
        toleranceRadius: 1.5,
    },
    flank_right: {
        offsetX: 4,
        offsetZ: 2,
        relativeToFacing: true,
        toleranceRadius: 1.5,
    },
    rear_guard: {
        offsetX: 0,
        offsetZ: 4,
        relativeToFacing: true,
        toleranceRadius: 1.5,
    },
    scout_ahead: {
        offsetX: 0,
        offsetZ: -12,
        relativeToFacing: true,
        toleranceRadius: 3.0,
    },
};
// ─── System ──────────────────────────────────────────────
export class FormationSystem {
    currentFormation;
    config;
    lastEvaluation = 0;
    formationHistory = [];
    constructor(config) {
        this.config = { ...DEFAULT_FORMATION_CONFIG, ...config };
        this.currentFormation = this.config.defaultFormation;
    }
    // ─── Formation Mode ────────────────────────────────
    getCurrentFormation() {
        return this.currentFormation;
    }
    /**
     * Update formation mode based on context.
     * Returns the new formation and whether it changed.
     */
    updateFormationMode(params) {
        const previous = this.currentFormation;
        let newFormation = this.currentFormation;
        // Priority-ordered formation selection
        if (params.teamMode === "combat" || params.hostilesNearby) {
            // Combat: flank formation for tactical coverage
            newFormation = Math.random() < 0.5 ? "flank_left" : "flank_right";
        }
        else if (params.teamMode === "retreat") {
            // Retreat: rear guard to cover withdrawal
            newFormation = "rear_guard";
        }
        else if (params.predictedIntent === "mining") {
            // Mining: close follow for guarding
            newFormation = params.isUnderground ? "follow_close" : "flank_left";
        }
        else if (params.predictedIntent === "exploration") {
            // Exploration: scout ahead or loose follow
            newFormation = params.familiarityLevel > 50 ? "scout_ahead" : "follow_loose";
        }
        else if (params.predictedIntent === "building") {
            // Building: loose follow, stay out of the way
            newFormation = "follow_loose";
        }
        else if (params.predictedIntent === "travel") {
            // Travel: flank for wider view
            newFormation = "flank_right";
        }
        else if (params.playerHealth < 8) {
            // Player vulnerable: close follow, protective
            newFormation = "follow_close";
        }
        const changed = newFormation !== previous;
        if (changed) {
            this.currentFormation = newFormation;
            this.formationHistory.push({
                mode: newFormation,
                timestamp: Date.now(),
                reason: `Context: ${params.teamMode}/${params.predictedIntent}`,
            });
            // Keep history bounded
            if (this.formationHistory.length > 50) {
                this.formationHistory = this.formationHistory.slice(-30);
            }
        }
        this.lastEvaluation = Date.now();
        return { formation: newFormation, changed };
    }
    /**
     * Get the desired position offset given current formation.
     * Returns the ideal offset from the player.
     */
    getDesiredFormationPosition(formation) {
        const mode = formation ?? this.currentFormation;
        const base = FORMATION_POSITIONS[mode];
        const distance = Math.sqrt(base.offsetX ** 2 + base.offsetZ ** 2);
        return { ...base, distance };
    }
    /**
     * Determine if the companion should regroup (move closer to player).
     */
    shouldRegroup(params) {
        // Always regroup if in danger and far
        if (params.isInDanger && params.currentDistanceToPlayer > 16) {
            return true;
        }
        // Regroup if exceeded max distance
        if (params.currentDistanceToPlayer > this.config.maxDistance) {
            return true;
        }
        // Check formation-specific distance
        const pos = FORMATION_POSITIONS[params.formation];
        const desiredDist = Math.sqrt(pos.offsetX ** 2 + pos.offsetZ ** 2);
        const threshold = desiredDist + pos.toleranceRadius + 5;
        return params.currentDistanceToPlayer > threshold;
    }
    /**
     * Check if companion is too close to player (blocking).
     */
    isTooClose(currentDistanceToPlayer) {
        return currentDistanceToPlayer < this.config.minDistance;
    }
    /**
     * Whether the companion should adjust position to avoid blocking.
     */
    shouldAvoidBlocking(params) {
        if (!this.config.avoidBlockingLoS)
            return false;
        // If very close and roughly in front of player → blocking
        return params.distanceToPlayer < 3
            && params.botRelativeAngle !== undefined
            && Math.abs(params.botRelativeAngle) < Math.PI / 3; // ±60°
    }
    /** Get formation change history. */
    getFormationHistory() {
        return this.formationHistory;
    }
    /** Reset formation to default. */
    reset() {
        this.currentFormation = this.config.defaultFormation;
    }
}
//# sourceMappingURL=formation-system.js.map