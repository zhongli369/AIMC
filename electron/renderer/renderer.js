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
  const doubaoEndpointInput = document.getElementById("doubaoEndpointId");
  const doubaoEndpointGroup = document.getElementById("doubao-endpoint-group");
  const btnStart = document.getElementById("btn-start");
  const btnStop = document.getElementById("btn-stop");
  const btnSave = document.getElementById("btn-save");
  const btnClear = document.getElementById("btn-clear");
  const btnDashboard = document.getElementById("btn-dashboard");
  const consoleOutput = document.getElementById("console-output");
  const statusDot = document.getElementById("status-dot");
  const chatInput = document.getElementById("chat-input");
  const btnSend = document.getElementById("btn-send");
  const btnMic = document.getElementById("btn-mic");
  const voiceStatus = document.getElementById("voice-status");
  const btnVoiceSim = document.getElementById("btn-voice-sim");

  let botRunning = false;

  // ─── Voice Recording State ───────────────────────────
  const VOICE_IDLE = "idle";
  const VOICE_RECORDING = "recording";
  const VOICE_TRANSCRIBING = "transcribing";
  const MIN_RECORDING_MS = 500;
  const MAX_RECORDING_MS = 15000;

  let voiceReady = false;       // whisper available on main?
  let voiceState = VOICE_IDLE;
  let audioContext = null;
  let mediaStream = null;
  let scriptNode = null;
  let pcmChunks = [];
  let recordingStartMs = 0;
  let recordingTimer = null;
  let activeTraceId = null;     // current transcription in flight
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
    btnVoiceSim.disabled = !running;
    // Mic button: enabled when bot running (voice readiness checked on click)
    btnMic.disabled = !running || voiceState === "transcribing";
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
      doubaoEndpointId: doubaoEndpointInput.value.trim(),
    };
  }

  function setFormConfig(config) {
    if (config.apiKey) apiKeyInput.value = config.apiKey;
    if (config.host) hostInput.value = config.host;
    if (config.port) portInput.value = config.port;
    if (config.botName) botNameInput.value = config.botName;
    if (config.model) modelSelect.value = config.model;
    if (config.doubaoEndpointId) doubaoEndpointInput.value = config.doubaoEndpointId;
    toggleDoubaoEndpoint();
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
        appendConsole(`[ERROR] sendChat: ${result.error}\n`, "stderr");
      }
    } catch (err) {
      appendConsole(`[ERROR] Chat send failed: ${err.message}\n`, "stderr");
    }
  }

  // ─── Voice Sim (dev-only) ──────────────────────────────

  async function sendVoiceSim() {
    const message = chatInput.value.trim();
    if (!message || !botRunning) return;

    chatInput.value = "";
    const traceId = "debug-" + Date.now().toString(36);
    appendConsole(`[VOICE-SIM] traceId=${traceId} text="${message.slice(0, 80)}"\n`, "system");

    try {
      const result = await window.aimc.sendVoiceSim(message, traceId);
      if (result && !result.success) {
        appendConsole(`[VOICE-SIM] FAILED: ${result.error}\n`, "stderr");
      } else {
        appendConsole(`[VOICE-SIM] sent — check bot console for [VOICE-SIM] / [VOICE] logs\n`, "system");
      }
    } catch (err) {
      appendConsole(`[VOICE-SIM] IPC error: ${err.message}\n`, "stderr");
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

  // ─── Voice Recording (Phase 4B) ────────────────────────

  async function checkVoiceReady() {
    try {
      const result = await window.aimc.checkVoiceReady();
      voiceReady = !!(result && result.ready);
      updateVoiceUI(result);
      return result;
    } catch (err) {
      voiceReady = false;
      updateVoiceUI({ ready: false, reason: "error", message: err.message });
      return { ready: false, reason: "error", message: err.message };
    }
  }

  function updateVoiceUI(result) {
    if (!voiceStatus) return;
    if (!result || result.ready) {
      voiceStatus.className = "voice-status hidden";
      voiceStatus.textContent = "";
      return;
    }
    voiceStatus.className = "voice-status " + (result.reason === "disabled" ? "warn" : "err");
    voiceStatus.textContent = result.reason === "disabled" ? "voice off" :
      result.reason === "missing_whisper" ? "no whisper" :
      result.reason === "missing_model" ? "no model" : "err";
  }

  async function toggleRecording() {
    if (voiceState === VOICE_RECORDING) {
      await stopRecording();
    } else if (voiceState === VOICE_TRANSCRIBING) {
      await cancelTranscribing();
    } else if (voiceState === VOICE_IDLE) {
      await startRecording();
    }
  }

  function setVoiceState(newState) {
    const prev = voiceState;
    voiceState = newState;
    console.log(`[VOICE-UI] state ${prev} → ${newState}`);
    updateMicButton();
  }

  async function startRecording() {
    if (voiceState !== VOICE_IDLE) {
      console.log(`[VOICE-UI] startRecording blocked — state=${voiceState}`);
      return;
    }

    // Check voice readiness
    const ready = await checkVoiceReady();
    if (!ready.ready) {
      appendConsole(`[VOICE-UI] cannot record — ${ready.reason}: ${ready.message || ""}\n`, "stderr");
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
    } catch (err) {
      const msg = err.name === "NotAllowedError" ? "permission denied — allow mic access in browser settings" :
        err.name === "NotFoundError" ? "no microphone found" :
        `microphone error: ${err.message}`;
      appendConsole(`[VOICE-UI] ${msg}\n`, "stderr");
      voiceStatus.className = "voice-status err";
      voiceStatus.textContent = err.name === "NotAllowedError" ? "permission denied" : "no mic";
      setVoiceState(VOICE_IDLE);
      return;
    }

    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
    } catch (_) {
      audioContext = new AudioContext(); // fallback: system default
    }

    console.log("[VOICE-UI] input sampleRate=" + audioContext.sampleRate);

    const source = audioContext.createMediaStreamSource(mediaStream);
    scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
    pcmChunks = [];
    activeTraceId = null;

    scriptNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
      }
      pcmChunks.push(int16);
    };

    source.connect(scriptNode);
    // Zero-gain destination to keep script processor alive without feedback
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    scriptNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    setVoiceState(VOICE_RECORDING);
    recordingStartMs = Date.now();
    voiceStatus.className = "voice-status";
    voiceStatus.textContent = "";

    appendConsole("[VOICE-UI] recording started\n", "system");

    // Auto-stop after max duration
    recordingTimer = setTimeout(() => {
      if (voiceState === VOICE_RECORDING) {
        appendConsole(`[VOICE-UI] max recording time (${MAX_RECORDING_MS / 1000}s) reached — auto-stopping\n`, "system");
        stopRecording();
      }
    }, MAX_RECORDING_MS);

    // Update duration display periodically
    updateRecordingDuration();
  }

  function updateRecordingDuration() {
    if (voiceState !== VOICE_RECORDING) return;
    const elapsed = ((Date.now() - recordingStartMs) / 1000).toFixed(1);
    btnMic.textContent = elapsed + "s";
    voiceStatus.textContent = "recording " + elapsed + "s";
    setTimeout(updateRecordingDuration, 500);
  }

  async function stopRecording() {
    if (voiceState !== VOICE_RECORDING) {
      console.log(`[VOICE-UI] stopRecording blocked — state=${voiceState}`);
      return;
    }

    clearTimeout(recordingTimer);
    recordingTimer = null;

    const durationMs = Date.now() - recordingStartMs;

    // Clean up audio resources immediately
    cleanupAudioResources();

    appendConsole(`[VOICE-UI] recording stopped — duration=${durationMs}ms\n`, "system");

    // Validate minimum duration
    if (durationMs < MIN_RECORDING_MS) {
      appendConsole(`[VOICE-UI] too short — durationMs=${durationMs} (< ${MIN_RECORDING_MS}ms), discarded\n`, "stderr");
      voiceStatus.className = "voice-status err";
      voiceStatus.textContent = "too short (" + durationMs + "ms)";
      setVoiceState(VOICE_IDLE);
      pcmChunks = [];
      return;
    }

    // Concatenate PCM chunks
    let totalLength = 0;
    for (const c of pcmChunks) totalLength += c.length;
    const pcm = new Int16Array(totalLength);
    let offset = 0;
    for (const c of pcmChunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    pcmChunks = [];

    // Send to main for transcription
    const traceId = "mic-" + Date.now().toString(36);
    activeTraceId = traceId;
    setVoiceState(VOICE_TRANSCRIBING);
    voiceStatus.className = "voice-status";
    voiceStatus.textContent = "transcribing...";
    appendConsole("[VOICE-UI] audio sent traceId=" + traceId + "\n", "system");

    const sampleRate = 16000;
    const metadata = { traceId, sampleRate, channels: 1, durationMs };

    try {
      const result = await window.aimc.transcribeAudio(pcm.buffer, metadata);
      activeTraceId = null;
      if (result.success) {
        const preview = (result.transcript || "").slice(0, 60);
        appendConsole(`[VOICE-UI] transcript sent: "${preview}"\n`, "chat-bot");
        voiceStatus.className = "voice-status hidden";
        voiceStatus.textContent = "";
      } else {
        const reason = result.error || "unknown";
        appendConsole(`[VOICE-UI] transcribe failed — ${reason}: ${result.message || ""}\n`, "stderr");
        voiceStatus.className = "voice-status err";
        voiceStatus.textContent =
          reason === "disabled" ? "voice off" :
          reason === "missing_whisper" ? "no whisper" :
          reason === "missing_model" ? "no model" :
          reason === "empty_transcript" ? "no speech" :
          reason === "cancelled" ? "cancelled" :
          "failed";
      }
    } catch (err) {
      activeTraceId = null;
      appendConsole(`[VOICE-UI] transcribe error: ${err.message}\n`, "stderr");
      voiceStatus.className = "voice-status err";
      voiceStatus.textContent = "err";
    }

    setVoiceState(VOICE_IDLE);
  }

  // ── Cancel active transcription ──────────────────────
  async function cancelTranscribing() {
    if (voiceState !== VOICE_TRANSCRIBING) return;
    if (activeTraceId) {
      console.log(`[VOICE-UI] cancelling transcription traceId=${activeTraceId}`);
      try {
        await window.aimc.cancelTranscription(activeTraceId);
      } catch (_) {
        // best-effort
      }
    }
    activeTraceId = null;
    appendConsole("[VOICE-UI] transcription cancelled\n", "system");
    voiceStatus.className = "voice-status err";
    voiceStatus.textContent = "cancelled";
    setVoiceState(VOICE_IDLE);
  }

  // ── Clean up audio resources ─────────────────────────
  function cleanupAudioResources() {
    if (scriptNode) {
      try { scriptNode.disconnect(); } catch (_) {}
      scriptNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      mediaStream = null;
    }
    if (audioContext) {
      try { audioContext.close(); } catch (_) {}
      audioContext = null;
    }
  }

  function updateMicButton() {
    if (!btnMic) return;
    btnMic.classList.remove("recording", "transcribing");
    // Allow click during transcribing for cancel
    btnMic.disabled = !botRunning;

    if (voiceState === VOICE_RECORDING) {
      btnMic.classList.add("recording");
    } else if (voiceState === VOICE_TRANSCRIBING) {
      btnMic.classList.add("transcribing");
      btnMic.textContent = "✕";
      btnMic.title = "Cancel transcription";
    } else {
      btnMic.textContent = "🎤";
      btnMic.title = "Record voice command";
    }
    // Update voice-status to match state
    if (voiceState === VOICE_IDLE && voiceStatus.className.includes("err")) {
      // Keep error visible
    } else if (voiceState === VOICE_IDLE) {
      voiceStatus.className = "voice-status hidden";
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

  // ── Doubao endpoint toggle ──────────────────────────
  function toggleDoubaoEndpoint() {
    const isDoubao = modelSelect.value.startsWith("doubao-");
    doubaoEndpointGroup.style.display = isDoubao ? "block" : "none";
  }
  modelSelect.addEventListener("change", toggleDoubaoEndpoint);

  // ─── Init ──────────────────────────────────────────────

  btnStart.addEventListener("click", startBot);
  btnStop.addEventListener("click", stopBot);
  btnSave.addEventListener("click", saveConfig);
  btnClear.addEventListener("click", clearConsole);
  btnDashboard.addEventListener("click", async () => {
    try {
      await window.aimc.openDashboard();
    } catch (err) {
      appendConsole(`[SYSTEM] Failed to open dashboard: ${err.message}\n`, "stderr");
    }
  });
  btnSend.addEventListener("click", sendChat);
  btnMic.addEventListener("click", toggleRecording);
  btnVoiceSim.addEventListener("click", sendVoiceSim);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendChat(); }
  });

  // ─── Voice Sim keyboard shortcut (dev-only: Ctrl+Shift+V) ──
  // Uses chat input text — type message first, then Ctrl+Shift+V
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "V") {
      e.preventDefault();
      console.log("[VOICE-SIM-DEBUG] Ctrl+Shift+V detected, botRunning=" + botRunning);
      if (botRunning) {
        sendVoiceSim();
      } else {
        appendConsole("[VOICE-SIM] skipped — bot not running\n", "system");
      }
    }
  });

  // Listen for Enter key in form fields
  document.getElementById("config-form").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!botRunning) startBot();
    }
  });

  // Voice result events (main → renderer)
  window.aimc.onVoiceResult((data) => {
    if (data.status === "disabled" || data.status === "missing_whisper" || data.status === "missing_model") {
      voiceReady = false;
      updateVoiceUI({ ready: false, reason: data.status, message: data.message || "" });
    }
  });

  subscribeEvents();
  setStatus(false);
  loadConfig();
})();
