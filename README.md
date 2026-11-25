# RolePlay Studio

A local-first interactive AI role-play studio with multi-character chats, dynamic Lorebooks, 3-layer story memory & character evolution, customizable Status HUD trackers, ComfyUI scene illustration workflows, and multi-engine voice synthesis (Edge TTS, Kokoro/OpenAI-compatible TTS, and GPT-SoVITS).

## Features

- **Local-First LLM Chat**: Works with **Ollama**, **LM Studio**, and any **OpenAI-compatible** endpoint via the built-in Vite proxy.
- **Character Cards, Personas & Lorebooks**: Create or import V2-style character cards, manage player personas, and trigger contextual Lorebook entries.
- **3-Layer Story Memory & Evolution**: Rolling synopsis, episodic archived chapters, and automatic character evolution tracking.
- **Flexible Status HUD**: Customizable text fields and `Current / Max` numeric meters (e.g. `5/5`, `100/100`) editable per turn.
- **ComfyUI Workflow Studio**: Built-in starter workflows (SDXL, Flux, Qwen Image Edit, MOSS spatial layout) with prompt preview and scene gallery.
- **Voice Synthesis (TTS)**: Zero-VRAM Microsoft Edge Neural TTS, OpenAI/Kokoro TTS, and GPT-SoVITS voice cloning with automatic `ffmpeg` MP3 caching.
- **Disk Protection & Backups**: Atomic JSON database writes, rolling snapshots in `data/backups/`, and a built-in Storage & Audio Cache Manager.

## Quick Start

### Prerequisites
- **Node.js 18+**
- *(Optional)* **Ollama** or **LM Studio** for local LLM inference
- *(Optional)* **ComfyUI** for in-chat scene illustration
- *(Optional)* **ffmpeg** on `PATH` for automatic WAV → MP3 audio cache compression

### Install & Run

```bash
npm install
npm run dev
```

Or launch with LAN / Tailscale access (binds `0.0.0.0:5173`):

```bash
npm run host
```

On Windows, you can also double-click `start-roleplay.bat`.

## Default Setup & Local Data

- Personal runtime data (`data/roleplay-db.json`, `data/images/`, `data/audio/`, `data/backups/`) is excluded via `.gitignore`.
- On first launch, the app automatically initializes with the starter characters, personas, lorebooks, and ComfyUI workflows defined in `src/services/defaultData.ts`.
- Configure your LLM, ComfyUI, and TTS endpoints inside the **Services** tab.
