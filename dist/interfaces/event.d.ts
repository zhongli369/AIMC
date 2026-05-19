/**
 * Event system types — all game and agent events flow through the EventBus.
 */
export type EventCategory = "minecraft" | "agent" | "voice" | "system" | "memory";
export type MinecraftEventType = "chat" | "whisper" | "player_join" | "player_leave" | "entity_seen" | "entity_gone" | "damage_taken" | "damage_dealt" | "death" | "respawn" | "block_mined" | "block_placed" | "item_pickup" | "item_drop" | "health_change" | "hunger_change" | "weather_change" | "time_change" | "sunrise" | "noon" | "sunset" | "midnight" | "idle" | "wake";
export type AgentEventType = "action_started" | "action_completed" | "action_failed" | "action_interrupted" | "task_started" | "task_completed" | "task_failed" | "decision_made" | "mood_changed" | "goal_set" | "goal_abandoned" | "memory_saved" | "memory_retrieved";
export type VoiceEventType = "stt_partial" | "stt_final" | "tts_start" | "tts_chunk" | "tts_end" | "vad_speech_start" | "vad_speech_end" | "voice_interrupt";
export type SystemEventType = "bot_connected" | "bot_disconnected" | "bot_error" | "bot_spawned" | "bot_kicked" | "rate_limit_hit" | "safety_block" | "arch_violation";
export type MemoryEventType = "memory_stored" | "memory_compressed" | "memory_decayed" | "memory_retrieved";
export type GameEventType = MinecraftEventType | AgentEventType | VoiceEventType | SystemEventType | MemoryEventType;
export type EventPriority = 1 | 2 | 3 | 4 | 5;
export interface GameEvent<T = unknown> {
    /** Unique event ID */
    id: string;
    /** Monotonic sequence number */
    sequence: number;
    /** Event category */
    category: EventCategory;
    /** Event type */
    type: GameEventType;
    /** Priority */
    priority: EventPriority;
    /** Unix ms timestamp */
    timestamp: number;
    /** Event payload (type-specific) */
    data: T;
    /** Source of the event */
    source?: string;
}
export interface ChatEventData {
    username: string;
    message: string;
    isWhisper: boolean;
}
export interface DamageEventData {
    source: string;
    amount: number;
    type: string;
}
export interface DeathEventData {
    message: string;
    position: {
        x: number;
        y: number;
        z: number;
    };
    dimension: string;
}
export interface EntityEventData {
    entityName: string;
    entityType: string;
    position: {
        x: number;
        y: number;
        z: number;
    };
    distance: number;
}
export interface BlockEventData {
    blockType: string;
    position: {
        x: number;
        y: number;
        z: number;
    };
    tool?: string;
}
export interface VoiceSTTData {
    text: string;
    isFinal: boolean;
    confidence: number;
}
export interface VoiceTTSData {
    text: string;
    audioBuffer?: Buffer;
    isChunk: boolean;
}
export type EventHandler<T = unknown> = (event: GameEvent<T>) => void | Promise<void>;
export interface EventSubscription {
    /** Pattern: "category:type" or "category:*" or "*" */
    pattern: string;
    handler: EventHandler;
    /** Minimum priority to trigger handler */
    priorityMin?: EventPriority;
    /** Unsubscribe function */
    unsubscribe: () => void;
}
//# sourceMappingURL=event.d.ts.map