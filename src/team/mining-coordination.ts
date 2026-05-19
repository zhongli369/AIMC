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

import type { IntentAction } from "../interfaces/intent.js";
import { randomUUID } from "node:crypto";

// ─── Mining Context ─────────────────────────────────────

export interface MiningContext {
  /** Player's current target block */
  playerTargetBlock?: string;
  /** Blocks the player recently mined */
  recentlyMinedBlocks: string[];
  /** Ore blocks visible within 8 blocks */
  visibleOres: { type: string; distance: number; exposed: boolean }[];
  /** Stone/deepslate blocks within 5 blocks */
  nearbyStoneCount: number;
  /** Direction player is primarily mining */
  playerMiningDirection?: "north" | "south" | "east" | "west" | "up" | "down" | "horizontal";
  /** Whether there are side tunnels/passages */
  sideTunnels: { direction: string; distance: number }[];
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

// ─── Config ─────────────────────────────────────────────

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

const DEFAULT_MINING_CONFIG: MiningCoordinationConfig = {
  minDistanceFromPlayerTarget: 2,
  maxComplementaryDistance: 16,
  preferredOreOrder: [
    "diamond_ore", "deepslate_diamond_ore",
    "emerald_ore", "deepslate_emerald_ore",
    "ancient_debris",
    "gold_ore", "deepslate_gold_ore",
    "iron_ore", "deepslate_iron_ore",
    "lapis_ore", "deepslate_lapis_ore",
    "redstone_ore", "deepslate_redstone_ore",
    "copper_ore", "deepslate_copper_ore",
    "coal_ore", "deepslate_coal_ore",
  ],
  lavaWarnDistance: 5,
  lowLightThreshold: 7,
  maxComplementaryBlocks: 8,
};

// ─── Mining Plan ────────────────────────────────────────

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

// ─── Coordinator ────────────────────────────────────────

export class MiningCoordinator {
  private config: MiningCoordinationConfig;
  private blocksMinedThisCycle = 0;
  private lastPlayerTargetBlock = "";
  private cycleResetTime = 0;

  constructor(config?: Partial<MiningCoordinationConfig>) {
    this.config = { ...DEFAULT_MINING_CONFIG, ...config };
  }

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
  } {
    let pattern: ReturnType<typeof this.analyzeMiningPattern>["pattern"] = "unknown";
    let confidence = 0.3;

    // Branch mining: consistent direction, mostly stone/deepslate
    if (context.playerMiningDirection
        && context.nearbyStoneCount > 20
        && context.visibleOres.length < 3
        && context.recentlyMinedBlocks.length >= 5) {
      pattern = context.playerMiningDirection === "horizontal" ? "branch_mining" : "strip_mining";
      confidence = 0.7;
    }

    // Cave exploration: varied direction, many exposed ores
    if (context.visibleOres.filter((o) => o.exposed).length >= 4 && context.sideTunnels.length > 0) {
      pattern = "cave_exploration";
      confidence = 0.75;
    }

    // Ore targeting: player going after specific ores
    if (context.playerTargetBlock && /ore|diamond|emerald|ancient_debris/i.test(context.playerTargetBlock)) {
      pattern = "ore_targeting";
      confidence = 0.8;
    }

    // Clearing: mining lots of different blocks
    if (context.recentlyMinedBlocks.length >= 10 && context.visibleOres.length >= 3) {
      pattern = "clearing";
      confidence = 0.6;
    }

    // Determine suggested role
    let suggestedRole: "assist" | "guard" | "side_tunnel" | "collect" | "wait" = "assist";

    if (context.hostilesNearby) {
      suggestedRole = "guard";
    } else if (context.sideTunnels.length > 0 && pattern === "branch_mining") {
      suggestedRole = "side_tunnel";
    } else if (context.lavaNearby || context.waterNearby) {
      suggestedRole = "guard"; // Watch for hazards
    } else if (context.visibleOres.filter((o) => o.distance > 3).length > 0) {
      suggestedRole = "collect";
    } else if (pattern === "cave_exploration" || pattern === "ore_targeting") {
      suggestedRole = "assist";
    } else {
      suggestedRole = "wait";
    }

    return { pattern, suggestedRole, confidence };
  }

