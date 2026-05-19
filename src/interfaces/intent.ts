/**
 * Core intent types — the ONLY contract between LLM reasoning and runtime execution.
 * LLM outputs AgentOutput JSON; runtime validates and executes.
 */

// ─── Action Types ────────────────────────────────────────────

export type ActionType =
  // Movement
  | "move_to"
  | "follow_player"
  | "move_away_from"
  | "go_to_surface"
  | "dig_down"
  | "stay"
  // Block interaction
  | "mine_block"
  | "place_block"
  | "collect_block"
  | "use_block"
  // Combat
  | "attack_entity"
  | "defend_self"
  | "flee"
  // Inventory
  | "equip_item"
  | "drop_item"
  | "consume"
  | "give_to_player"
  | "open_container"
  | "store_item"
  | "take_item"
  // Crafting
  | "craft_item"
  | "smelt_item"
  // Social
  | "speak_chat"
  | "speak_whisper"
  | "look_at_player"
  | "look_at_position"
  // Utility
  | "sleep"
  | "wait"
  | "collect_nearby_items"
  | "use_door"
  | "place_torch";

export type ActionPriority = 1 | 2 | 3 | 4 | 5;
// 1=background, 2=normal, 3=important, 4=urgent, 5=emergency

export type SpeechTone = "neutral" | "friendly" | "urgent" | "excited" | "concerned";

// ─── Intent Targets ──────────────────────────────────────────

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

// ─── Intent Action ───────────────────────────────────────────

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

// ─── Speech Intent ───────────────────────────────────────────

export interface SpeechIntent {
  /** The text to speak */
  text: string;
  /** Emotional tone */
  tone: SpeechTone;
  /** Target player name, or undefined for public chat */
  target?: string;
}

// ─── Memory Save Candidate ───────────────────────────────────

export interface MemoryCandidate {
  type: "event" | "location" | "relationship" | "failure" | "success" | "preference";
  summary: string;
  importance: number; // 1-10
  emotionalValence?: number; // -1.0 to 1.0
  tags?: string[];
}

// ─── Task State Change ───────────────────────────────────────

export interface TaskStateChange {
  taskId?: string;
  action: "start" | "complete" | "fail" | "pause" | "resume" | "cancel";
  reason?: string;
}

// ─── Skill Intent ────────────────────────────────────────────

export interface SkillIntent {
  /** Skill name registered in SkillRegistry */
  name: string;
  /** Parameters for the skill */
  params?: Record<string, unknown>;
}

// ─── Plan Definition ─────────────────────────────────────────

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

// ─── Agent Intent ────────────────────────────────────────────

export type AgentIntent = "chat" | "skill" | "plan";

// ─── Agent Output (LLM contract) ─────────────────────────────

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
    confidence?: number; // 0-1
    energy?: number; // 0-1
  };
}

// ─── Validation Result ───────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: "warning" | "error" | "critical";
}

// ─── Execution Result ────────────────────────────────────────

export interface ExecutionResult {
  actionId: string;
  success: boolean;
  message: string;
  interrupted: boolean;
  timedOut: boolean;
  /** Phase 3-A: arbitrary metadata (retryAttempt, duration, etc.) */
  data?: Record<string, unknown>;
}
