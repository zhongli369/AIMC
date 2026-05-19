/**
 * MiningCoordination — cooperative mining rhythm (Phase 4-F).
 *
 * Natural mining cooperation behaviors:
 *   - Avoid mining same block as player
 *   - Cover side tunnels
 *   - Collect exposed ores
 *   - Watch for mobs/lava
 *   - Synchronize tunnel direction
 *   - Assist inventory overflow
 *
 * ADVISORY ONLY. All actions flow through SkillRouter.
 *
 * MUST NOT:
 *   - Independently strip mine huge areas
 *   - Ignore player location
 *   - Create autonomous mining empires
 *   - Bypass execution chain
 */
export interface MiningContext {
    /** Player's current target block */
    playerTargetBlock?: string;
    /** Blocks the player recently mined */
    recentlyMinedBlocks: string[];
    /** Ore blocks visible within 8 blocks */
    visibleOres: {
        type: string;
        distance: number;
        exposed: boolean;
    }[];
    /** Stone/deepslate blocks within 5 blocks */
    nearbyStoneCount: number;
    /** Direction player is primarily mining */
    playerMiningDirection?: "north" | "south" | "east" | "west" | "up" | "down" | "horizontal";
    /** Whether there are side tunnels/passages */
    sideTunnels: {
        direction: string;
        distance: number;
    }[];
    /** Whether there's lava nearby */
    lavaNearby: boolean;
    /** Whether there's water nearby */
    waterNearby: boolean;
    /** Hostile mobs within detection range */
    hostilesNearby: boolean;
    /** Light level at current position (0–15) */
    lightLevel: number;
    /** Whether player is using silk touch or fortune (if detectable) */
    playerHasSpecialTool: boolean;
}
export interface MiningCoordinationConfig {
    /** Min distance to stay from player's current target block */
    minDistanceFromPlayerTarget: number;
    /** Max distance to wander for complementary tasks */
    maxComplementaryDistance: number;
    /** Priority: ores to prefer collecting */
    preferredOreOrder: string[];
    /** Auto-warn about lava within this distance */
    lavaWarnDistance: number;
    /** Auto-place torch when light below this */
    lowLightThreshold: number;
    /** Max blocks to mine before returning to player */
    maxComplementaryBlocks: number;
}
export interface ComplementaryMiningTask {
    /** What to do */
    action: "mine_ore" | "explore_side_tunnel" | "place_torch" | "wait_guard" | "warn_hazard" | "collect_drops";
    /** Target description */
    target: string;
    /** Priority 1–5 */
    priority: number;
    /** Reason */
    reason: string;
}
export declare class MiningCoordinator {
    private config;
    private blocksMinedThisCycle;
    private lastPlayerTargetBlock;
    private cycleResetTime;
    constructor(config?: Partial<MiningCoordinationConfig>);
    /**
     * Analyze the player's current mining pattern.
     *
     * Returns insights about what the player is doing and
     * how the companion can best assist.
     */
    analyzeMiningPattern(context: MiningContext): {
        pattern: "branch_mining" | "strip_mining" | "cave_exploration" | "ore_targeting" | "clearing" | "unknown";
        suggestedRole: "assist" | "guard" | "side_tunnel" | "collect" | "wait";
        confidence: number;
    };
    /**
     * Choose a complementary mining task that doesn't conflict
     * with what the player is mining.
     */
    chooseComplementaryMiningTask(context: MiningContext): ComplementaryMiningTask | null;
    /**
     * Detect dangerous mining situations that require intervention.
     */
    detectDangerousMiningSituation(context: MiningContext): {
        danger: boolean;
        dangerType?: "lava" | "water" | "gravel_fall" | "hostiles" | "low_health_mining" | "digging_straight_down" | "digging_straight_up";
        severity: number;
        warningMessage?: string;
    };
    /** Reset block counter (call when changing areas). */
    resetCycle(): void;
}
//# sourceMappingURL=mining-coordination.d.ts.map