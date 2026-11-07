import { WhaleAnimator } from '../shared/whale-engine.js';
import { soundFX } from '../shared/sound-fx.js';
import { stripMarkdownPreview } from '../shared/markdown.js';
import { getBridge } from '../shared/bridge-shim.js';

const bridge = getBridge();

const petRoot = document.getElementById('pet-root');
const canvas = document.getElementById('whale-canvas');
const speechBubble = document.getElementById('speech-bubble');
const bubbleBadge = document.getElementById('bubble-badge');
const bubbleText = document.getElementById('bubble-text');
const bubbleFooter = document.getElementById('bubble-footer');
const bubbleExpand = document.getElementById('bubble-expand');
const bubbleClose = document.getElementById('bubble-close');
const levelPill = document.getElementById('level-pill');

const quickDock = document.getElementById('quick-dock');
const btnRoam = document.getElementById('btn-roam');
const btnSleep = document.getElementById('btn-sleep');
const miniAskBar = document.getElementById('mini-ask-bar');
const miniAskInput = document.getElementById('mini-ask-input');

const animator = new WhaleAnimator(canvas, { width: 300, height: 235 });
animator.start();

// Companion idle & touch quips
const PAT_QUIPS = [
  '噗噜噜~ 被摸头好舒服呀！✨',
  '嘿嘿，我的小胸鳍在给你比心哦 💙',
  '今天也要元气满满！遇到难题随时叫我~',
  '呜哇~ 背部滑溜溜的吧？再摸一下加好感度！',
  '深海声呐显示：你今天超棒的！🐳',
  '咕噜咕噜…要不要投喂我一颗算力磷虾？🦐'
];

const IDLE_QUIPS = [
  '写代码累了的话，记得喝口温水眨眨眼哦 💧',
  '双击我可以看深海双弧线喷水柱表演哟 🌊',
  '按 Alt + W 可以随时召唤我的 AI 对话舱！',
  '复制一段代码点「剪贴板」，我立马帮你解读 📋',
  '噗噜…我在安静陪着你呢，随时戳我聊天~'
];

let config = null;
let isSleeping = false;
let isPointerDown = false;
let isIgnoringMouse = true;
let dockHideTimer = null;
let bubbleHideTimer = null;
let strokeAccumulator = 0;
let lastPointerPos = null;
let isAIStreaming = false;

function showBubble(text, options = {}) {
  const {
    badge = '🐳 深海小鲸',
    duration = 5800,
    expandable = false
  } = options;

  bubbleBadge.textContent = badge;
  bubbleText.textContent = text;
  bubbleFooter.classList.toggle('hidden', !expandable);
  speechBubble.classList.add('visible');

  if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
  if (duration > 0) {
    bubbleHideTimer = setTimeout(() => {
      if (!isAIStreaming) {
        speechBubble.classList.remove('visible');
      }
    }, duration);
  }
}

function setMouseIgnore(shouldIgnore) {
  if (isIgnoringMouse === shouldIgnore) return;
  isIgnoringMouse = shouldIgnore;
  bridge.setIgnoreMouseEvents(shouldIgnore);
}

function showHoverUI() {
  if (dockHideTimer) clearTimeout(dockHideTimer);
  petRoot.classList.add('hovered');
  quickDock.classList.add('visible');
}

function scheduleHideHoverUI() {
  if (dockHideTimer) clearTimeout(dockHideTimer);
  dockHideTimer = setTimeout(() => {
    if (!miniAskBar.classList.contains('hidden') && document.activeElement === miniAskInput) {
      return;
    }
    petRoot.classList.remove('hovered');
    quickDock.classList.remove('visible');
    if (isIgnoringMouse === false && !isPointerDown) {
      // Re-enable click-through once dock hides
      setMouseIgnore(true);
    }
  }, 650);
}

function isEventOverInteractiveUI(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return false;
  if (el.closest('.interactive-ui')) {
    const container = el.closest('.interactive-ui');
    if (container.id === 'speech-bubble' && !speechBubble.classList.contains('visible')) return false;
    if (container.id === 'quick-dock' && !quickDock.classList.contains('visible')) return false;
    if (container.id === 'mini-ask-bar' && miniAskBar.classList.contains('hidden')) return false;
    return true;
  }
  return false;
}

