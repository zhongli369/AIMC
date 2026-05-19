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

回应玩家打招呼：
{"speech":{"text":"你好！我来帮忙了。","tone":"friendly"},"actions":[],"internal_state":{"mood":"cheerful","confidence":0.9}}

低血量逃离危险：
{"speech":{"text":"快跑！血量危险了！","tone":"urgent"},"actions":[{"id":"f1","type":"flee","target":{},"priority":5,"reason":"血量低于30%，附近有敌对生物"}]}

跟随玩家并插火把：
{"speech":{"text":"跟上你了。","tone":"friendly"},"actions":[{"id":"a1","type":"follow_player","target":{"playerName":"Steve"},"priority":2,"reason":"跟随玩家行动"},{"id":"a2","type":"place_torch","target":{},"priority":1,"reason":"沿途照明"}],"internal_state":{"mood":"focused","confidence":0.8}}`;
//# sourceMappingURL=intent-format.js.map