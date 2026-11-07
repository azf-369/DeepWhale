# 🐳 DeepWhale（深海小鲸）— DeepSeek 鲸鱼桌面智能桌宠

**DeepWhale** 是一款基于 **Electron + 60fps Canvas 脊椎流体物理引擎** 开发的 DeepSeek 经典蓝鲸动画形象桌面宠物。它悬浮在你的系统桌面上，既拥有丰富的物理触感交互与轻养成陪伴机制，又能接入 **DeepSeek-V3 (`deepseek-chat`) / DeepSeek-R1 (`deepseek-reasoner`)** 等大模型 API 进行实时流式对话与情绪动作联动。

> 📄 同类开源项目调研报告与完整架构设计请参阅：[docs/RESEARCH_AND_PLAN.md](./docs/RESEARCH_AND_PLAN.md)

---

## ✨ 核心特性

### 1. 60fps 动态 DeepSeek 小蓝鲸形象与物理交互
- **高还原度矢量流体渲染**：复刻 DeepSeek 经典深海蓝渐变背部、冰白腹褶（Ventral Pleats）、双叶尾鳍与灵动大眼睛，自动适配 Windows 高分屏（HiDPI）。
- **全桌面鼠标目光跟随（Eye Tracking）**：即使你在其他软件中写代码或浏览网页，小蓝鲸的瞳孔也会柔和追随鼠标方位。
- **9 种细腻动画状态**：
  - `呼吸待机 (Idle)`：轻柔上下浮潜，自然眨眼与微气泡上浮。
  - `丝滑拖拽 (Dragging)`：随鼠标拖拽速度产生真实的**惯性摆尾与俯仰倾角**，松手后触发 Q 弹果冻回弹（Squash & Stretch）。
  - `摸头杀 & 戳一戳 (Petting / Shy)`：单击或沿背部来回轻抚，小鲸会眯眼微笑、脸红拍鳍并飘起爱心与鲸鸣声。
  - `双击喷水柱 (Spouting)`：双击小蓝鲸触发标志性的**双弧线喷泉水柱 + 水珠粒子飞溅**。
  - `桌面自由巡游 (Swimming)`：开启巡游后自动沿任务栏上方左右畅游，到屏幕边缘平滑转身。
  - `R1 深度思考星环 (Thinking)`：大模型推理期间，头顶浮现旋转的 DeepSeek 神经网络星座光环。
  - `流式韵律说话 (Speaking)` / `投喂磷虾 (Eating)` / `浅海休眠 (Sleeping)`。
- **像素级鼠标穿透**：基于 Canvas Alpha 通道实时检测，小鲸鱼周围的透明空白处**完全不挡鼠标点击桌面图标或底层窗口**；同时提供“专注模式”一键锁定全穿透。

### 2. 实时流式 AI 对话与动作联动
- **原生适配 DeepSeek 双模型**：一键切换 `⚡ V3 对话 (deepseek-chat)` 与 `🧠 R1 深度思考 (deepseek-reasoner)`，实时流式展示可折叠的 **`reasoning_content` 深度思考过程与耗时计时**。
- **AI 情绪标签驱动桌宠动作**：内置动作联动协议（`[happy]`、`[spout]`、`[shy]`、`[excited]`、`[think]`、`[sleepy]`、`[swim]`），AI 回复内容会实时驱动桌面小鲸做出对应表情与喷水庆祝。
- **双入口无缝对话**：
  - **轻量气泡快问**：悬停小鲸点击 `✨ 快问`，直接在小鲸脚下迷你输入框回车提问，小鲸头顶气泡实时流式作答。
  - **深海 AI 座舱（`Alt + W`）**：独立极光毛玻璃面板，支持流式 Markdown 代码块高亮、一键复制代码、随时中断生成。
- **DeepSeek 余额监控 & 多服务商预设**：内置 DeepSeek 官方 `/user/balance` 账户余额徽章；同时一键支持 **硅基流动（SiliconFlow）**、**本地 Ollama** 及任意 OpenAI 兼容接口。未配置 Key 时自带**零门槛本地智能陪伴演示模式**。
- **剪贴板生产力助手 & 轻养成**：复制代码或外文后点击 `📋 剪贴板` 一键解读/翻译；互动可积累经验升级，内置 4 套精选性格人设与 Web Audio 程序化海洋音效 + TTS 语音播报。

---

## 📂 项目目录结构