  /**
   * Choose a complementary mining task that doesn't conflict
   * with what the player is mining.
   */
  chooseComplementaryMiningTask(context: MiningContext): ComplementaryMiningTask | null {
    const analysis = this.analyzeMiningPattern(context);

    // Reset block counter periodically (every 30s)
    if (Date.now() - this.cycleResetTime > 30000) {
      this.blocksMinedThisCycle = 0;
      this.cycleResetTime = Date.now();
    }

    // Priority 1: Warn about hazards
    if (context.lavaNearby) {
      return {
        action: "warn_hazard",
        target: "lava",
        priority: 5,
        reason: "Lava detected nearby — warning player",
      };
    }

    // Priority 2: Guard if hostiles
    if (context.hostilesNearby && analysis.suggestedRole === "guard") {
      return {
        action: "wait_guard",
        target: "nearby_area",
        priority: 5,
        reason: "Hostiles nearby — standing guard",
      };
    }

    // Priority 3: Place torch if too dark
    if (context.lightLevel < this.config.lowLightThreshold) {
      return {
        action: "place_torch",
        target: "dark_area",
        priority: 3,
        reason: `Light level ${context.lightLevel} — placing torch`,
      };
    }

    // Priority 4: Mine nearby ores (not the player's target)
    if (this.blocksMinedThisCycle < this.config.maxComplementaryBlocks) {
      const availableOres = context.visibleOres
        .filter((o) => {
          // Don't mine the player's current target
          if (context.playerTargetBlock && o.type.includes(context.playerTargetBlock.replace("_ore", ""))) {
            return o.distance > this.config.minDistanceFromPlayerTarget;
          }
          return true;
        })
        .sort((a, b) => {
          const aIdx = this.config.preferredOreOrder.indexOf(a.type);
          const bIdx = this.config.preferredOreOrder.indexOf(b.type);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });

      if (availableOres.length > 0) {
        this.blocksMinedThisCycle++;
        const ore = availableOres[0];
        return {
          action: "mine_ore",
          target: ore.type,
          priority: 4,
          reason: `Complementary mining: ${ore.type} at ${ore.distance.toFixed(0)}m`,
        };
      }
    }

    // Priority 5: Explore side tunnels (if branching)
    if (analysis.suggestedRole === "side_tunnel" && context.sideTunnels.length > 0
        && this.blocksMinedThisCycle < this.config.maxComplementaryBlocks) {
      const tunnel = context.sideTunnels[0];
      this.blocksMinedThisCycle += 2;
      return {
        action: "explore_side_tunnel",
        target: tunnel.direction,
        priority: 2,
        reason: `Checking side tunnel to the ${tunnel.direction}`,
      };
    }

    // Priority 6: Collect drops near player
    if (analysis.suggestedRole === "collect") {
      return {
        action: "collect_drops",
        target: "nearby_items",
        priority: 1,
        reason: "Collecting dropped items near player",
      };
    }

    return null;
  }

  /**
   * Detect dangerous mining situations that require intervention.
   */
  detectDangerousMiningSituation(context: MiningContext): {
    danger: boolean;
    dangerType?: "lava" | "water" | "gravel_fall" | "hostiles" | "low_health_mining" | "digging_straight_down" | "digging_straight_up";
    severity: number; // 1–5
    warningMessage?: string;
  } {
    // Lava nearby
    if (context.lavaNearby) {
      return {
        danger: true,
        dangerType: "lava",
        severity: 4,
        warningMessage: "小心！附近有岩浆！",
      };
    }

    // Water nearby (could flood)
    if (context.waterNearby && context.playerMiningDirection === "up") {
      return {
        danger: true,
        dangerType: "water",
        severity: 3,
        warningMessage: "注意头顶可能有水！",
      };
    }

    // Hostiles while mining
    if (context.hostilesNearby) {
      return {
        danger: true,
        dangerType: "hostiles",
        severity: 4,
        warningMessage: "附近有怪物！先解决它们再挖矿。",
      };
    }

    // Low light
    if (context.lightLevel < 4) {
      return {
        danger: true,
        dangerType: "hostiles",
        severity: 2,
        warningMessage: "光线太暗了，插个火把吧。",
      };
    }

    return { danger: false, severity: 0 };
  }

  /** Reset block counter (call when changing areas). */
  resetCycle(): void {
    this.blocksMinedThisCycle = 0;
    this.cycleResetTime = Date.now();
  }
}
