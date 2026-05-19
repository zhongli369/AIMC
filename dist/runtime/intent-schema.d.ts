/**
 * Intent Schema — Zod validation layer for ALL LLM outputs.
 * Every AgentOutput from any LLM MUST pass these schemas before execution.
 * LLM output is UNTRUSTED INPUT — schemas are the gate.
 */
import { z } from "zod";
export declare const IntentActionSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["move_to", "follow_player", "move_away_from", "go_to_surface", "dig_down", "stay", "mine_block", "place_block", "collect_block", "use_block", "attack_entity", "defend_self", "flee", "equip_item", "drop_item", "consume", "give_to_player", "open_container", "store_item", "take_item", "craft_item", "smelt_item", "speak_chat", "speak_whisper", "look_at_player", "look_at_position", "sleep", "wait", "collect_nearby_items", "use_door", "place_torch"]>;
    target: z.ZodUnion<[z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
        z: number;
    }, {
        x: number;
        y: number;
        z: number;
    }>, z.ZodObject<{
        entityName: z.ZodString;
        entityType: z.ZodOptional<z.ZodString>;
        maxDistance: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        entityName: string;
        entityType?: string | undefined;
        maxDistance?: number | undefined;
    }, {
        entityName: string;
        entityType?: string | undefined;
        maxDistance?: number | undefined;
    }>, z.ZodObject<{
        playerName: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        playerName: string;
    }, {
        playerName: string;
    }>, z.ZodObject<{
        blockType: z.ZodString;
        position: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
            z: number;
        }, {
            x: number;
            y: number;
            z: number;
        }>>;
        count: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        blockType: string;
        count?: number | undefined;
        position?: {
            x: number;
            y: number;
            z: number;
        } | undefined;
    }, {
        blockType: string;
        count?: number | undefined;
        position?: {
            x: number;
            y: number;
            z: number;
        } | undefined;
    }>, z.ZodObject<{
        itemName: z.ZodString;
        count: z.ZodOptional<z.ZodNumber>;
        sourceContainer: z.ZodOptional<z.ZodString>;
        destContainer: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        itemName: string;
        count?: number | undefined;
        sourceContainer?: string | undefined;
        destContainer?: string | undefined;
    }, {
        itemName: string;
        count?: number | undefined;
        sourceContainer?: string | undefined;
        destContainer?: string | undefined;
    }>, z.ZodObject<{
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        text: string;
    }, {
        text: string;
    }>, z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>]>;
    priority: z.ZodNumber;
    reason: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
    cancelable: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
    target: {
        x: number;
        y: number;
        z: number;
    } | {
        entityName: string;
        entityType?: string | undefined;
        maxDistance?: number | undefined;
    } | {
        playerName: string;
    } | {
        blockType: string;
        count?: number | undefined;
        position?: {
            x: number;
            y: number;
            z: number;
        } | undefined;
    } | {
        itemName: string;
        count?: number | undefined;
        sourceContainer?: string | undefined;
        destContainer?: string | undefined;
    } | {
        text: string;
    } | {};
    id: string;
    priority: number;
    reason: string;
    timeout?: number | undefined;
    cancelable?: boolean | undefined;
}, {
    type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
    target: {
        x: number;
        y: number;
        z: number;
    } | {
        entityName: string;
        entityType?: string | undefined;
        maxDistance?: number | undefined;
    } | {
        playerName: string;
    } | {
        blockType: string;
        count?: number | undefined;
        position?: {
            x: number;
            y: number;
            z: number;
        } | undefined;
    } | {
        itemName: string;
        count?: number | undefined;
        sourceContainer?: string | undefined;
        destContainer?: string | undefined;
    } | {
        text: string;
    } | {};
    id: string;
    priority: number;
    reason: string;
    timeout?: number | undefined;
    cancelable?: boolean | undefined;
}>, {
    type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
    target: {
        x: number;
        y: number;
        z: number;
    } | {
        entityName: string;
        entityType?: string | undefined;
        maxDistance?: number | undefined;
    } | {
        playerName: string;
    } | {
        blockType: string;
        count?: number | undefined;
        position?: {
            x: number;
            y: number;
            z: number;
        } | undefined;
    } | {
        itemName: string;
        count?: number | undefined;
        sourceContainer?: string | undefined;
        destContainer?: string | undefined;
    } | {
        text: string;
    } | {};
    id: string;
    priority: number;
    reason: string;
    timeout?: number | undefined;
    cancelable?: boolean | undefined;
}, {
    type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
    target: {
        x: number;
        y: number;
        z: number;
    } | {
        entityName: string;
        entityType?: string | undefined;
        maxDistance?: number | undefined;
    } | {
        playerName: string;
    } | {
        blockType: string;
        count?: number | undefined;
        position?: {
            x: number;
            y: number;
            z: number;
        } | undefined;
    } | {
        itemName: string;
        count?: number | undefined;
        sourceContainer?: string | undefined;
        destContainer?: string | undefined;
    } | {
        text: string;
    } | {};
    id: string;
    priority: number;
    reason: string;
    timeout?: number | undefined;
    cancelable?: boolean | undefined;
}>;
declare const SpeechIntentSchema: z.ZodObject<{
    text: z.ZodString;
    tone: z.ZodEnum<["neutral", "friendly", "urgent", "excited", "concerned"]>;
    target: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    text: string;
    tone: "neutral" | "friendly" | "urgent" | "excited" | "concerned";
    target?: string | undefined;
}, {
    text: string;
    tone: "neutral" | "friendly" | "urgent" | "excited" | "concerned";
    target?: string | undefined;
}>;
export declare const AgentOutputSchema: z.ZodObject<{
    speech: z.ZodOptional<z.ZodObject<{
        text: z.ZodString;
        tone: z.ZodEnum<["neutral", "friendly", "urgent", "excited", "concerned"]>;
        target: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        text: string;
        tone: "neutral" | "friendly" | "urgent" | "excited" | "concerned";
        target?: string | undefined;
    }, {
        text: string;
        tone: "neutral" | "friendly" | "urgent" | "excited" | "concerned";
        target?: string | undefined;
    }>>;
    actions: z.ZodArray<z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["move_to", "follow_player", "move_away_from", "go_to_surface", "dig_down", "stay", "mine_block", "place_block", "collect_block", "use_block", "attack_entity", "defend_self", "flee", "equip_item", "drop_item", "consume", "give_to_player", "open_container", "store_item", "take_item", "craft_item", "smelt_item", "speak_chat", "speak_whisper", "look_at_player", "look_at_position", "sleep", "wait", "collect_nearby_items", "use_door", "place_torch"]>;
        target: z.ZodUnion<[z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
            z: number;
        }, {
            x: number;
            y: number;
            z: number;
        }>, z.ZodObject<{
            entityName: z.ZodString;
            entityType: z.ZodOptional<z.ZodString>;
            maxDistance: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        }, {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        }>, z.ZodObject<{
            playerName: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            playerName: string;
        }, {
            playerName: string;
        }>, z.ZodObject<{
            blockType: z.ZodString;
            position: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                z: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                x: number;
                y: number;
                z: number;
            }, {
                x: number;
                y: number;
                z: number;
            }>>;
            count: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        }, {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        }>, z.ZodObject<{
            itemName: z.ZodString;
            count: z.ZodOptional<z.ZodNumber>;
            sourceContainer: z.ZodOptional<z.ZodString>;
            destContainer: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        }, {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        }>, z.ZodObject<{
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            text: string;
        }, {
            text: string;
        }>, z.ZodObject<{}, "strict", z.ZodTypeAny, {}, {}>]>;
        priority: z.ZodNumber;
        reason: z.ZodString;
        timeout: z.ZodOptional<z.ZodNumber>;
        cancelable: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
        target: {
            x: number;
            y: number;
            z: number;
        } | {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        } | {
            playerName: string;
        } | {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        } | {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        } | {
            text: string;
        } | {};
        id: string;
        priority: number;
        reason: string;
        timeout?: number | undefined;
        cancelable?: boolean | undefined;
    }, {
        type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
        target: {
            x: number;
            y: number;
            z: number;
        } | {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        } | {
            playerName: string;
        } | {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        } | {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        } | {
            text: string;
        } | {};
        id: string;
        priority: number;
        reason: string;
        timeout?: number | undefined;
        cancelable?: boolean | undefined;
    }>, {
        type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
        target: {
            x: number;
            y: number;
            z: number;
        } | {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        } | {
            playerName: string;
        } | {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        } | {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        } | {
            text: string;
        } | {};
        id: string;
        priority: number;
        reason: string;
        timeout?: number | undefined;
        cancelable?: boolean | undefined;
    }, {
        type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
        target: {
            x: number;
            y: number;
            z: number;
        } | {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        } | {
            playerName: string;
        } | {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        } | {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        } | {
            text: string;
        } | {};
        id: string;
        priority: number;
        reason: string;
        timeout?: number | undefined;
        cancelable?: boolean | undefined;
    }>, "many">;
    memory_save: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<["event", "location", "relationship", "failure", "success", "preference"]>;
        summary: z.ZodString;
        importance: z.ZodNumber;
        emotionalValence: z.ZodOptional<z.ZodNumber>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "event" | "location" | "relationship" | "failure" | "success" | "preference";
        summary: string;
        importance: number;
        emotionalValence?: number | undefined;
        tags?: string[] | undefined;
    }, {
        type: "event" | "location" | "relationship" | "failure" | "success" | "preference";
        summary: string;
        importance: number;
        emotionalValence?: number | undefined;
        tags?: string[] | undefined;
    }>>;
    task_update: z.ZodOptional<z.ZodObject<{
        taskId: z.ZodOptional<z.ZodString>;
        action: z.ZodEnum<["start", "complete", "fail", "pause", "resume", "cancel"]>;
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        action: "start" | "complete" | "fail" | "pause" | "resume" | "cancel";
        reason?: string | undefined;
        taskId?: string | undefined;
    }, {
        action: "start" | "complete" | "fail" | "pause" | "resume" | "cancel";
        reason?: string | undefined;
        taskId?: string | undefined;
    }>>;
    internal_state: z.ZodOptional<z.ZodObject<{
        mood: z.ZodOptional<z.ZodString>;
        confidence: z.ZodOptional<z.ZodNumber>;
        energy: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        mood?: string | undefined;
        confidence?: number | undefined;
        energy?: number | undefined;
    }, {
        mood?: string | undefined;
        confidence?: number | undefined;
        energy?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    actions: {
        type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
        target: {
            x: number;
            y: number;
            z: number;
        } | {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        } | {
            playerName: string;
        } | {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        } | {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        } | {
            text: string;
        } | {};
        id: string;
        priority: number;
        reason: string;
        timeout?: number | undefined;
        cancelable?: boolean | undefined;
    }[];
    speech?: {
        text: string;
        tone: "neutral" | "friendly" | "urgent" | "excited" | "concerned";
        target?: string | undefined;
    } | undefined;
    memory_save?: {
        type: "event" | "location" | "relationship" | "failure" | "success" | "preference";
        summary: string;
        importance: number;
        emotionalValence?: number | undefined;
        tags?: string[] | undefined;
    } | undefined;
    task_update?: {
        action: "start" | "complete" | "fail" | "pause" | "resume" | "cancel";
        reason?: string | undefined;
        taskId?: string | undefined;
    } | undefined;
    internal_state?: {
        mood?: string | undefined;
        confidence?: number | undefined;
        energy?: number | undefined;
    } | undefined;
}, {
    actions: {
        type: "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
        target: {
            x: number;
            y: number;
            z: number;
        } | {
            entityName: string;
            entityType?: string | undefined;
            maxDistance?: number | undefined;
        } | {
            playerName: string;
        } | {
            blockType: string;
            count?: number | undefined;
            position?: {
                x: number;
                y: number;
                z: number;
            } | undefined;
        } | {
            itemName: string;
            count?: number | undefined;
            sourceContainer?: string | undefined;
            destContainer?: string | undefined;
        } | {
            text: string;
        } | {};
        id: string;
        priority: number;
        reason: string;
        timeout?: number | undefined;
        cancelable?: boolean | undefined;
    }[];
    speech?: {
        text: string;
        tone: "neutral" | "friendly" | "urgent" | "excited" | "concerned";
        target?: string | undefined;
    } | undefined;
    memory_save?: {
        type: "event" | "location" | "relationship" | "failure" | "success" | "preference";
        summary: string;
        importance: number;
        emotionalValence?: number | undefined;
        tags?: string[] | undefined;
    } | undefined;
    task_update?: {
        action: "start" | "complete" | "fail" | "pause" | "resume" | "cancel";
        reason?: string | undefined;
        taskId?: string | undefined;
    } | undefined;
    internal_state?: {
        mood?: string | undefined;
        confidence?: number | undefined;
        energy?: number | undefined;
    } | undefined;
}>;
export type ValidatedAgentOutput = z.infer<typeof AgentOutputSchema>;
export type ValidatedIntentAction = z.infer<typeof IntentActionSchema>;
export type ValidatedSpeechIntent = z.infer<typeof SpeechIntentSchema>;
export interface SchemaValidationResult {
    valid: boolean;
    data?: ValidatedAgentOutput;
    errors: SchemaValidationError[];
}
export interface SchemaValidationError {
    path: string;
    message: string;
    code: string;
}
/**
 * Validate raw LLM JSON output against the AgentOutput schema.
 * This is the PRIMARY gate between LLM and runtime.
 * Returns structured result — never throws.
 */
export declare function validateAgentOutput(json: unknown): SchemaValidationResult;
/**
 * Validate a single intent action.
 */
export declare function validateIntentAction(json: unknown): SchemaValidationResult;
/**
 * Type guard: check if an object is a valid AgentOutput at runtime.
 */
export declare function isAgentOutput(value: unknown): value is ValidatedAgentOutput;
/**
 * Type guard: check if an object is a valid IntentAction at runtime.
 */
export declare function isIntentAction(value: unknown): value is ValidatedIntentAction;
export {};
//# sourceMappingURL=intent-schema.d.ts.map