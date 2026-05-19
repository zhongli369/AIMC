/**
 * Core intent types — the ONLY contract between LLM reasoning and runtime execution.
 * LLM outputs AgentOutput JSON; runtime validates and executes.
 */
export type ActionType = "move_to" | "follow_player" | "move_away_from" | "go_to_surface" | "dig_down" | "stay" | "mine_block" | "place_block" | "collect_block" | "use_block" | "attack_entity" | "defend_self" | "flee" | "equip_item" | "drop_item" | "consume" | "give_to_player" | "open_container" | "store_item" | "take_item" | "craft_item" | "smelt_item" | "speak_chat" | "speak_whisper" | "look_at_player" | "look_at_position" | "sleep" | "wait" | "collect_nearby_items" | "use_door" | "place_torch";
export type ActionPriority = 1 | 2 | 3 | 4 | 5;
export type SpeechTone = "neutral" | "friendly" | "urgent" | "excited" | "concerned";
export interface PositionTarget {
    x: number;
    y: number;
    z: number;
}
export interface EntityTarget {
    entityName: string;
    entityType?: string;
    maxDistance?: number;
}
export interface PlayerTarget {
    playerName: string;
}
export interface BlockTarget {
    blockType: string;
    position?: PositionTarget;
    count?: number;
}
export interface ItemTarget {
    itemName: string;
    count?: number;
    sourceContainer?: string;
    destContainer?: string;
}
export type ActionTarget = PositionTarget | EntityTarget | PlayerTarget | BlockTarget | ItemTarget | Record<string, never>;
export interface IntentAction {
    /** Unique identifier for tracking execution */
    id: string;
    /** The type of action to perform */
    type: ActionType;
    /** Target of the action */
    target: ActionTarget;
    /** Priority level */
    priority: ActionPriority;
    /** WHY the agent wants to do this (for debugging and safety validation) */
    reason: string;
    /** Timeout in ms (default 5000) */
    timeout?: number;
    /** Whether a higher-priority action can interrupt this one */
    cancelable?: boolean;
}
export interface SpeechIntent {
    /** The text to speak */
    text: string;
    /** Emotional tone */
    tone: SpeechTone;
    /** Target player name, or undefined for public chat */
    target?: string;
}
export interface MemoryCandidate {
    type: "event" | "location" | "relationship" | "failure" | "success" | "preference";
    summary: string;
    importance: number;
    emotionalValence?: number;
    tags?: string[];
}
export interface TaskStateChange {
    taskId?: string;
    action: "start" | "complete" | "fail" | "pause" | "resume" | "cancel";
    reason?: string;
}
export interface SkillIntent {
    /** Skill name registered in SkillRegistry */
    name: string;
    /** Parameters for the skill */
    params?: Record<string, unknown>;
}
export interface PlanStep {
    step: number;
    /** Human-readable action description */
    action: string;
    /** Skill to invoke (if any) */
    skill?: string;
    /** Parameters for the skill or direct action */
    params: Record<string, unknown>;
}
export interface TaskPlan {
    goal: string;
    steps: PlanStep[];
}
export type AgentIntent = "chat" | "skill" | "plan";
export interface AgentOutput {
    /** Top-level intent classification */
    intent: AgentIntent;
    /** Single skill execution (when intent="skill") */
    skill?: SkillIntent;
    /** Multi-step plan (when intent="plan") */
    plan?: TaskPlan;
    /** What the agent wants to say (optional) */
    speech?: SpeechIntent;
    /** Actions to execute (empty array = no actions). Used for intent="chat" or fallback. */
    actions: IntentAction[];
    /** Memory to save (optional) */
    memory_save?: MemoryCandidate;
    /** Task state update (optional) */
    task_update?: TaskStateChange;
    /** Internal emotional state for the personality system */
    internal_state?: {
        mood?: string;
        confidence?: number;
        energy?: number;
    };
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}
export interface ValidationError {
    field: string;
    message: string;
    severity: "warning" | "error" | "critical";
}
export interface ExecutionResult {
    actionId: string;
    success: boolean;
    message: string;
    interrupted: boolean;
    timedOut: boolean;
    /** Phase 3-A: arbitrary metadata (retryAttempt, duration, etc.) */
    data?: Record<string, unknown>;
}
//# sourceMappingURL=intent.d.ts.map