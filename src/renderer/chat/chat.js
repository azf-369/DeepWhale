import { renderMarkdown, escapeHtml } from '../shared/markdown.js';
import { soundFX } from '../shared/sound-fx.js';
import { getBridge } from '../shared/bridge-shim.js';

const bridge = getBridge();

const EMOTION_LABELS = {
  happy: '💙 元气微笑',
  spout: '🌊 兴奋喷水',
  shy: '🌸 害羞拍鳍',
  think: '🧠 深度沉思',
  excited: '✨ 欢呼雀跃',
  sleepy: '🌙 浅海犯困',
  swim: '🧭 悠闲畅游'
};

// DOM References
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const balanceBadge = document.getElementById('balance-badge');
const winMin = document.getElementById('win-min');
const winClose = document.getElementById('win-close');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

const chipV3 = document.getElementById('chip-v3');
const chipR1 = document.getElementById('chip-r1');
const toolClipExplain = document.getElementById('tool-clip-explain');
const toolClear = document.getElementById('tool-clear');
const chatMessagesEl = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');
const btnStop = document.getElementById('btn-stop');
const activePersonaHint = document.getElementById('active-persona-hint');

// Persona & Growth DOM
const growthLevelBadge = document.getElementById('growth-level-badge');
const barExp = document.getElementById('bar-exp');
const valExp = document.getElementById('val-exp');
const barMood = document.getElementById('bar-mood');
const valMood = document.getElementById('val-mood');
const barEnergy = document.getElementById('bar-energy');
const valEnergy = document.getElementById('val-energy');
const cntChats = document.getElementById('cnt-chats');
const cntPats = document.getElementById('cnt-pats');
const cntFeeds = document.getElementById('cnt-feeds');
const personaListEl = document.getElementById('persona-list');
const customPromptEl = document.getElementById('custom-prompt');
const btnSavePersona = document.getElementById('btn-save-persona');

// Settings DOM
const cfgBaseUrl = document.getElementById('cfg-baseurl');
const cfgApiKey = document.getElementById('cfg-apikey');
const toggleKeyVis = document.getElementById('toggle-key-vis');
const cfgModel = document.getElementById('cfg-model');
const cfgTemp = document.getElementById('cfg-temp');
const lblTemp = document.getElementById('lbl-temp');
const btnTestApi = document.getElementById('btn-test-api');
const btnCheckBalance = document.getElementById('btn-check-balance');
const btnSaveApi = document.getElementById('btn-save-api');
const apiFeedback = document.getElementById('api-feedback');

const prefRoam = document.getElementById('pref-roam');
const prefTop = document.getElementById('pref-top');
const prefSound = document.getElementById('pref-sound');
const prefTts = document.getElementById('pref-tts');
const prefLock = document.getElementById('pref-lock');
const toastEl = document.getElementById('toast');

let config = null;
let messages = [];
let selectedPersonaId = 'sunny-whale';
let streamingBubble = null;
let toastTimer = null;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

function switchTab(tabName) {
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
  tabPanels.forEach((p) => p.classList.toggle('active', p.id === `tab-${tabName}`));
}

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

winMin.addEventListener('click', () => bridge.minimizeChatWindow());
winClose.addEventListener('click', () => bridge.closeChatWindow());

// --- Render History & Welcome Empty State ---
function renderAllMessages() {
  chatMessagesEl.innerHTML = '';
  if (!messages.length) {
    const keyBanner = !config?.hasEffectiveApiKey
      ? `<button type="button" class="starter-btn" data-goto-settings="1">🔑 当前为本地演示模式 — 点击这里填入 DeepSeek API Key 解锁满血对话</button>`
      : '';
    chatMessagesEl.innerHTML = `
      <div class="welcome-card">
        <h4>🐳 嗨！我是你的 DeepSeek 深海小鲸</h4>
        <p>支持流式 Markdown 代码高亮、R1 深度思考链实时展示，每次回复还会联动桌面小鲸做出丰富表情与喷水动作！</p>
        <div class="starter-grid">
          ${keyBanner}
          <button type="button" class="starter-btn" data-prompt="表演一个开心的深海喷水庆祝，顺便给我一句程序员今日幸运签！">🌊 表演深海喷水庆祝 + 今日程序员幸运签</button>
          <button type="button" class="starter-btn" data-prompt="用通俗形象的深海比喻帮我解释一下 DeepSeek-R1 的强化学习推理机制">🧠 用深海比喻解释 DeepSeek-R1 推理原理</button>
          <button type="button" class="starter-btn" data-prompt="帮我写一个优雅的 JavaScript 异步重试函数 retryWithBackoff，带指数退避和超时控制">💻 编写带指数退避的异步重试工具函数</button>
        </div>
      </div>
    `;
    return;
  }

  for (const msg of messages) {
    appendMessageDOM(msg);
  }
  scrollToBottom();
}

