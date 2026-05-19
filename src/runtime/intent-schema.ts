/**
 * Intent Schema — Zod validation layer for ALL LLM outputs.
 * Every AgentOutput from any LLM MUST pass these schemas before execution.
 * LLM output is UNTRUSTED INPUT — schemas are the gate.
 */
import { z } from "zod";

// ─── Target Schemas ──────────────────────────────────────────────

const PositionTargetSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

const EntityTargetSchema = z.object({
  entityName: z.string().min(1).max(128),
  entityType: z.string().min(1).max(64).optional(),
  maxDistance: z.number().positive().max(256).optional(),
});

const PlayerTargetSchema = z.object({
  playerName: z.string().min(1).max(16),
});

const BlockTargetSchema = z.object({
  blockType: z.string().min(1).max(128),
  position: PositionTargetSchema.optional(),
  count: z.number().int().positive().max(64).optional(),
});

const ItemTargetSchema = z.object({
  itemName: z.string().min(1).max(128),
  count: z.number().int().positive().max(2304).optional(),
  sourceContainer: z.string().optional(),
  destContainer: z.string().optional(),
});

const ChatTargetSchema = z.object({
  text: z.string().min(1).max(256),
});

const EmptyTargetSchema = z.object({}).strict();

const ActionTargetSchema = z.union([
  PositionTargetSchema,
  EntityTargetSchema,
  PlayerTargetSchema,
  BlockTargetSchema,
  ItemTargetSchema,
  ChatTargetSchema,
  EmptyTargetSchema,
]);

// ─── IntentAction Schema ─────────────────────────────────────────

export const IntentActionSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum([
    "move_to", "follow_player", "move_away_from", "go_to_surface",
    "dig_down", "stay",
    "mine_block", "place_block", "collect_block", "use_block",
    "attack_entity", "defend_self", "flee",
    "equip_item", "drop_item", "consume", "give_to_player",
    "open_container", "store_item", "take_item",
    "craft_item", "smelt_item",
    "speak_chat", "speak_whisper", "look_at_player", "look_at_position",
    "sleep", "wait", "collect_nearby_items", "use_door", "place_torch",
  ]),
  target: ActionTargetSchema,
  priority: z.number().int().min(1).max(5),
  reason: z.string().min(1).max(512),
  timeout: z.number().int().positive().max(60000).optional(),
  cancelable: z.boolean().optional(),
}).superRefine((val, ctx) => {
  // Validate that action type and target shape are coherent
  const t = val.type;
  const target = val.target as Record<string, unknown>;
  const needPos = ["move_to", "dig_down", "go_to_surface"].includes(t);
  const needEntity = t === "attack_entity";
  const needChat = t === "speak_chat" || t === "speak_whisper";
  const needBlock = ["mine_block", "place_block", "use_block"].includes(t);
  const needItem = ["equip_item", "drop_item", "consume", "give_to_player", "craft_item", "smelt_item", "store_item", "take_item"].includes(t);

  if (needPos && (target.x === undefined || target.y === undefined || target.z === undefined)) {
    ctx.addIssue({ code: "custom", path: ["target"], message: `Action "${t}" requires {x, y, z} target` });
  }
  if (needEntity && typeof target.entityName !== "string") {
    ctx.addIssue({ code: "custom", path: ["target"], message: `Action "${t}" requires {entityName} target` });
  }
  if (needChat && typeof target.text !== "string") {
    ctx.addIssue({ code: "custom", path: ["target"], message: `Action "${t}" requires {text} target` });
  }
  if (needBlock && typeof target.blockType !== "string") {
    ctx.addIssue({ code: "custom", path: ["target"], message: `Action "${t}" requires {blockType} target` });
  }
  if (needItem && typeof target.itemName !== "string") {
    ctx.addIssue({ code: "custom", path: ["target"], message: `Action "${t}" requires {itemName} target` });
  }
});

// ─── SpeechIntent Schema ─────────────────────────────────────────

const SpeechToneSchema = z.enum([
  "neutral", "friendly", "urgent", "excited", "concerned",
]);

const SpeechIntentSchema = z.object({
  text: z.string().min(1).max(256),
  tone: SpeechToneSchema,
  target: z.string().min(1).max(16).optional(),
});