// --- Smart Pixel-Level Mouse Pass-Through & Rubbing Detection ---
window.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const localX = e.clientX - rect.left;
  const localY = e.clientY - rect.top;

  // Local eye tracking fallback when mouse is inside petWindow
  animator.setLookOffset(localX - rect.width * 0.5, localY - rect.height * 0.54);

  const overUI = isEventOverInteractiveUI(e.clientX, e.clientY);
  const overWhale = animator.isPointOpaque(localX, localY);

  if (overUI || overWhale || isPointerDown) {
    setMouseIgnore(false);
    showHoverUI();
  } else {
    scheduleHideHoverUI();
    setMouseIgnore(true);
  }

  // Head-rubbing ("摸头杀") detection when gliding cursor back-and-forth on whale without dragging
  if (overWhale && !isPointerDown && !isSleeping && !isAIStreaming) {
    if (lastPointerPos) {
      const dist = Math.hypot(e.clientX - lastPointerPos.x, e.clientY - lastPointerPos.y);
      strokeAccumulator += dist;
      if (strokeAccumulator > 210) {
        strokeAccumulator = 0;
        triggerPatReaction(true);
      }
    }
    lastPointerPos = { x: e.clientX, y: e.clientY };
  } else {
    lastPointerPos = null;
  }
});

window.addEventListener('mouseleave', () => {
  if (!isPointerDown) {
    scheduleHideHoverUI();
  }
});

// --- Dragging, Clicking, Double-Clicking & Right-Clicking ---
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  if (!animator.isPointOpaque(e.clientX - rect.left, e.clientY - rect.top)) return;

  isPointerDown = true;
  setMouseIgnore(false);
  bridge.startPetDrag();
});

window.addEventListener('mouseup', (e) => {
  if (!isPointerDown || e.button !== 0) return;
  isPointerDown = false;
  bridge.endPetDrag();
});

canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  if (!animator.isPointOpaque(e.clientX - rect.left, e.clientY - rect.top)) return;
  triggerSpoutAction();
});

window.addEventListener('contextmenu', (e) => {
  const rect = canvas.getBoundingClientRect();
  const overWhale = animator.isPointOpaque(e.clientX - rect.left, e.clientY - rect.top);
  const overUI = isEventOverInteractiveUI(e.clientX, e.clientY);
  if (overWhale || overUI) {
    e.preventDefault();
    setMouseIgnore(false);
    bridge.showPetContextMenu();
  }
});

async function triggerPatReaction(fromRub = false) {
  if (isSleeping) {
    toggleSleepMode(false);
    return;
  }
  soundFX.playChirp();
  animator.triggerState(fromRub ? 'shy' : 'petting', 2.0);
  const line = fromRub
    ? '呜哇~ 连续摸头太犯规啦，好感度蹭蹭上涨 (*/ω＼*) 💙'
    : PAT_QUIPS[Math.floor(Math.random() * PAT_QUIPS.length)];
  showBubble(line, { badge: '💙 亲密互动', duration: 4200 });

  const res = await bridge.interactPet('pat');
  updateStatsBadge(res);
}

async function triggerSpoutAction() {
  if (isSleeping) toggleSleepMode(false);
  soundFX.playSpout();
  animator.triggerState('spouting', 2.5);
  showBubble('噗咻——！！💦 看我的深海双弧线水柱喷泉！', {
    badge: '🌊 鲸喜喷水',
    duration: 4500
  });
  const res = await bridge.interactPet('spout');
  updateStatsBadge(res);
}

async function triggerFeedAction() {
  if (isSleeping) toggleSleepMode(false);
  soundFX.playEat();
  animator.triggerState('eating', 1.8);
  const res = await bridge.interactPet('feed');
  updateStatsBadge(res);
  const suffix = res?.leveledUp ? ` 恭喜升到 Lv.${res.stats.level}！🎉` : '';
  showBubble(`嗷呜~ 算力磷虾超鲜美！活力 +15，心情大好 ✨${suffix}`, {
    badge: '🦐 投喂成功',
    duration: 4600
  });
}

function toggleSleepMode(forceState) {
  isSleeping = typeof forceState === 'boolean' ? forceState : !isSleeping;
  btnSleep.classList.toggle('active', isSleeping);
  if (isSleeping) {
    animator.setBaseState('sleeping');
    animator.setPersistentActivity(null);
    bridge.interactPet('sleep');
    showBubble('呼噜噜…小鲸进入浅海休眠模式，点我随时唤醒哦 🌙', {
      badge: '💤 小憩中',
      duration: 4500
    });
  } else {
    const roam = Boolean(config?.preferences?.roamEnabled);
    animator.setBaseState(roam ? 'swimming' : 'idle');
    soundFX.playChirp();
    animator.triggerState('petting', 1.6);
    showBubble('满血复活！随时准备潜入代码与知识深海 🐳', {
      badge: '☀️ 已唤醒',
      duration: 4000
    });
  }
}