```text
D:\Note\Dev_note\Antigravity_deepseek_desktopApp_ws\
├── assets/                       # 高清透明背景 DeepSeek 小蓝鲸图标 (PNG / Tray / ICO)
├── docs/
│   └── RESEARCH_AND_PLAN.md      # 同类开源项目深度调研报告与开发计划书
├── src/
│   ├── main/
│   │   ├── main.js               # Electron 主进程：双透明窗管理、像素穿透、自由巡游、系统托盘与全局热键
│   │   ├── preload.js            # ContextBridge 安全 IPC 桥接层
│   │   ├── ai-service.js         # DeepSeek V3/R1 SSE 流式引擎、情绪标签解析器、余额查询与离线回退
│   │   └── store.js              # 本地 JSON 持久化配置、人设库与养成状态存储
│   └── renderer/
│       ├── shared/
│       │   ├── whale-engine.js   # 60fps DeepSeek 蓝鲸骨骼流体物理与粒子渲染引擎
│       │   ├── sound-fx.js       # Web Audio 零依赖海洋鲸鸣音效合成器 + Web Speech TTS
│       │   ├── markdown.js       # 流式安全 Markdown 与代码复制渲染器
│       │   └── bridge-shim.js    # Electron / 浏览器预览双模自适应桥接层
│       ├── pet/                  # 悬浮透明桌宠视图 (pet.html / pet.css / pet.js)
│       └── chat/                 # 深海 AI 对话、养成与配置座舱 (chat.html / chat.css / chat.js)
├── scripts/
│   ├── generate-icons.py         # Pillow 超采样小蓝鲸图标生成脚本
│   ├── web-preview.js            # 零依赖本地浏览器预览演练场服务
│   └── smoke-test.js             # 自动化集成测试脚本
├── data/                         # 运行时自动生成的本地配置与会话历史目录
├── start-deepwhale.bat           # Windows 双击一键启动脚本
└── package.json
```

---

## 🚀 快速启动指南

### 方式一：Windows 原生透明桌宠模式（推荐）
直接双击项目根目录下的 **`start-deepwhale.bat`**，或在终端执行：

```powershell
cd "D:\Note\Dev_note\Antigravity_deepseek_desktopApp_ws"

# 若首次尚未安装 Electron（国内网络如遇下载慢可先执行：$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"）
npm install

# 启动原生桌面悬浮小蓝鲸
npm start
```

### 方式二：浏览器预览演练场模式（零额外依赖即刻体验）
如果你想在浏览器中同时预览小鲸鱼动态交互与 AI 对话座舱：

```powershell
npm run web
```
随后在浏览器打开 `http://127.0.0.1:3988` 即可完整交互与对话。

### 运行自动化测试
```powershell
npm test
```

---

## 🔑 接入 DeepSeek API 配置步骤

1. 启动应用后，点击小鲸鱼下方的 **`💬 对话`** 按钮（或按全局快捷键 **`Alt + W`**）打开深海座舱。
2. 切换到顶部 **`⚙️ API 与设置`** 标签页：
   - **Base URL**：默认已填好 `https://api.deepseek.com`（也可点击上方预设胶囊一键切换硅基流动或本地 Ollama）。
   - **API Key**：粘贴你在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建的 `sk-...` 密钥（或者直接在系统环境变量中配置 `DEEPSEEK_API_KEY`，程序会自动识别）。
   - **模型名称**：支持 `deepseek-chat`（V3）或 `deepseek-reasoner`（R1），也可在聊天界面顶部一键秒切。
3. 点击 **`🔌 测试连接`** 验证延迟，点击 **`💾 保存配置`** 即可开始实时流式对话！

---

## 🎮 桌面交互速查表

| 交互方式 | 触发效果 |
| :--- | :--- |
| **左键按住拖拽小鲸鱼** | 全屏幕丝滑移动，尾巴随速度摆动，松手触发 Q 弹水花回弹 |
| **左键单击小鲸鱼** | 眯眼微笑 + 鲸鸣声 + 随机暖心台词 + 增加好感度 |
| **鼠标在小鲸背部来回轻抚** | 触发“摸头杀”害羞脸红拍鳍彩蛋 |
| **左键双击小鲸鱼** | 表演双弧线头顶喷水柱 + 水珠粒子特效 |
| **右键点击小鲸鱼 / 托盘图标** | 呼出系统级快捷菜单（巡游、置顶、专注穿透锁、投喂、唤回右下角、退出） |
| **快捷键 `Alt + W`** | 随时随地呼出或隐藏深海 AI 对话舱 |
