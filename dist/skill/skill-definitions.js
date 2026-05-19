// ─── Helpers ──────────────────────────────────────────
let _seq = 0;
function nextId(prefix) {
    return `${prefix}_${Date.now()}_${++_seq}`;
}
// ─── Built-in Skills ──────────────────────────────────
export const BUILTIN_SKILLS = [
    // ── Movement ────────────────────────────────────────
    {
        name: "follow_player",
        description: "Follow a player by name. Keeps within 3 blocks.",
        category: "movement",
        fallback: "explore_area",
        plan(params, ctx) {
            const playerName = params.playerName || ctx.nearbyPlayers[0];
            if (!playerName)
                return [];
            return [{
                    id: nextId("follow"),
                    type: "follow_player",
                    target: { playerName },
                    priority: 3,
                    reason: `Following player ${playerName}`,
                    timeout: 30000,
                }];
        },
    },
    {
        name: "explore_area",
        description: "Explore in a direction from current position.",
        category: "movement",
        plan(params, ctx) {
            const pos = ctx.botState?.position;
            if (!pos)
                return [];
            const dir = params.direction || "north";
            const dist = params.distance || 32;
            const dirs = {
                north: { x: 0, z: -1 }, south: { x: 0, z: 1 },
                east: { x: 1, z: 0 }, west: { x: -1, z: 0 },
            };
            const d = dirs[dir] || dirs.north;
            return [{
                    id: nextId("explore"),
                    type: "move_to",
                    target: { x: pos.x + d.x * dist, y: pos.y, z: pos.z + d.z * dist },
                    priority: 2,
                    reason: `Exploring ${dir} for ${dist} blocks`,
                    timeout: 60000,
                }];
        },
    },
    // ── Gathering ───────────────────────────────────────
    {
        name: "mine_resource",
        description: "Find and mine a specific resource block type.",
        category: "gathering",
        fallback: "explore_area",
        plan(params, _ctx) {
            const blockType = params.blockType;
            const count = params.count || 8;
            if (!blockType)
                return [];
            const actions = [];
            for (let i = 0; i < count; i++) {
                actions.push({
                    id: nextId("mine"),
                    type: "collect_block",
                    target: { blockType },
                    priority: 3,
                    reason: `Mining ${blockType} (${i + 1}/${count})`,
                    timeout: 15000,
                });
            }
            return actions;
        },
    },
    {
        name: "gather_food",
        description: "Find and collect food items. Eats if hungry.",
        category: "gathering",
        fallback: "collect_items",
        plan(_params, ctx) {
            const actions = [];
            const foodTypes = ["beef", "porkchop", "chicken", "mutton", "rabbit",
                "cod", "salmon", "bread", "apple", "carrot", "potato", "beetroot"];
            const found = foodTypes.find(() => true); // collect any food
            actions.push({
                id: nextId("food"),
                type: "collect_block",
                target: { blockType: found || "bread" },
                priority: 4,
                reason: "Gathering food",
                timeout: 20000,
            });
            if (ctx.botState && ctx.botState.food < 15) {
                actions.push({
                    id: nextId("eat"),
                    type: "consume",
                    target: { itemName: "food" },
                    priority: 5,
                    reason: `Food low (${ctx.botState.food.toFixed(0)}) — eating`,
                    timeout: 5000,
                });
            }
            return actions;
        },
    },
    {
        name: "collect_items",
        description: "Collect all nearby dropped items on the ground.",
        category: "gathering",
        plan(_params, _ctx) {
            return [{
                    id: nextId("collect"),
                    type: "collect_nearby_items",
                    target: {},
                    priority: 2,
                    reason: "Collecting nearby dropped items",
                    timeout: 10000,
                }];
        },
    },
    // ── Combat ──────────────────────────────────────────
    {
        name: "attack_target",
        description: "Attack a specific entity by name.",
        category: "combat",
        fallback: "defend_player",
        plan(params, ctx) {
            const entityName = params.entityName ||
                ctx.nearbyHostiles[0]?.replace(/ \(\d+m\)$/, "");
            if (!entityName)
                return [];
            return [{
                    id: nextId("atk"),
                    type: "attack_entity",
                    target: { entityName },
                    priority: 4,
                    reason: `Attacking ${entityName}`,
                    timeout: 30000,
                }];
        },
    },
    {
        name: "defend_player",
        description: "Follow a player and attack nearby hostiles.",
        category: "combat",
        plan(params, ctx) {
            const playerName = params.playerName || ctx.nearbyPlayers[0];
            const actions = [];
            if (playerName) {
                actions.push({
                    id: nextId("def_follow"),
                    type: "follow_player",
                    target: { playerName },
                    priority: 5,
                    reason: `Defending ${playerName} — staying close`,
                    timeout: 60000,
                });
            }
            for (const hostile of ctx.nearbyHostiles.slice(0, 3)) {
                const name = hostile.replace(/ \(\d+m\)$/, "");
                actions.push({
                    id: nextId("def_atk"),
                    type: "attack_entity",
                    target: { entityName: name },
                    priority: 5,
                    reason: `Defending against ${name}`,
                    timeout: 15000,
                });
            }
            return actions;
        },
    },
    // ── Building ────────────────────────────────────────
    {
        name: "build_shelter",
        description: "Build a basic shelter: gather wood, place walls and torch.",
        category: "building",
        plan(_params, ctx) {
            const actions = [];
            const pos = ctx.botState?.position;
            if (!pos)
                return [];
            // Gather wood first
            actions.push({
                id: nextId("bw"),
                type: "collect_block",
                target: { blockType: "oak_log" },
                priority: 3,
                reason: "Gathering wood for shelter",
                timeout: 20000,
            });
            // Place walls (2 high around the bot)
            const offsets = [
                { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
            ];
            for (const off of offsets) {
                actions.push({
                    id: nextId("wall"),
                    type: "place_block",
                    target: { blockType: "oak_planks" },
                    priority: 3,
                    reason: "Building shelter wall",
                    timeout: 5000,
                });
            }
            // Place torch
            actions.push({
                id: nextId("torch"),
                type: "place_torch",
                target: {},
                priority: 2,
                reason: "Lighting shelter",
                timeout: 5000,
            });
            return actions;
        },
    },
];
//# sourceMappingURL=skill-definitions.js.map