function updateStatsBadge(res) {
  const level = res?.stats?.level || config?.petStats?.level || 1;
  levelPill.textContent = `Lv.${level}`;
}

// --- Quick Dock Actions ---
quickDock.addEventListener('click', async (e) => {
  const btn = e.target.closest('.dock-btn');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'chat') {
    soundFX.playBubble();
    await bridge.toggleChatWindow('chat');
  } else if (action === 'mini-input') {
    soundFX.playBubble();
    miniAskBar.classList.toggle('hidden');
    if (!miniAskBar.classList.contains('hidden')) {
      setMouseIgnore(false);
      miniAskInput.focus();
    }
  } else if (action === 'feed') {
    await triggerFeedAction();
  } else if (action === 'roam') {
    const nextRoam = !config?.preferences?.roamEnabled;
    if (isSleeping && nextRoam) toggleSleepMode(false);
    config = await bridge.updateConfig({ preferences: { roamEnabled: nextRoam } });
    applyConfigState(config);
    soundFX.playBubble();
    showBubble(
      nextRoam ? '开启桌面自由巡游！我会在任务栏上方悠闲游动哦 🧭' : '已停留在原地乖乖陪你~ ⚓',
      { badge: '🧭 巡游模式', duration: 3800 }
    );
  } else if (action === 'clipboard') {
    soundFX.playSonarPing();
    const clip = (await bridge.readClipboard()).trim();
    if (!clip) {
      showBubble('剪贴板里空空如也哦~ 先复制一段文字或代码再来点我吧 📋', {
        badge: '📋 剪贴板助手',
        duration: 4500
      });
      return;
    }
    await bridge.openChatWindow('chat');
    const prompt = `请帮我分析或解释以下剪贴板内容（若是代码请解析核心逻辑与潜在问题，若是外文请翻译并提炼重点）：\n\n\`\`\`\n${clip.slice(0, 3000)}\n\`\`\``;
    bridge.sendMessage(prompt);
  } else if (action === 'sleep') {
    toggleSleepMode();
  }
});

// --- Mini Quick-Ask Form ---
miniAskBar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = miniAskInput.value.trim();
  if (!text) return;
  miniAskInput.value = '';
  miniAskBar.classList.add('hidden');
  if (isSleeping) toggleSleepMode(false);
  await bridge.sendMessage(text);
});

miniAskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    miniAskBar.classList.add('hidden');
    miniAskInput.blur();
  }
});

bubbleClose.addEventListener('click', () => {
  speechBubble.classList.remove('visible');
});

bubbleExpand.addEventListener('click', () => {
  bridge.openChatWindow('chat');
});

// --- IPC Subscriptions from Main Process ---
bridge.on('pet:global-cursor', ({ dx, dy }) => {
  animator.setLookOffset(dx, dy);
});

bridge.on('pet:drag-motion', ({ vx, vy }) => {
  animator.applyDragMotion(vx, vy);
});

bridge.on('pet:drag-settled', ({ moved }) => {
  animator.endDrag(moved);
  if (!moved) {
    triggerPatReaction(false);
  }
});

bridge.on('pet:roam-state', ({ active, direction }) => {
  if (active && !isSleeping && !isAIStreaming) {
    animator.setFacing(direction);
    animator.setBaseState('swimming');
  }
});

bridge.on('pet:external-action', ({ action }) => {
  if (action === 'spout') triggerSpoutAction();
  else if (action === 'eat') {
    soundFX.playEat();
    animator.triggerState('eating', 1.8);
  } else if (action === 'happy') {
    soundFX.playChirp();
    animator.triggerState('petting', 2.0);
  }
});

bridge.on('pet:stats-updated', (res) => {
  updateStatsBadge(res);
});

bridge.on('config:updated', (nextCfg) => {
  config = nextCfg;
  applyConfigState(config);
});

// --- Real-Time AI Stream Linkage ---
let reasoningTimerLabel = '';

bridge.on('chat:stream-start', ({ model }) => {
  if (isSleeping) toggleSleepMode(false);
  isAIStreaming = true;
  reasoningTimerLabel = '';
  soundFX.playSonarPing();
  animator.setPersistentActivity('thinking');
  showBubble('正在潜入知识深海思考中…', {
    badge: `🧠 ${model}`,
    duration: 0,
    expandable: true
  });
});