// ─── Memory Candidate Schema ─────────────────────────────────────

const MemoryTypeSchema = z.enum([
  "event", "location", "relationship", "failure", "success", "preference",
]);

const MemoryCandidateSchema = z.object({
  type: MemoryTypeSchema,
  summary: z.string().min(1).max(1024),
  importance: z.number().int().min(1).max(10),
  emotionalValence: z.number().min(-1).max(1).optional(),
  tags: z.array(z.string().min(1).max(64)).max(10).optional(),
});

// ─── Task State Change Schema ────────────────────────────────────

const TaskStateChangeSchema = z.object({
  taskId: z.string().min(1).max(64).optional(),
  action: z.enum(["start", "complete", "fail", "pause", "resume", "cancel"]),
  reason: z.string().min(1).max(512).optional(),
});

// ─── Internal State Schema ───────────────────────────────────────

const InternalStateSchema = z.object({
  mood: z.string().min(1).max(64).optional(),
  confidence: z.number().min(0).max(1).optional(),
  energy: z.number().min(0).max(1).optional(),
}).optional();

// ─── Skill Intent Schema ──────────────────────────────────────

const SkillIntentSchema = z.object({
  name: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).optional(),
});

// ─── Plan Schema ──────────────────────────────────────────────

const PlanStepSchema = z.object({
  step: z.number().int().positive(),
  action: z.string().min(1).max(256),
  skill: z.string().min(1).max(64).optional(),
  params: z.record(z.string(), z.unknown()),
});

const TaskPlanSchema = z.object({
  goal: z.string().min(1).max(512),
  steps: z.array(PlanStepSchema).min(1).max(20),
});

// ─── Agent Intent Schema ──────────────────────────────────────

const AgentIntentSchema = z.enum(["chat", "skill", "plan"]);

// ─── AgentOutput Schema (THE contract) ───────────────────────────

export const AgentOutputSchema = z.object({
  intent: AgentIntentSchema,
  skill: SkillIntentSchema.optional(),
  plan: TaskPlanSchema.optional(),
  speech: SpeechIntentSchema.optional(),
  actions: z.array(IntentActionSchema).max(10),
  memory_save: MemoryCandidateSchema.optional(),
  task_update: TaskStateChangeSchema.optional(),
  internal_state: InternalStateSchema,
}).superRefine((val, ctx) => {
  // Coherence check: if intent="skill", skill field must be present
  if (val.intent === "skill" && !val.skill) {
    ctx.addIssue({ code: "custom", path: ["skill"], message: 'intent="skill" requires skill field' });
  }
  // Coherence check: if intent="plan", plan field must be present
  if (val.intent === "plan" && !val.plan) {
    ctx.addIssue({ code: "custom", path: ["plan"], message: 'intent="plan" requires plan field' });
  }
});

// ─── Inferred Types ──────────────────────────────────────────────

export type ValidatedAgentOutput = z.infer<typeof AgentOutputSchema>;
export type ValidatedIntentAction = z.infer<typeof IntentActionSchema>;
export type ValidatedSpeechIntent = z.infer<typeof SpeechIntentSchema>;

// ─── Validation Functions ────────────────────────────────────────

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
export function validateAgentOutput(json: unknown): SchemaValidationResult {
  const result = AgentOutputSchema.safeParse(json);

  if (result.success) {
    return { valid: true, data: result.data, errors: [] };
  }

  const errors: SchemaValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));

  return { valid: false, errors };
}

/**
 * Validate a single intent action.
 */
export function validateIntentAction(json: unknown): SchemaValidationResult {
  const result = IntentActionSchema.safeParse(json);

  if (result.success) {
    return { valid: true, data: { intent: "chat", actions: [result.data] }, errors: [] };
  }

  const errors: SchemaValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));

  return { valid: false, errors };
}

/**
 * Type guard: check if an object is a valid AgentOutput at runtime.
 */
export function isAgentOutput(value: unknown): value is ValidatedAgentOutput {
  return AgentOutputSchema.safeParse(value).success;
}

/**
 * Type guard: check if an object is a valid IntentAction at runtime.
 */
export function isIntentAction(value: unknown): value is ValidatedIntentAction {
  return IntentActionSchema.safeParse(value).success;
}
