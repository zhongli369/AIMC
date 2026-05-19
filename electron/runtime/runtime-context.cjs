/**
 * RuntimeContext — unified state synchronization layer for the bot process.
 *
 * Responsibilities:
 *   - Bind a Mineflayer bot instance and wire event listeners
 *   - Maintain a live BotState snapshot (globalThis.__botState__)
 *   - Provide world state queries (nearby entities, players)
 *   - Feed state into AgentCore.think() via the bridge
 *
 * Unidirectional: bot events → RuntimeContext → consumers (AgentCore, UI).
 * Never writes back to the bot.
 */

// ─── State ────────────────────────────────────────────────

/** @type {import('mineflayer').Bot|null} */
let _bot = null;

/** @type {Array<{category:string, type:string, timestamp:number, data:unknown}>} */
let recentEvents = [];
const MAX_EVENTS = 50;

// ─── BotState Sync ────────────────────────────────────────

/**
 * Update globalThis.__botState__ from the live bot instance.
 * Called on physicsTick (~20Hz) and on major state changes.
 */
function updateBotState() {
  if (!_bot || !_bot.entity) return;

  const timeNames = ["sunrise", "day", "noon", "sunset", "night", "midnight"];
  const timeOfDay = _bot.time?.timeOfDay || 0;
  const timeIdx = Math.floor((timeOfDay / 24000) * timeNames.length) % timeNames.length;

  globalThis.__botState__ = {
    health: _bot.health,
    food: _bot.food,
    saturation: _bot.foodSaturation || 0,
    position: {
      x: _bot.entity.position.x,
      y: _bot.entity.position.y,
      z: _bot.entity.position.z,
    },
    velocity: {
      x: _bot.entity.velocity.x,
      y: _bot.entity.velocity.y,
      z: _bot.entity.velocity.z,
    },
    yaw: _bot.entity.yaw,
    pitch: _bot.entity.pitch,
    onGround: _bot.entity.onGround,
    isInWater: _bot.entity.isInWater || false,
    biome: "unknown",
    dimension: _bot.game?.dimension || "overworld",
    timeOfDay: timeNames[timeIdx] || "unknown",
    weather: _bot.isRaining ? "rain" : "clear",
    heldItem: _bot.heldItem ? {
      name: _bot.heldItem.name,
      displayName: _bot.heldItem.displayName,
      count: _bot.heldItem.count,
      slot: _bot.heldItem.slot,
    } : null,
    gameMode: _bot.game?.gameMode || "survival",
    experience: {
      points: _bot.experience?.points || 0,
      level: _bot.experience?.level || 0,
    },
  };
}

// ─── World State ───────────────────────────────────────────

function getNearbyEntities(maxDistance = 30) {
  if (!_bot || !_bot.entity) return [];
  const entities = Object.values(_bot.entities || {});
  return entities
    .filter((e) => e.position && e.position.distanceTo(_bot.entity.position) < maxDistance)
    .map((e) => {
      const name = e.name || e.username || e.mobType || "unknown";
      const dist = Math.round(e.position.distanceTo(_bot.entity.position));
      return `${name} (${dist}m)`;
    });
}

function getNearbyPlayers() {
  if (!_bot) return [];
  return Object.keys(_bot.players || {});
}

function getNearbyHostiles(maxDistance = 30) {
  if (!_bot || !_bot.entity) return [];
  const hostilePattern = /zombie|skeleton|creeper|spider|witch|pillager|hoglin|piglin_brute|enderman|warden|blaze|ghast|drowned|husk|stray|slime|phantom|vindicator|evoker|ravager|guardian|elder_guardian/i;
  const entities = Object.values(_bot.entities || {});
  return entities
    .filter((e) => {
      if (!e.position) return false;
      const dist = e.position.distanceTo(_bot.entity.position);
      if (dist > maxDistance) return false;
      const name = (e.name || e.mobType || "").toLowerCase();
      return hostilePattern.test(name);
    })
    .map((e) => {
      const name = e.name || e.mobType || "unknown";
      const dist = Math.round(e.position.distanceTo(_bot.entity.position));
      return `${name} (${dist}m)`;
    });
}

// ─── Event Buffer ──────────────────────────────────────────

function addEvent(category, type, data) {
  recentEvents.push({ category, type, timestamp: Date.now(), data });
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift();
  }
}

function getRecentEvents(count = 20) {
  return recentEvents.slice(-count);
}

// ─── Bind / Unbind ─────────────────────────────────────────

/**
 * Bind a Mineflayer bot instance and start state synchronization.
 * @param {import('mineflayer').Bot} bot
 */
function bindBot(bot) {
  _bot = bot;
  recentEvents = [];

  // Update botState on every physics tick (~20Hz)
  bot.on("physicsTick", updateBotState);

  // Also update on major state transitions
  bot.on("health", () => {
    updateBotState();
    addEvent("minecraft", "health_change", { health: bot.health, food: bot.food });
  });

  bot.on("spawn", () => {
    updateBotState();
    addEvent("minecraft", "bot_spawned", {
      position: bot.entity ? {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z,
      } : null,
    });
  });

  bot.on("death", () => {
    addEvent("minecraft", "death", {});
  });

  bot.on("time", () => {
    addEvent("minecraft", "time_update", { timeOfDay: bot.time?.timeOfDay });
  });

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    addEvent("minecraft", "chat", { username, message });
  });

  bot.on("error", (err) => {
    addEvent("minecraft", "error", { message: err.message });
  });

  bot.on("kicked", (reason) => {
    addEvent("minecraft", "kicked", { reason: String(reason) });
  });

  bot.on("end", (reason) => {
    addEvent("minecraft", "disconnected", { reason });
  });

  // Initial population
  updateBotState();

  console.log("[RuntimeContext] Bot bound — state sync active.");
}

/** Unbind and clean up. */
function unbindBot() {
  _bot = null;
  recentEvents = [];
  globalThis.__botState__ = null;
  console.log("[RuntimeContext] Bot unbound.");
}

// ─── Snapshot ──────────────────────────────────────────────

function getSnapshot() {
  return {
    bot: globalThis.__botState__ || null,
    world: {
      nearbyEntities: getNearbyEntities(),
      nearbyPlayers: getNearbyPlayers(),
      nearbyHostiles: getNearbyHostiles(),
      dimension: _bot?.game?.dimension || "unknown",
      timeOfDay: _bot ? (_bot.time?.timeOfDay || 0) : 0,
      weather: _bot?.isRaining ? "rain" : "clear",
    },
    recentEvents: getRecentEvents(),
    lastUpdateMs: Date.now(),
  };
}

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  bindBot,
  unbindBot,
  updateBotState,
  getSnapshot,
  getNearbyEntities,
  getNearbyPlayers,
  getNearbyHostiles,
  getRecentEvents,
};
