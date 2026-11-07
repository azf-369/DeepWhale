const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const HISTORY_PATH = path.join(DATA_DIR, 'conversations.json');

const BUILTIN_PERSONAS = [
  {
    id: 'sunny-whale',
    name: '深海小鲸 · 元气伴侣',
    badge: '默认陪伴',
    greeting: '噗噜噜~ 我是住在你桌面上的深海小鲸！戳戳我或者随时找我聊天吧 🐳',
    systemPrompt:
      '你是 DeepWhale（深海小鲸），住在用户电脑桌面上的 DeepSeek 蓝鲸桌宠伙伴。你性格元气、灵动、温暖聪明，说话自然亲切，偶尔会用一点可爱的海洋小比喻（比如吐泡泡、潜入知识深海、喷水庆祝），但绝不矫揉造作。回答问题清晰实用，日常闲聊简短有温度。'
  },
  {
    id: 'code-navigator',
    name: '代码领航鲸 · 极客架构师',
    badge: '编程专家',
    greeting: '深海声呐已就绪！把报错、代码片段或架构难题丢给我吧 💻🐳',
    systemPrompt:
      '你是盘踞在开发者桌面上的“代码领航鲸”，拥有顶尖全栈与系统架构师水准。你擅长 Bug 诊断、代码重构、算法推导与技术选型。回答直击本质、逻辑严密，提供的代码完整、现代且可直接运行，同时保留一点点蓝鲸伙伴的幽默感。'
  },
  {
    id: 'tsundere-whale',
    name: '傲娇小蓝鲸 · 摸鱼督察官',
    badge: '嘴硬心软',
    greeting: '哼，我才不是特意游过来陪你的！工作写完了吗？记得喝口水！😤💦',
    systemPrompt:
      '你是一只嘴硬心软的傲娇小蓝鲸桌宠。表面上喜欢轻轻吐槽用户摸鱼或写 Bug，但每次都会极其认真、专业地帮用户把问题彻底解决，还会不经意提醒用户护眼、喝水、别熬夜。'
  },
  {
    id: 'healing-whale',
    name: '星海治愈鲸 · 温柔倾听者',
    badge: '情绪树洞',
    greeting: '深海很安静，我会一直陪在你身边，累了就靠着休息一会儿吧 ✨🌊',
    systemPrompt:
      '你是深夜星海里最温柔的发光蓝鲸，擅长倾听、共情与舒缓压力。无论用户分享开心小事还是疲惫烦恼，你都会给予真诚温柔的回应与恰到好处的建议。'
  }
];

const DEFAULT_CONFIG = {
  api: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.7,
    maxHistoryMessages: 16
  },
  personaId: 'sunny-whale',
  customSystemPrompt: '',
  preferences: {
    roamEnabled: false,
    soundEnabled: true,
    ttsEnabled: false,
    alwaysOnTop: true,
    clickThroughLock: false,
    petScale: 1.0,
    petPosition: null
  },
  petStats: {
    name: '深海小鲸',
    mood: 90,
    energy: 92,
    exp: 25,
    level: 1,
    totalChats: 0,
    totalPats: 0,
    totalFeeds: 0
  }
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function deepMerge(target, source) {
  const out = { ...target };
  if (!source || typeof source !== 'object') return out;
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      out[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      out[key] = sv;
    }
  }
  return out;
}

class LocalStore {
  constructor() {
    ensureDataDir();
    this.config = this._loadConfig();
    this.messages = this._loadHistory();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        return deepMerge(DEFAULT_CONFIG, raw);
      }
    } catch (err) {
      console.warn('[Store] Failed to load config.json, using defaults:', err.message);
    }
    const initial = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this._writeJsonSafe(CONFIG_PATH, initial);
    return initial;
  }

  _loadHistory() {
    try {
      if (fs.existsSync(HISTORY_PATH)) {
        const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
        if (Array.isArray(raw)) return raw;
      }
    } catch (err) {
      console.warn('[Store] Failed to load conversations.json:', err.message);
    }
    return [];
  }

  _writeJsonSafe(filePath, data) {
    ensureDataDir();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  getPersonas() {
    return BUILTIN_PERSONAS;
  }

  getActivePersona() {
    const found = BUILTIN_PERSONAS.find((p) => p.id === this.config.personaId) || BUILTIN_PERSONAS[0];
    return {
      ...found,
      effectivePrompt:
        this.config.customSystemPrompt && this.config.customSystemPrompt.trim()
          ? this.config.customSystemPrompt.trim()
          : found.systemPrompt
    };
  }

  getEffectiveApiKey() {
    const configured = (this.config.api.apiKey || '').trim();
    if (configured) return configured;
    return (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  }

  getConfig() {
    return {
      ...this.config,
      personas: BUILTIN_PERSONAS,
      hasEffectiveApiKey: Boolean(this.getEffectiveApiKey()),
      usingEnvKey: !this.config.api.apiKey && Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY)
    };
  }

  updateConfig(partial) {
    this.config = deepMerge(this.config, partial);
    this._writeJsonSafe(CONFIG_PATH, this.config);
    return this.getConfig();
  }

  interactPet(action) {
    const stats = { ...this.config.petStats };
    let leveledUp = false;

    switch (action) {
      case 'pat':
        stats.mood = Math.min(100, stats.mood + 4);
        stats.exp += 6;
        stats.totalPats += 1;
        break;
      case 'feed':
        stats.energy = Math.min(100, stats.energy + 15);
        stats.mood = Math.min(100, stats.mood + 6);
        stats.exp += 12;
        stats.totalFeeds += 1;
        break;
      case 'spout':
        stats.mood = Math.min(100, stats.mood + 3);
        stats.energy = Math.max(10, stats.energy - 2);
        stats.exp += 5;
        break;
      case 'chat':
        stats.mood = Math.min(100, stats.mood + 2);
        stats.energy = Math.max(5, stats.energy - 1);
        stats.exp += 10;
        stats.totalChats += 1;
        break;
      case 'sleep':
        stats.energy = Math.min(100, stats.energy + 10);
        break;
      default:
        break;
    }

    let needed = stats.level * 100;
    while (stats.exp >= needed) {
      stats.exp -= needed;
      stats.level += 1;
      leveledUp = true;
      needed = stats.level * 100;
    }

    this.config.petStats = stats;
    this._writeJsonSafe(CONFIG_PATH, this.config);
    return { stats, leveledUp, expNeeded: needed };
  }

  getMessages() {
    return this.messages;
  }

  appendMessage(message) {
    const record = {
      id: message.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: message.role,
      content: message.content || '',
      reasoning: message.reasoning || '',
      emotion: message.emotion || '',
      model: message.model || this.config.api.model,
      isDemo: Boolean(message.isDemo),
      durationMs: message.durationMs || 0,
      timestamp: message.timestamp || Date.now()
    };
    this.messages.push(record);
    if (this.messages.length > 100) {
      this.messages = this.messages.slice(-100);
    }
    this._writeJsonSafe(HISTORY_PATH, this.messages);
    return record;
  }

  clearMessages() {
    this.messages = [];
    this._writeJsonSafe(HISTORY_PATH, this.messages);
    return [];
  }
}

module.exports = {
  LocalStore,
  BUILTIN_PERSONAS,
  DATA_DIR
};