function appendMessageDOM(msg) {
  const welcome = chatMessagesEl.querySelector('.welcome-card');
  if (welcome) welcome.remove();

  const row = document.createElement('div');
  row.className = `msg-row ${msg.role === 'user' ? 'user' : 'assistant'}`;

  if (msg.role === 'user') {
    row.innerHTML = `
      <div class="msg-meta">你</div>
      <div class="msg-bubble">${escapeHtml(msg.content)}</div>
    `;
  } else {
    const emoBadge = msg.emotion && EMOTION_LABELS[msg.emotion]
      ? `<span class="emotion-tag">${EMOTION_LABELS[msg.emotion]}</span>`
      : '';
    const reasoningBlock = msg.reasoning
      ? `
        <details class="reasoning-box">
          <summary>🧠 深度思考过程 ${msg.durationMs ? `(${(msg.durationMs / 1000).toFixed(1)}s)` : ''}</summary>
          <div class="reasoning-content">${escapeHtml(msg.reasoning)}</div>
        </details>
      `
      : '';

    row.innerHTML = `
      <div class="msg-meta">
        <span>🐳 ${escapeHtml(msg.model || 'DeepWhale')}</span>
        ${emoBadge}
      </div>
      <div class="msg-bubble">
        ${reasoningBlock}
        <div class="assistant-md">${renderMarkdown(msg.content)}</div>
      </div>
    `;
  }

  chatMessagesEl.appendChild(row);
  return row;
}

function scrollToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Delegated clicks inside chat stream (starter prompts, code copy, external links)
chatMessagesEl.addEventListener('click', async (e) => {
  const gotoBtn = e.target.closest('[data-goto-settings]');
  if (gotoBtn) {
    switchTab('settings');
    cfgApiKey.focus();
    return;
  }

  const starter = e.target.closest('[data-prompt]');
  if (starter) {
    submitChatMessage(starter.dataset.prompt);
    return;
  }

  const copyBtn = e.target.closest('[data-copy-code]');
  if (copyBtn) {
    const decoded = decodeURIComponent(copyBtn.dataset.copyCode);
    await bridge.writeClipboard(decoded);
    copyBtn.textContent = '已复制 ✓';
    setTimeout(() => {
      copyBtn.textContent = '复制';
    }, 1500);
    return;
  }

  const extLink = e.target.closest('[data-ext-url]');
  if (extLink) {
    e.preventDefault();
    bridge.openExternal(extLink.dataset.extUrl);
  }
});

// --- Sending & Aborting Messages ---
async function submitChatMessage(rawText) {
  const text = (rawText ?? chatInput.value).trim();
  if (!text || streamingBubble) return;
  chatInput.value = '';
  await bridge.sendMessage(text);
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitChatMessage();
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitChatMessage();
  }
});

btnStop.addEventListener('click', () => {
  bridge.abortStream();
});

// Quick Model Switcher (V3 <-> R1)
[chipV3, chipR1].forEach((chip) => {
  chip.addEventListener('click', async () => {
    const nextModel = chip.dataset.model;
    config = await bridge.updateConfig({ api: { model: nextModel } });
    syncUIFromConfig();
    showToast(`已切换模型为 ${nextModel}`);
  });
});

toolClipExplain.addEventListener('click', async () => {
  const clip = (await bridge.readClipboard()).trim();
  if (!clip) {
    showToast('剪贴板目前是空的哦~');
    return;
  }
  const prompt = `请帮我解读以下剪贴板内容（若是代码请分析核心逻辑与优化点，若是外文请翻译并总结）：\n\n\`\`\`\n${clip.slice(0, 3000)}\n\`\`\``;
  submitChatMessage(prompt);
});

