# RolePlay Studio

[![License](https://img.shields.io/github/license/kawazoe901/RolePlay-Studio?style=flat-square)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Ollama](https://img.shields.io/badge/LLM-Ollama%20%7C%20LM%20Studio%20%7C%20OpenAI-10B981?style=flat-square)](https://ollama.com/)
[![ComfyUI](https://img.shields.io/badge/Images-ComfyUI%20Optional-D946EF?style=flat-square)](https://github.com/comfyanonymous/ComfyUI)

A **local-first, all-in-one interactive AI role-play studio** that brings together local LLMs (**Ollama / LM Studio**), **ComfyUI** in-chat scene illustration, **multi-engine voice synthesis** (zero-VRAM Edge TTS, Kokoro/OpenAI TTS, GPT-SoVITS), **3-layer story memory & character evolution**, and a **customizable Status HUD** in a single clean web app — with built-in LAN & Tailscale mobile support.

---

## Why RolePlay Studio?

- **Zero-Friction Start**: Runs locally in seconds. **Microsoft Edge Neural TTS works out of the box with 0 VRAM**, and **ComfyUI / GPT-SoVITS are completely optional**.
- **All-in-One Local Workspace**: No juggling separate extensions for memory, status bars, voice cloning, and image generation.
- **3-Layer Story Memory & Evolution**: Combines a rolling synopsis, episodic archived chapters, and automatic character evolution tracking so long stories stay coherent.
- **Flexible Status HUD**: Track custom text fields and `Current / Max` numeric meters (e.g. `5/5`, `100/100`) per chat — editable inline on any turn.
- **Visual Novel & Standard Chat Modes**: Switch between classic chat cards and an immersive Visual Novel stage view with scene backgrounds.
- **ComfyUI Workflow Studio**: Includes starter workflows for **SDXL**, **Flux**, **Qwen Image Edit**, and **MOSS spatial layout**, with editable scene prompt previews and a per-chat image gallery.
- **Smart Voice & Audio Caching**: Multi-speaker NPC voice switching, one-click audio re-synthesis, and automatic `ffmpeg` WAV → MP3 compression (~90% smaller cache).
- **Safe Local Storage**: Atomic JSON database writes, automatic rolling backups in `data/backups/`, and a built-in Storage & Audio Cache Manager.

---

## Quick Start

### Prerequisites
- **Node.js 18+**
- **Ollama**, **LM Studio**, or any **OpenAI-compatible** LLM endpoint
- *(Optional)* **ComfyUI** for in-chat scene illustrations
- *(Optional)* **GPT-SoVITS** or **Kokoro/OpenAI TTS** for custom voices
- *(Optional)* **ffmpeg** on `PATH` for automatic WAV → MP3 audio cache compression

### Install & Run

```bash
git clone https://github.com/kawazoe901/RolePlay-Studio.git
cd RolePlay-Studio
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### LAN / Mobile (Tailscale or Wi-Fi)

```bash
npm run host
```

On Windows, you can also double-click `start-roleplay.bat`.

---

## Configuration & Local Data

- On first launch, the app automatically initializes with the starter characters, personas, lorebooks, and ComfyUI workflows in [`src/services/defaultData.ts`](src/services/defaultData.ts).
- Open the **Services** tab in the app to connect your **Ollama / LM Studio / OpenAI** endpoint, optional **ComfyUI** server, and **TTS** engine.
- All personal chats, characters, rolling backups, generated images, and cached audio are stored locally inside `data/` (excluded from Git via `.gitignore`).

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons
- **Local Server & Proxy**: Vite 5 custom middleware (`/api/proxy`, `/api/db`, `/api/images`, `/api/audio`, `/api/edge-tts`, `/api/storage`)
- **Desktop Wrapper**: Optional Electron entry (`electron/main.cjs`)
