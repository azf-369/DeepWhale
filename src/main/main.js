const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  screen,
  globalShortcut,
  clipboard,
  shell,
  nativeImage
} = require('electron');
const path = require('path');
const { LocalStore } = require('./store');
const { AIService } = require('./ai-service');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

const PET_WIN_WIDTH = 360;
const PET_WIN_HEIGHT = 430;
const CHAT_WIN_WIDTH = 430;
const CHAT_WIN_HEIGHT = 650;

let store;
let aiService;
let petWindow = null;
let chatWindow = null;
let tray = null;
let isQuitting = false;

// Drag & Roam runtime state
let dragState = null;
let dragInterval = null;
let cursorTrackInterval = null;
let roamInterval = null;
let roamDirection = -1; // -1 = left, 1 = right
let roamTick = 0;
let isStreamingNow = false;

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWindow) {
      petWindow.show();
    }
    openChatWindow('chat');
  });
}

function broadcast(channel, payload) {
  for (const win of [petWindow, chatWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function getDefaultPetPosition() {
  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.workArea;
  return {
    x: Math.round(x + width - PET_WIN_WIDTH - 36),
    y: Math.round(y + height - PET_WIN_HEIGHT - 12)
  };
}

function clampToVisibleWorkArea(pos, winWidth, winHeight) {
  const displays = screen.getAllDisplays();
  const center = { x: pos.x + winWidth / 2, y: pos.y + winHeight / 2 };
  const matched =
    displays.find((d) => {
      const wa = d.workArea;
      return (
        center.x >= wa.x &&
        center.x <= wa.x + wa.width &&
        center.y >= wa.y &&
        center.y <= wa.y + wa.height
      );
    }) || screen.getPrimaryDisplay();

  const wa = matched.workArea;
  return {
    x: Math.max(wa.x, Math.min(pos.x, wa.x + wa.width - winWidth)),
    y: Math.max(wa.y, Math.min(pos.y, wa.y + wa.height - winHeight))
  };
}

function createPetWindow() {
  const savedPos = store.config.preferences.petPosition;
  const startPos = savedPos
    ? clampToVisibleWorkArea(savedPos, PET_WIN_WIDTH, PET_WIN_HEIGHT)
    : getDefaultPetPosition();

  petWindow = new BrowserWindow({
    width: PET_WIN_WIDTH,
    height: PET_WIN_HEIGHT,
    x: startPos.x,
    y: startPos.y,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: store.config.preferences.alwaysOnTop !== false,
    icon: path.join(ASSETS_DIR, 'icon.png'),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  if (store.config.preferences.alwaysOnTop !== false) {
    petWindow.setAlwaysOnTop(true, 'floating');
  }

  petWindow.loadFile(path.join(ROOT_DIR, 'src', 'renderer', 'pet', 'pet.html'));

  petWindow.webContents.on('did-finish-load', () => {
    // Enable pass-through with forwarding so mousemove still reaches transparent window
    petWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  if (process.argv.includes('--dev')) {
    petWindow.webContents.openDevTools({ mode: 'detach' });
  }

  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function computeSmartChatPosition() {
  const primary = screen.getPrimaryDisplay();
  if (!petWindow || petWindow.isDestroyed()) {
    const wa = primary.workArea;
    return {
      x: Math.round(wa.x + (wa.width - CHAT_WIN_WIDTH) / 2),
      y: Math.round(wa.y + (wa.height - CHAT_WIN_HEIGHT) / 2)
    };
  }

  const petBounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(petBounds) || primary;
  const wa = display.workArea;

  // Prefer placing chat panel to the left of the whale if whale is on right side of screen
  let targetX = petBounds.x - CHAT_WIN_WIDTH + 20;
  if (targetX < wa.x + 12) {
    targetX = petBounds.x + petBounds.width - 20;
  }
  let targetY = petBounds.y + petBounds.height - CHAT_WIN_HEIGHT - 16;

  return clampToVisibleWorkArea({ x: targetX, y: targetY }, CHAT_WIN_WIDTH, CHAT_WIN_HEIGHT);
}

function createChatWindow() {
  const pos = computeSmartChatPosition();
  chatWindow = new BrowserWindow({
    width: CHAT_WIN_WIDTH,
    height: CHAT_WIN_HEIGHT,
    minWidth: 380,
    minHeight: 520,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    hasShadow: true,
    resizable: true,
    alwaysOnTop: store.config.preferences.alwaysOnTop !== false,
    icon: path.join(ASSETS_DIR, 'icon.png'),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (store.config.preferences.alwaysOnTop !== false) {
    chatWindow.setAlwaysOnTop(true, 'floating');
  }

  chatWindow.loadFile(path.join(ROOT_DIR, 'src', 'renderer', 'chat', 'chat.html'));

  chatWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      chatWindow.hide();
    }
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

function openChatWindow(tab = 'chat') {
  if (!chatWindow || chatWindow.isDestroyed()) {
    createChatWindow();
    chatWindow.webContents.once('did-finish-load', () => {
      chatWindow.show();
      chatWindow.focus();
      chatWindow.webContents.send('chat:switch-tab', tab);
    });
    return { open: true };
  }

  if (!chatWindow.isVisible()) {
    const pos = computeSmartChatPosition();
    chatWindow.setPosition(pos.x, pos.y);
    chatWindow.show();
  }
  chatWindow.focus();
  chatWindow.webContents.send('chat:switch-tab', tab);
  return { open: true };
}

function toggleChatWindow(tab = 'chat') {
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible() && tab === 'chat') {
    chatWindow.hide();
    return { open: false };
  }
  return openChatWindow(tab);
}

function buildAppContextMenu() {
  const prefs = store.config.preferences;
  return Menu.buildFromTemplate([
    {
      label: '💬 打开深海 AI 对话舱 (Alt+W)',
      click: () => openChatWindow('chat')
    },
    {
      label: '🌟 小鲸养成与人设切换',
      click: () => openChatWindow('persona')
    },
    {
      label: '⚙️ API Key 与模型设置',
      click: () => openChatWindow('settings')
    },
    { type: 'separator' },
    {
      label: '🧭 桌面自由巡游',
      type: 'checkbox',
      checked: Boolean(prefs.roamEnabled),
      click: (item) => {
        const updated = store.updateConfig({ preferences: { roamEnabled: item.checked } });
        broadcast('config:updated', updated);
        rebuildTrayMenu();
      }
    },
    {
      label: '📌 窗口始终置顶',
      type: 'checkbox',
      checked: prefs.alwaysOnTop !== false,
      click: (item) => {
        const updated = store.updateConfig({ preferences: { alwaysOnTop: item.checked } });
        applyAlwaysOnTop(item.checked);
        broadcast('config:updated', updated);
        rebuildTrayMenu();
      }
    },
    {
      label: '🔒 专注模式（锁定鼠标完全穿透）',
      type: 'checkbox',
      checked: Boolean(prefs.clickThroughLock),
      click: (item) => {
        const updated = store.updateConfig({ preferences: { clickThroughLock: item.checked } });
        if (petWindow && !petWindow.isDestroyed()) {
          petWindow.setIgnoreMouseEvents(true, { forward: true });
        }
        broadcast('config:updated', updated);
        rebuildTrayMenu();
      }
    },
    {
      label: '🔊 海洋互动音效',
      type: 'checkbox',
      checked: prefs.soundEnabled !== false,
      click: (item) => {
        const updated = store.updateConfig({ preferences: { soundEnabled: item.checked } });
        broadcast('config:updated', updated);
        rebuildTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: '🌊 表演双弧喷水柱',
      click: () => broadcast('pet:external-action', { action: 'spout' })
    },
    {
      label: '🦐 投喂算力磷虾',
      click: () => {
        const res = store.interactPet('feed');
        broadcast('pet:stats-updated', res);
        broadcast('pet:external-action', { action: 'eat' });
      }
    },
    {
      label: '📍 重置小鲸鱼回右下角',
      click: () => resetPetPosition()
    },
    {
      label: petWindow && petWindow.isVisible() ? '🙈 暂时隐藏小鲸鱼' : '🐳 显示小鲸鱼',
      click: () => {
        if (!petWindow || petWindow.isDestroyed()) return;
        if (petWindow.isVisible()) petWindow.hide();
        else petWindow.show();
        rebuildTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: '🚪 退出 DeepWhale',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function rebuildTrayMenu() {
  if (tray) {
    tray.setContextMenu(buildAppContextMenu());
  }
}

function createSystemTray() {
  const trayIconPath = path.join(ASSETS_DIR, 'tray-icon.png');
  const icon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(icon);
  tray.setToolTip('DeepWhale 深海小鲸 · AI 桌宠 (Alt+W 呼出对话)');
  rebuildTrayMenu();

  tray.on('click', () => {
    if (petWindow && !petWindow.isVisible()) {
      petWindow.show();
    }
    toggleChatWindow('chat');
  });
}

function applyAlwaysOnTop(flag) {
  for (const win of [petWindow, chatWindow]) {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(Boolean(flag), flag ? 'floating' : 'normal');
    }
  }
}

function resetPetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const pos = getDefaultPetPosition();
  petWindow.setPosition(pos.x, pos.y);
  petWindow.show();
  const updated = store.updateConfig({ preferences: { petPosition: pos } });
  broadcast('config:updated', updated);
  return pos;
}

function startDesktopLoops() {
  // 1. Global eye-tracking loop (20fps lightweight cursor delta relative to whale center)
  cursorTrackInterval = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || dragState) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    const whaleCenterX = bounds.x + bounds.width * 0.5;
    const whaleCenterY = bounds.y + bounds.height * 0.58;
    petWindow.webContents.send('pet:global-cursor', {
      dx: cursor.x - whaleCenterX,
      dy: cursor.y - whaleCenterY
    });
  }, 50);

  // 2. Autonomous desktop swimming loop (~30fps when roamEnabled is active)
  roamInterval = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
    if (!store.config.preferences.roamEnabled || dragState || isStreamingNow) return;

    roamTick += 1;
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
    const wa = display.workArea;

    const speed = 1.35;
    let nextX = bounds.x + roamDirection * speed;
    const bobY = Math.round(Math.sin(roamTick * 0.06) * 1.2);
    let nextY = Math.max(wa.y, Math.min(bounds.y + (roamTick % 8 === 0 ? bobY : 0), wa.y + wa.height - bounds.height));

    if (nextX <= wa.x + 8) {
      nextX = wa.x + 8;
      roamDirection = 1;
    } else if (nextX >= wa.x + wa.width - bounds.width - 8) {
      nextX = wa.x + wa.width - bounds.width - 8;
      roamDirection = -1;
    }

    petWindow.setPosition(Math.round(nextX), Math.round(nextY));
    if (roamTick % 3 === 0) {
      petWindow.webContents.send('pet:roam-state', {
        active: true,
        direction: roamDirection
      });
    }
  }, 33);
}

function registerIpcHandlers() {
  ipcMain.on('pet:set-ignore-mouse', (_event, ignore) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (store.config.preferences.clickThroughLock) {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    if (dragState) {
      petWindow.setIgnoreMouseEvents(false);
      return;
    }
    petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  ipcMain.on('pet:drag-start', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    dragState = {
      startCursorX: cursor.x,
      startCursorY: cursor.y,
      startWinX: bounds.x,
      startWinY: bounds.y,
      lastX: bounds.x,
      lastY: bounds.y,
      moved: false
    };
    petWindow.setIgnoreMouseEvents(false);

    if (dragInterval) clearInterval(dragInterval);
    dragInterval = setInterval(() => {
      if (!dragState || !petWindow || petWindow.isDestroyed()) return;
      const cur = screen.getCursorScreenPoint();
      const dx = cur.x - dragState.startCursorX;
      const dy = cur.y - dragState.startCursorY;

      if (!dragState.moved && Math.hypot(dx, dy) > 4) {
        dragState.moved = true;
      }

      if (dragState.moved) {
        const nextX = dragState.startWinX + dx;
        const nextY = dragState.startWinY + dy;
        const vx = nextX - dragState.lastX;
        const vy = nextY - dragState.lastY;
        dragState.lastX = nextX;
        dragState.lastY = nextY;
        petWindow.setPosition(nextX, nextY);
        petWindow.webContents.send('pet:drag-motion', { vx, vy });
      }
    }, 16);
  });

  ipcMain.on('pet:drag-end', () => {
    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }
    if (dragState && dragState.moved && petWindow && !petWindow.isDestroyed()) {
      const b = petWindow.getBounds();
      store.updateConfig({ preferences: { petPosition: { x: b.x, y: b.y } } });
      petWindow.webContents.send('pet:drag-settled', { moved: true });
    } else if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:drag-settled', { moved: false });
    }
    dragState = null;
  });

  ipcMain.on('pet:context-menu', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const menu = buildAppContextMenu();
    menu.popup({ window: petWindow });
  });

  ipcMain.on('pet:trigger-action', (_event, payload) => {
    broadcast('pet:external-action', payload);
  });

  // Window IPC
  ipcMain.handle('window:open-chat', (_e, tab) => openChatWindow(tab));
  ipcMain.handle('window:toggle-chat', (_e, tab) => toggleChatWindow(tab));
  ipcMain.handle('window:close-chat', () => {
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.hide();
    return { open: false };
  });
  ipcMain.handle('window:minimize-chat', () => {
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:reset-pet', () => resetPetPosition());

  // Store & Pet Stats IPC
  ipcMain.handle('store:get-config', () => store.getConfig());
  ipcMain.handle('store:update-config', (_e, partial) => {
    const updated = store.updateConfig(partial);
    if (partial?.preferences && 'alwaysOnTop' in partial.preferences) {
      applyAlwaysOnTop(updated.preferences.alwaysOnTop);
    }
    if (partial?.preferences && 'clickThroughLock' in partial.preferences && updated.preferences.clickThroughLock) {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    }
    rebuildTrayMenu();
    broadcast('config:updated', updated);
    return updated;
  });

  ipcMain.handle('pet:interact', (_e, action) => {
    const res = store.interactPet(action);
    broadcast('pet:stats-updated', res);
    return res;
  });

  // Chat & Streaming AI IPC
  ipcMain.handle('chat:get-messages', () => store.getMessages());
  ipcMain.handle('chat:clear-messages', () => {
    const empty = store.clearMessages();
    broadcast('chat:cleared', empty);
    return empty;
  });

  ipcMain.handle('chat:abort', () => {
    const stopped = aiService.abortActiveStream();
    isStreamingNow = false;
    return { stopped };
  });

  ipcMain.handle('chat:send', async (_e, userText) => {
    const clean = (userText || '').trim();
    if (!clean) return null;

    isStreamingNow = true;
    try {
      const result = await aiService.streamChat(clean, {
        onStart: (info) => {
          broadcast('chat:stream-start', info);
          broadcast('pet:stats-updated', {
            stats: store.config.petStats,
            leveledUp: false,
            expNeeded: store.config.petStats.level * 100
          });
        },
        onReasoning: (rPayload) => {
          broadcast('chat:stream-reasoning', rPayload);
        },
        onEmotion: (emotion) => {
          broadcast('chat:stream-emotion', { emotion });
        },
        onToken: (tPayload) => {
          broadcast('chat:stream-token', tPayload);
        },
        onComplete: (finalMsg) => {
          isStreamingNow = false;
          broadcast('chat:stream-done', finalMsg);
        },
        onError: (errPayload) => {
          isStreamingNow = false;
          broadcast('chat:stream-error', errPayload);
        }
      });
      return result;
    } catch (err) {
      isStreamingNow = false;
      return { error: err.message };
    }
  });

  ipcMain.handle('ai:test-connection', (_e, tempApiConfig) => aiService.testConnection(tempApiConfig));
  ipcMain.handle('ai:check-balance', (_e, tempApiConfig) => aiService.checkBalance(tempApiConfig));

  // System Helpers
  ipcMain.handle('system:read-clipboard', () => clipboard.readText() || '');
  ipcMain.handle('system:write-clipboard', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('system:open-external', (_e, url) => {
    if (/^https?:\/\//i.test(url || '')) {
      shell.openExternal(url);
    }
    return { ok: true };
  });
}

app.whenReady().then(() => {
  store = new LocalStore();
  aiService = new AIService(store);

  registerIpcHandlers();
  createPetWindow();
  createSystemTray();
  startDesktopLoops();

  globalShortcut.register('Alt+W', () => {
    if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) {
      petWindow.show();
    }
    toggleChatWindow('chat');
  });

  if (process.argv.includes('--smoke-exit')) {
    createChatWindow();
    Promise.all([
      new Promise((resolve) => petWindow.webContents.once('did-finish-load', resolve)),
      new Promise((resolve) => chatWindow.webContents.once('did-finish-load', resolve))
    ]).then(() => {
      console.log('[Smoke] Electron PetWindow + ChatWindow loaded cleanly.');
      isQuitting = true;
      setTimeout(() => app.quit(), 250);
    });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (dragInterval) clearInterval(dragInterval);
  if (cursorTrackInterval) clearInterval(cursorTrackInterval);
  if (roamInterval) clearInterval(roamInterval);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
