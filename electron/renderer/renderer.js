/**
 * AIMC Electron Launcher — Renderer Script
 *
 * Vanilla JS. No framework. Handles form, buttons, console output.
 */
(function () {
  // ─── DOM Refs ──────────────────────────────────────────
  const apiKeyInput = document.getElementById("apiKey");
  const hostInput = document.getElementById("host");
  const portInput = document.getElementById("port");
  const botNameInput = document.getElementById("botName");
  const modelSelect = document.getElementById("model");
  const btnStart = document.getElementById("btn-start");
  const btnStop = document.getElementById("btn-stop");
  const btnSave = document.getElementById("btn-save");
  const btnClear = document.getElementById("btn-clear");
  const consoleOutput = document.getElementById("console-output");
  const statusDot = document.getElementById("status-dot");
  const chatInput = document.getElementById("chat-input");
  const btnSend = document.getElementById("btn-send");

  let botRunning = false;
  let unsubOutput = null;
  let unsubStatus = null;
  let unsubChatResponse = null;

  // ─── Console ───────────────────────────────────────────

  function appendConsole(text, type) {
    if (!consoleOutput) return;
    const span = document.createElement("span");
    span.className = type || "stdout";
    span.textContent = text;
    consoleOutput.appendChild(span);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    // Cap at ~500 lines
    const lines = consoleOutput.querySelectorAll("span");
    if (lines.length > 500) {
      for (let i = 0; i < lines.length - 400; i++) {
        lines[i].remove();
      }
    }
  }

  function clearConsole() {
    if (consoleOutput) consoleOutput.innerHTML = "";
  }

  // ─── Status ────────────────────────────────────────────

  function setStatus(running) {
    botRunning = running;
    statusDot.className = "status-dot " + (running ? "running" : "stopped");
    btnStart.disabled = running;
    btnStop.disabled = !running;

    // Disable form while running
    apiKeyInput.disabled = running;
    hostInput.disabled = running;
    portInput.disabled = running;
    botNameInput.disabled = running;
    modelSelect.disabled = running;

    // Enable chat input when running
    chatInput.disabled = !running;
    btnSend.disabled = !running;
    if (running) chatInput.focus();
  }

  // ─── Config ────────────────────────────────────────────

  function getFormConfig() {
    return {
      apiKey: apiKeyInput.value.trim(),
      host: hostInput.value.trim() || "127.0.0.1",
      port: parseInt(portInput.value, 10) || 55916,
      botName: botNameInput.value.trim() || "AIMC",
      model: modelSelect.value,
    };
  }

  function setFormConfig(config) {
    if (config.apiKey) apiKeyInput.value = config.apiKey;
    if (config.host) hostInput.value = config.host;
    if (config.port) portInput.value = config.port;
    if (config.botName) botNameInput.value = config.botName;
    if (config.model) modelSelect.value = config.model;
  }

  async function loadConfig() {
    try {
      const config = await window.aimc.loadConfig();
      setFormConfig(config);
      appendConsole("[SYSTEM] Configuration loaded.\n", "system");
    } catch (err) {
      appendConsole(`[SYSTEM] Failed to load config: ${err.message}\n`, "stderr");
    }
  }

  async function saveConfig() {
    const config = getFormConfig();
    try {
      const result = await window.aimc.saveConfig(config);
      if (result.success) {
        appendConsole("[SYSTEM] Configuration saved.\n", "system");
      } else {
        appendConsole(`[SYSTEM] Save failed: ${result.error}\n`, "stderr");
      }
    } catch (err) {
      appendConsole(`[SYSTEM] Save error: ${err.message}\n`, "stderr");
    }
  }

  // ─── Bot Control ───────────────────────────────────────

  async function startBot() {
    const config = getFormConfig();

    if (!config.apiKey) {
      appendConsole("[ERROR] API Key is required.\n", "stderr");
      return;
    }
    if (!config.botName) {
      appendConsole("[ERROR] Bot Name is required.\n", "stderr");
      return;
    }

    clearConsole();
    appendConsole(`[SYSTEM] Starting bot "${config.botName}" on ${config.host}:${config.port}...\n`, "system");
    appendConsole(`[SYSTEM] Model: ${config.model}\n`, "system");

    try {
      const result = await window.aimc.startBot(config);
      if (!result.success) {
        appendConsole(`[ERROR] ${result.error}\n`, "stderr");
      }
    } catch (err) {
      appendConsole(`[ERROR] Failed to start: ${err.message}\n`, "stderr");
    }
  }

  async function sendChat() {
    const message = chatInput.value.trim();
    if (!message || !botRunning) return;

    chatInput.value = "";
    appendConsole(`> ${message}\n`, "chat-user");

    try {
      const result = await window.aimc.sendChat(message);
      if (!result.success) {
        appendConsole(`[ERROR] ${result.error}\n`, "stderr");
      }
    } catch (err) {
      appendConsole(`[ERROR] Chat send failed: ${err.message}\n`, "stderr");
    }
  }

  async function stopBot() {
    appendConsole("[SYSTEM] Stopping bot...\n", "system");
    try {
      const result = await window.aimc.stopBot();
      if (!result.success) {
        appendConsole(`[WARN] ${result.error}\n`, "stderr");
      }
    } catch (err) {
      appendConsole(`[ERROR] Failed to stop: ${err.message}\n`, "stderr");
    }
  }

  // ─── Event Subscriptions ───────────────────────────────

  function subscribeEvents() {
    unsubOutput = window.aimc.onBotOutput((data) => {
      appendConsole(data.text, data.type === "stderr" ? "stderr" : "stdout");
    });

    unsubStatus = window.aimc.onBotStatus((data) => {
      setStatus(data.running);
      if (!data.running) {
        const reason = data.error ? `Error: ${data.error}` : `Exit code: ${data.exitCode}`;
        appendConsole(`[SYSTEM] Bot stopped — ${reason}\n`, "system");
      }
    });

    unsubChatResponse = window.aimc.onChatResponse((data) => {
      if (data.type === "ready") {
        if (data.model) {
          appendConsole(`[SYSTEM] AgentCore ready — model: ${data.model}\n`, "system");
        } else if (data.error === "no_api_key") {
          appendConsole("[SYSTEM] AgentCore skipped — no API key\n", "system");
        }
        return;
      }
      if (data.type === "chat_response") {
        if (data.speech && data.speech.text) {
          appendConsole(`${data.speech.text}\n`, "chat-bot");
        } else if (!data.completed) {
          appendConsole("[BOT] (thinking...)\n", "chat-bot");
        }
      }
    });
  }

  // ─── Init ──────────────────────────────────────────────

  btnStart.addEventListener("click", startBot);
  btnStop.addEventListener("click", stopBot);
  btnSave.addEventListener("click", saveConfig);
  btnClear.addEventListener("click", clearConsole);
  btnSend.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendChat(); }
  });

  // Listen for Enter key in form fields
  document.getElementById("config-form").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!botRunning) startBot();
    }
  });

  subscribeEvents();
  setStatus(false);
  loadConfig();
})();
