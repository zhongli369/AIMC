/**
 * AIMC Dashboard — Renderer Script
 *
 * Vanilla JS. Subscribes to "aimc:dashboard-state" IPC from main process.
 * Renders 3 panels: GameState, AIFlow, SystemHealth.
 * READ-ONLY — zero execution, zero behavior change.
 */
(function () {
  // ─── DOM Refs ──────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const statusBadge = $("status-badge");
  const clockEl = $("clock");

  // Panel dots
  const dotGame = $("dot-gamestate");
  const dotFlow = $("dot-aiflow");

  // GameState
  const healthBar = $("health-bar");
  const healthValue = $("health-value");
  const foodBar = $("food-bar");
  const foodValue = $("food-value");
  const posValue = $("pos-value");
  const dimValue = $("dim-value");
  const invValue = $("inv-value");
  const equipValue = $("equip-value");

  // AIFlow
  const intentBadge = $("intent-badge");
  const flowSkill = $("aiflow-skill");
  const flowResult = $("aiflow-result");
  const flowSpeech = $("aiflow-speech");
  const timelineList = $("timeline-list");

  // SystemHealth
  const healthStateBadge = $("health-state-badge");
  const metricSuccessVal = $("metric-success-val");
  const metricFallbackVal = $("metric-fallback-val");
  const metricStuckVal = $("metric-stuck-val");
  const metricLoopVal = $("metric-loop-val");
  const safeDot = $("safe-dot");
  const safeModeText = $("safe-mode-text");
  const totalActions = $("total-actions");

  // ─── State ─────────────────────────────────────────────
  let lastUpdate = 0;
  let updateTimer = null;
  const STALE_TIMEOUT = 5000; // Show disconnected if no update for 5s

  // ─── Clock ─────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toTimeString().slice(0, 8);
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ─── Stale Check ──────────────────────────────────────
  function checkStale() {
    const stale = Date.now() - lastUpdate > STALE_TIMEOUT;
    statusBadge.textContent = stale ? "DISCONNECTED" : "CONNECTED";
    statusBadge.className = "status-badge " + (stale ? "disconnected" : "connected");
  }

  // ─── Render: GameState ─────────────────────────────────
  function renderGameState(gs) {
    if (!gs) return;

    // Health bar
    const hp = gs.health || 0;
    const maxHp = gs.maxHealth || 20;
    const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    healthBar.style.width = hpPct + "%";
    healthValue.textContent = Math.round(hp) + "/" + maxHp;

    // Health bar color
    healthBar.className = "bar-fill health-fill";
    if (hpPct > 60) healthBar.classList.add("good");
    else if (hpPct > 30) healthBar.classList.add("warning");

    // Food bar
    const food = gs.food || 0;
    const foodPct = Math.max(0, Math.min(100, (food / 20) * 100));
    foodBar.style.width = foodPct + "%";
    foodValue.textContent = Math.round(food) + "/20";

    foodBar.className = "bar-fill food-fill";
    if (foodPct < 25) foodBar.classList.add("low");

    // Position
    if (gs.position) {
      posValue.textContent = gs.position.x + ", " + gs.position.y + ", " + gs.position.z;
    } else {
      posValue.textContent = "--, --, --";
    }

    // Dimension
    dimValue.textContent = gs.dimension || "--";

    // Inventory
    invValue.textContent = (gs.inventoryCount || 0) + " items";

    // Equipped
    equipValue.textContent = gs.equippedItem || "--";

    // Panel dot
    if (gs.running) {
      dotGame.classList.add("live");
    } else {
      dotGame.classList.remove("live");
    }
  }

  // ─── Render: AIFlow ────────────────────────────────────
  function renderAIFlow(af) {
    if (!af) return;

    // Intent badge
    const intent = af.currentIntent || "idle";
    intentBadge.textContent = intent || "IDLE";
    intentBadge.className = "intent-badge";
    if (intent === "skill" || intent.includes("mine") || intent.includes("attack") || intent.includes("collect") || intent.includes("explore") || intent.includes("follow") || intent.includes("defend") || intent.includes("build") || intent.includes("gather")) {
      intentBadge.classList.add("skill");
    } else if (intent === "chat") {
      intentBadge.classList.add("chat");
    } else if (intent === "plan") {
      intentBadge.classList.add("plan");
    } else {
      intentBadge.classList.add("idle");
    }

    // Skill & result
    flowSkill.textContent = af.lastSkill || "--";
    flowResult.textContent = af.lastActionResult || "--";

    // Speech
    flowSpeech.textContent = af.lastSpeech || "--";
    if (!af.lastSpeech) flowSpeech.style.opacity = "0.5";

    // Timeline
    if (af.recentTimeline && af.recentTimeline.length > 0) {
      timelineList.innerHTML = af.recentTimeline.slice(0, 6).map(function (e) {
        var time = new Date(e.timestamp).toTimeString().slice(0, 8);
        var typeClass = e.type || "";
        var detail = e.detail || "";
        return (
          '<div class="timeline-item">' +
          '<span class="timeline-time">' + time + '</span>' +
          '<span class="timeline-type ' + typeClass + '">' + e.type + '</span>' +
          '<span class="timeline-detail">' + detail + '</span>' +
          '</div>'
        );
      }).join("");
    } else {
      timelineList.innerHTML = '<div class="timeline-item"><span class="timeline-detail">No events yet</span></div>';
    }

    // Panel dot
    if (af.currentIntent) {
      dotFlow.classList.add("live");
    } else {
      dotFlow.classList.remove("live");
    }
  }

  // ─── Render: SystemHealth ──────────────────────────────
  function renderSystemHealth(sh) {
    if (!sh) return;

    // Health state badge
    var state = sh.healthState || "unknown";
    healthStateBadge.textContent = state.toUpperCase().replace(/_/g, " ");
    healthStateBadge.className = "health-state-badge " + state;

    // Metrics
    metricSuccessVal.textContent = (sh.skillSuccessRate || 0) + "%";
    metricFallbackVal.textContent = (sh.fallbackRate || 0) + "%";
    metricStuckVal.textContent = (sh.stuckRate || 0) + "%";
    metricLoopVal.textContent = (sh.loopRate || 0) + "%";

    // Color-code metrics
    setMetricColor(metricSuccessVal, sh.skillSuccessRate, true);
    setMetricColor(metricFallbackVal, sh.fallbackRate, false);
    setMetricColor(metricStuckVal, sh.stuckRate, false);
    setMetricColor(metricLoopVal, sh.loopRate, false);

    // Safe mode
    if (sh.isSafeMode) {
      safeDot.classList.add("active");
      safeModeText.textContent = "Safe Mode: ACTIVE";
    } else {
      safeDot.classList.remove("active");
      safeModeText.textContent = "Safe Mode: OFF";
    }

    // Total actions
    totalActions.textContent = sh.totalActions || 0;
  }

  function setMetricColor(el, value, higherIsBetter) {
    el.className = "metric-value";
    if (higherIsBetter) {
      if (value >= 80) el.classList.add("good");
      else if (value < 50) el.classList.add("danger");
      else el.classList.add("warning");
    } else {
      if (value <= 10) el.classList.add("good");
      else if (value > 30) el.classList.add("danger");
      else el.classList.add("warning");
    }
  }

  // ─── Main Render ───────────────────────────────────────
  function render(data) {
    if (!data) return;
    lastUpdate = Date.now();

    renderGameState(data.gameState);
    renderAIFlow(data.aiFlow);
    renderSystemHealth(data.systemHealth);

    statusBadge.textContent = "CONNECTED";
    statusBadge.className = "status-badge connected";
  }

  // ─── IPC Subscription ──────────────────────────────────
  function subscribe() {
    if (!window.aimc || !window.aimc.onDashboardState) {
      // Retry — contextBridge may not be ready yet
      setTimeout(subscribe, 200);
      return;
    }

    window.aimc.onDashboardState(function (data) {
      render(data);
    });
  }

  // ─── Stale Check Timer ─────────────────────────────────
  setInterval(checkStale, 2000);

  // ─── Init ──────────────────────────────────────────────
  subscribe();
  checkStale();
})();
