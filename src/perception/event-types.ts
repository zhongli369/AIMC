/**
 * Perception event types — lightweight typed events for the PerceptionPipeline.
 * These are distinct from the EventBus GameEvent (src/interfaces/event.ts).
 * PerceptionPipeline bridges raw Mineflayer events → typed PerceptionEvent.
 */

// ─── Event Type ───────────────────────────────────────────────

export type PerceptionEventType =
  | "chat:player_message"
  | "bot:spawn"
  | "player:join"
  | "player:leave";

// ─── Perception Event ─────────────────────────────────────────

export interface PerceptionEvent<T = unknown> {
  id: string;
  traceId: string;
  type: PerceptionEventType;
  source: string;
  timestamp: number;
  payload: T;
}

// ─── Payload Types ────────────────────────────────────────────

export interface ChatPayload {
  username: string;
  message: string;
}

export interface PlayerJoinPayload {
  username: string;
}

export interface BotSpawnPayload {
  position: { x: number; y: number; z: number } | null;
}

// ─── Handler Interface ────────────────────────────────────────

export interface PerceptionHandlers {
  /**
   * Called BEFORE onChatMessage for every PerceptionEvent.
   * Return { consumed: true } to skip downstream dispatch (e.g., Reflex handled it).
   */
  onPerceptionEvent?: (
    event: PerceptionEvent
  ) => { consumed: boolean } | void | Promise<{ consumed: boolean } | void>;
  /** Called for every validated player chat message (unless consumed by onPerceptionEvent) */
  onChatMessage?: (msg: { type: "chat"; message: string; source: string }) => void;
}