toolClear.addEventListener('click', async () => {
  messages = await bridge.clearMessages();
  renderAllMessages();
  showToast('对话记录已清空');
});

// --- Real-Time Stream Event Handlers ---
function setStreamingUIState(active) {
  btnSend.classList.toggle('hidden', active);
  btnStop.classList.toggle('hidden', !active);
}

bridge.on('chat:stream-start', ({ userMessage, model }) => {
  setStreamingUIState(true);
  messages.push(userMessage);
  appendMessageDOM(userMessage);

  const welcome = chatMessagesEl.querySelector('.welcome-card');
  if (welcome) welcome.remove();

  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  row.innerHTML = `
    <div class="msg-meta">
      <span class="stream-model-label">🐳 ${escapeHtml(model)}</span>
      <span class="emotion-tag hidden"></span>
    </div>
    <div class="msg-bubble">
      <details class="reasoning-box hidden" open>
        <summary class="reasoning-summary">🧠 深度思考中…</summary>
        <div class="reasoning-content"></div>
      </details>
      <div class="assistant-md"><span style="color:#94a3b8">正在组织深海声呐信号…</span></div>
    </div>
  `;
  chatMessagesEl.appendChild(row);
  streamingBubble = {
    row,
    emoEl: row.querySelector('.emotion-tag'),
    rBox: row.querySelector('.reasoning-box'),
    rSum: row.querySelector('.reasoning-summary'),
    rBody: row.querySelector('.reasoning-content'),
    mdBody: row.querySelector('.assistant-md')
  };
  scrollToBottom();
});

bridge.on('chat:stream-reasoning', ({ fullReasoning, elapsedMs }) => {
  if (!streamingBubble) return;
  streamingBubble.rBox.classList.remove('hidden');
  streamingBubble.rSum.textContent = `🧠 深度思考中 (${(elapsedMs / 1000).toFixed(1)}s)`;
  streamingBubble.rBody.textContent = fullReasoning;
  scrollToBottom();
});

bridge.on('chat:stream-emotion', ({ emotion }) => {
  if (!streamingBubble || !EMOTION_LABELS[emotion]) return;
  streamingBubble.emoEl.textContent = EMOTION_LABELS[emotion];
  streamingBubble.emoEl.classList.remove('hidden');
});

bridge.on('chat:stream-token', ({ fullContent }) => {
  if (!streamingBubble) return;
  streamingBubble.mdBody.innerHTML = renderMarkdown(fullContent);
  scrollToBottom();
});

bridge.on('chat:stream-done', (finalMsg) => {
  setStreamingUIState(false);
  if (finalMsg) {
    messages.push(finalMsg);
  }
  if (streamingBubble && finalMsg) {
    if (finalMsg.reasoning) {
      streamingBubble.rSum.textContent = `🧠 深度思考完成`;
      streamingBubble.rBox.open = false;
    }
    streamingBubble.mdBody.innerHTML = renderMarkdown(finalMsg.content);
    rowUpdateModelLabel(streamingBubble.row, finalMsg.model);
  }
  streamingBubble = null;
  scrollToBottom();
});

function rowUpdateModelLabel(row, modelName) {
  const lbl = row.querySelector('.stream-model-label');
  if (lbl && modelName) lbl.textContent = `🐳 ${modelName}`;
}

bridge.on('chat:stream-error', ({ message }) => {
  setStreamingUIState(false);
  if (streamingBubble) {
    streamingBubble.mdBody.innerHTML = `<p style="color:#fca5a5">⚠️ ${escapeHtml(message)}</p>`;
    streamingBubble = null;
  }
});

bridge.on('chat:cleared', () => {
  messages = [];
  renderAllMessages();
});

bridge.on('chat:switch-tab', (tab) => {
  if (tab) switchTab(tab);
});

