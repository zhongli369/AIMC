/**
 * Intent format reference — shows the LLM exactly how to structure each action type.
 * Only the most important action types are detailed; the rest follow the same pattern.
 */

export const INTENT_FORMAT_PROMPT = `动作目标格式 — 必须使用以下精确的目标结构：

=== 移动 ===
move_to:         { "x": number, "y": number, "z": number }
follow_player:   { "playerName": "string" }
move_away_from:  { "entityName": "string" } 或 { "x": number, "z": number }
go_to_surface:   {}
stay:            {}

=== 方块 ===
mine_block:      { "blockType": "string", "x": number, "y": number, "z": number }
place_block:     { "blockType": "string" }
collect_block:   { "blockType": "string" }
use_block:       { "blockType": "string", "x": number, "y": number, "z": number }

=== 战斗 ===
attack_entity:   { "entityName": "string" }
defend_self:     {}
flee:            {}

=== 背包 ===
equip_item:      { "itemName": "string" }
drop_item:       { "itemName": "string", "count": number }   // count 可选
consume:         { "itemName": "string" }
give_to_player:  { "itemName": "string", "playerName": "string", "count": number }

=== 社交 ===
speak_chat:      { "text": "string (最多256)" }
speak_whisper:   { "text": "string (最多256)", "playerName": "string" }
look_at_player:  { "playerName": "string" }
look_at_position:{ "x": number, "y": number, "z": number }

=== 工具 ===
sleep:           {}
wait:            { "ms": number }                              // 最多30000
collect_nearby_items: {}
use_door:        {}
place_torch:     {}

示例：

回应玩家打招呼（intent="chat"）：
{"intent":"chat","speech":{"text":"你好！我来帮忙了。","tone":"friendly"},"actions":[],"internal_state":{"mood":"cheerful","confidence":0.9}}

低血量逃离危险（intent="chat" + 动作）：
{"intent":"chat","speech":{"text":"快跑！血量危险了！","tone":"urgent"},"actions":[{"id":"f1","type":"flee","target":{},"priority":5,"reason":"血量低于30%，附近有敌对生物"}]}

单技能 — 挖铁矿（intent="skill"）：
{"intent":"skill","skill":{"name":"mine_resource","params":{"blockType":"iron_ore","count":5}},"speech":{"text":"收到，我去挖铁矿石。","tone":"friendly"},"actions":[]}

单技能 — 跟随玩家（intent="skill"）：
{"intent":"skill","skill":{"name":"follow_player","params":{"playerName":"Steve"}},"speech":{"text":"跟上你了。","tone":"friendly"},"actions":[{"id":"a2","type":"place_torch","target":{},"priority":1,"reason":"沿途照明"}]}

多步骤计划 — 去挖铁然后回来（intent="plan"）：
{"intent":"plan","plan":{"goal":"去挖铁矿石然后返回","steps":[{"step":1,"action":"找到铁矿","skill":"mine_resource","params":{"blockType":"iron_ore","count":8}},{"step":2,"action":"返回玩家身边","skill":"follow_player","params":{"playerName":"Steve"}}]},"speech":{"text":"好的，我先去挖8块铁矿石，然后回来找你。","tone":"friendly"},"actions":[]}

多步骤计划 — 建避难所（intent="plan"）：
{"intent":"plan","plan":{"goal":"建造一个基本避难所","steps":[{"step":1,"action":"收集木材","skill":"mine_resource","params":{"blockType":"oak_log","count":10}},{"step":2,"action":"建造墙壁和照明","skill":"build_shelter","params":{}},{"step":3,"action":"捡起掉落物","skill":"collect_items","params":{}}]},"speech":{"text":"我来建一个避难所，分三步：砍树、搭墙、清理。","tone":"friendly"},"actions":[]}`;