bridge.on('chat:stream-reasoning', ({ fullReasoning, elapsedMs }) => {
  isAIStreaming = true;
  animator.setPersistentActivity('thinking');
  const sec = (elapsedMs / 1000).toFixed(1);
  reasoningTimerLabel = `思考 ${sec}s`;
  const tailSnippet = fullReasoning.slice(-95).replace(/\s+/g, ' ').trim();
  showBubble(`💭 ${tailSnippet}`, {
    badge: `🧠 R1 深度思考 (${sec}s)`,
    duration: 0,
    expandable: true
  });
});

bridge.on('chat:stream-emotion', ({ emotion }) => {
  const map = {
    happy: 'petting',
    spout: 'spouting',
    shy: 'shy',
    excited: 'spouting',
    think: 'thinking',
    sleepy: 'sleeping',
    swim: 'swimming'
  };
  const mapped = map[emotion];
  if (mapped === 'spouting') {
    soundFX.playSpout();
    animator.triggerState('spouting', 2.4);
  } else if (mapped === 'shy' || mapped === 'petting') {
    soundFX.playChirp();
    animator.triggerState(mapped, 2.0);
  }
});

bridge.on('chat:stream-token', ({ fullContent }) => {
  isAIStreaming = true;
  if (animator.state !== 'spouting' && animator.state !== 'shy' && animator.state !== 'petting') {
    animator.setPersistentActivity('speaking');
  }
  animator.pulseSpeech();
  const preview = stripMarkdownPreview(fullContent, 115);
  showBubble(preview, {
    badge: reasoningTimerLabel ? `🐳 小鲸回复 (${reasoningTimerLabel})` : '🐳 小鲸回复中…',
    duration: 0,
    expandable: true
  });
});

bridge.on('chat:stream-done', (finalMsg) => {
  isAIStreaming = false;
  animator.setPersistentActivity(null);
  if (finalMsg?.content) {
    const preview = stripMarkdownPreview(finalMsg.content, 118);
    showBubble(preview, {
      badge: finalMsg.isDemo ? '🐳 深海小鲸 (演示模式)' : '🐳 深海小鲸',
      duration: 9000,
      expandable: true
    });
    soundFX.speak(finalMsg.content);
  }
});

bridge.on('chat:stream-error', ({ message }) => {
  isAIStreaming = false;
  animator.setPersistentActivity(null);
  showBubble(`哎呀，连接起了一点小浪花：${message}`, {
    badge: '⚠️ API 提示',
    duration: 8500,
    expandable: true
  });
});

function applyConfigState(cfg) {
  if (!cfg) return;
  soundFX.setPreferences({
    soundEnabled: cfg.preferences?.soundEnabled !== false,
    ttsEnabled: Boolean(cfg.preferences?.ttsEnabled)
  });
  const roam = Boolean(cfg.preferences?.roamEnabled);
  btnRoam.classList.toggle('active', roam);
  if (!isSleeping && !isAIStreaming) {
    animator.setBaseState(roam ? 'swimming' : 'idle');
  }
  levelPill.textContent = `Lv.${cfg.petStats?.level || 1}`;
}

// Idle ambient companion chatter every ~95 seconds if idle
setInterval(() => {
  if (isSleeping || isAIStreaming || speechBubble.classList.contains('visible')) return;
  if (Math.random() < 0.45) {
    const quip = IDLE_QUIPS[Math.floor(Math.random() * IDLE_QUIPS.length)];
    animator.triggerState('petting', 1.4);
    showBubble(quip, { badge: '🌊 深海日常', duration: 5500 });
  }
}, 55000);

// Bootstrap initial config & greeting
(async function init() {
  config = await bridge.getConfig();
  applyConfigState(config);
  const activePersona =
    config.personas?.find((p) => p.id === config.personaId) || config.personas?.[0];
  setTimeout(() => {
    soundFX.playChirp();
    animator.triggerState('spouting', 2.0);
    showBubble(
      activePersona?.greeting || '噗噜噜~ 我是你的 DeepSeek 深海小鲸！戳我互动或按 Alt+W 畅聊吧 🐳',
      {
        badge: config.hasEffectiveApiKey ? '🐳 DeepSeek 已就绪' : '🐳 点击「对话」开启 AI',
        duration: 6800,
        expandable: true
      }
    );
  }, 420);
})();