// --- Persona & Pet Growth Tab ---
function renderPersonaList() {
  if (!config?.personas) return;
  personaListEl.innerHTML = config.personas
    .map(
      (p) => `
      <div class="persona-item ${p.id === selectedPersonaId ? 'selected' : ''}" data-persona-id="${p.id}">
        <div class="persona-item-top">
          <span>${escapeHtml(p.name)}</span>
          <span class="persona-badge">${escapeHtml(p.badge)}</span>
        </div>
        <p>${escapeHtml(p.greeting)}</p>
      </div>
    `
    )
    .join('');
}

personaListEl.addEventListener('click', (e) => {
  const item = e.target.closest('[data-persona-id]');
  if (!item) return;
  selectedPersonaId = item.dataset.personaId;
  renderPersonaList();
});

btnSavePersona.addEventListener('click', async () => {
  config = await bridge.updateConfig({
    personaId: selectedPersonaId,
    customSystemPrompt: customPromptEl.value.trim()
  });
  syncUIFromConfig();
  bridge.triggerPetAction({ action: 'happy' });
  showToast('小鲸人设已更新！🐳');
});

document.getElementById('act-feed').addEventListener('click', async () => {
  const res = await bridge.interactPet('feed');
  bridge.triggerPetAction({ action: 'eat' });
  soundFX.playEat();
  updateGrowthUI(res.stats);
  showToast('已投喂算力磷虾！🦐');
});

document.getElementById('act-spout').addEventListener('click', () => {
  bridge.triggerPetAction({ action: 'spout' });
  showToast('小鲸正在桌面表演双弧喷水柱！🌊');
});

document.getElementById('act-reset-pos').addEventListener('click', async () => {
  await bridge.resetPetPosition();
  showToast('已将小鲸唤回屏幕右下角 📍');
});

function updateGrowthUI(stats) {
  if (!stats) return;
  const needed = (stats.level || 1) * 100;
  const expPct = Math.min(100, Math.round(((stats.exp || 0) / needed) * 100));
  growthLevelBadge.textContent = `Lv.${stats.level || 1}`;
  barExp.style.width = `${expPct}%`;
  valExp.textContent = `${stats.exp || 0}/${needed}`;
  barMood.style.width = `${stats.mood || 0}%`;
  valMood.textContent = `${stats.mood || 0}%`;
  barEnergy.style.width = `${stats.energy || 0}%`;
  valEnergy.textContent = `${stats.energy || 0}%`;
  cntChats.textContent = stats.totalChats || 0;
  cntPats.textContent = stats.totalPats || 0;
  cntFeeds.textContent = stats.totalFeeds || 0;
}

bridge.on('pet:stats-updated', ({ stats }) => updateGrowthUI(stats));

// --- Settings & API Presets ---
const PRESETS = {
  'deepseek-v3': {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat'
  },
  'deepseek-r1': {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-reasoner'
  },
  siliconflow: {
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3'
  },
  ollama: {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'deepseek-r1:7b'
  }
};

document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset];
    if (!p) return;
    cfgBaseUrl.value = p.baseUrl;
    cfgModel.value = p.model;
    showToast(`已填入 ${btn.textContent} 预设端点`);
  });
});

toggleKeyVis.addEventListener('click', () => {
  cfgApiKey.type = cfgApiKey.type === 'password' ? 'text' : 'password';
});

cfgTemp.addEventListener('input', () => {
  lblTemp.textContent = Number(cfgTemp.value).toFixed(1);
});

document.getElementById('link-deepseek-key').addEventListener('click', (e) => {
  e.preventDefault();
  bridge.openExternal('https://platform.deepseek.com/api_keys');
});

function getDraftApiConfig() {
  return {
    baseUrl: cfgBaseUrl.value.trim() || 'https://api.deepseek.com',
    apiKey: cfgApiKey.value.trim(),
    model: cfgModel.value.trim() || 'deepseek-chat',
    temperature: Number(cfgTemp.value)
  };
}

function showApiFeedback(ok, text) {
  apiFeedback.textContent = text;
  apiFeedback.className = `api-feedback ${ok ? 'ok' : 'err'}`;
}

btnTestApi.addEventListener('click', async () => {
  btnTestApi.disabled = true;
  showApiFeedback(true, '正在测试与大模型端点的连通性…');
  const res = await bridge.testConnection(getDraftApiConfig());
  showApiFeedback(res.ok, res.message);
  btnTestApi.disabled = false;
});

