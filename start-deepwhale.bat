@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DeepWhale 深海小鲸启动器

if not exist "node_modules\electron\dist\electron.exe" (
    echo [DeepWhale] 首次运行，正在通过高速镜像安装 Electron 桌面运行环境...
    set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    call npm install
)

echo [DeepWhale] 正在唤醒桌面深海小鲸 (按 Alt+W 可呼出/隐藏 AI 对话舱)...
call npm start