async function refreshAccountBalance(tempCfg = null, showPanelMsg = false) {
  const res = await bridge.checkBalance(tempCfg);
  if (res.supported && res.balances?.length) {
    const primary = res.balances[0];
    const symbol = primary.currency === 'USD' ? '$' : '¥';
    balanceBadge.textContent = `💰 ${symbol}${primary.total_balance}`;
    balanceBadge.classList.remove('hidden');
    if (showPanelMsg) {
      showApiFeedback(
        true,
        `DeepSeek 账户可用余额：${symbol}${primary.total_balance} (${primary.currency})`
      );
    }
  } else {
    balanceBadge.classList.add('hidden');
    if (showPanelMsg) {
      showApiFeedback(false, res.message || '未能查询到余额');
    }
  }
}

btnCheckBalance.addEventListener('click', () => refreshAccountBalance(getDraftApiConfig(), true));
balanceBadge.addEventListener('click', () => refreshAccountBalance(null, false));

btnSaveApi.addEventListener('click', async () => {
  const draft = getDraftApiConfig();
  config = await bridge.updateConfig({ api: draft });
  syncUIFromConfig();
  showApiFeedback(true, '配置已保存并立即生效！现在可以回到「实时对话」畅聊啦 🐳');
  showToast('API 配置保存成功');
  if (config.hasEffectiveApiKey) {
    refreshAccountBalance(null, false);
  }
});

// Companion Preference Checkboxes
async function savePrefsFromSwitches() {
  config = await bridge.updateConfig({
    preferences: {
      roamEnabled: prefRoam.checked,
      alwaysOnTop: prefTop.checked,
      soundEnabled: prefSound.checked,
      ttsEnabled: prefTts.checked,
      clickThroughLock: prefLock.checked
    }
  });
  syncUIFromConfig();
}

[prefRoam, prefTop, prefSound, prefTts, prefLock].forEach((el) => {
  el.addEventListener('change', savePrefsFromSwitches);
});

bridge.on('config:updated', (nextCfg) => {
  config = nextCfg;
  syncUIFromConfig();
});

function syncUIFromConfig() {
  if (!config) return;

  // Header status
  const online = Boolean(config.hasEffectiveApiKey) || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(config.api.baseUrl);
  statusDot.classList.toggle('online', online);
  statusText.textContent = online ? config.api.model : '本地演示陪伴';

  // Model quick chips
  chipV3.classList.toggle('active', config.api.model === 'deepseek-chat');
  chipR1.classList.toggle('active', config.api.model === 'deepseek-reasoner');

  // Active persona label
  selectedPersonaId = config.personaId || 'sunny-whale';
  const activeP = config.personas?.find((p) => p.id === selectedPersonaId) || config.personas?.[0];
  if (activeP) {
    activePersonaHint.textContent = `🐳 ${activeP.name}`;
  }
  customPromptEl.value = config.customSystemPrompt || '';
  renderPersonaList();
  updateGrowthUI(config.petStats);

  // Settings inputs
  cfgBaseUrl.value = config.api.baseUrl || 'https://api.deepseek.com';
  cfgApiKey.value = config.api.apiKey || '';
  cfgModel.value = config.api.model || 'deepseek-chat';
  cfgTemp.value = config.api.temperature ?? 0.7;
  lblTemp.textContent = Number(cfgTemp.value).toFixed(1);

  // Switches
  prefRoam.checked = Boolean(config.preferences?.roamEnabled);
  prefTop.checked = config.preferences?.alwaysOnTop !== false;
  prefSound.checked = config.preferences?.soundEnabled !== false;
  prefTts.checked = Boolean(config.preferences?.ttsEnabled);
  prefLock.checked = Boolean(config.preferences?.clickThroughLock);

  soundFX.setPreferences({
    soundEnabled: prefSound.checked,
    ttsEnabled: prefTts.checked
  });
}

// Initial bootstrap
(async function init() {
  config = await bridge.getConfig();
  messages = await bridge.getMessages();
  syncUIFromConfig();
  renderAllMessages();

  if (config.hasEffectiveApiKey) {
    refreshAccountBalance(null, false);
  }
})();
