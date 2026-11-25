# Project Charter

## Project Overview

| Field | Value |
|---|---|
| **Project Name** | RolePlay Studio (`roleplay-studio`) |
| **Project Manager** | Project Owner |
| **Start Date** | 2026-11-01 |
| **Target Launch Date** | 2026-11-30 |
| **Status** | Complete |

---

## Problem Statement

> Running local role-play AI workflows typically requires juggling separate tools for LLM chat (SillyTavern/Ollama), visual scene generation (ComfyUI), and character voice synthesis (Edge TTS / Kokoro / GPT-SoVITS), often resulting in VRAM contention, inconsistent character appearance/clothing state, and fragmented data storage.

---

## Project Goal

> Deliver an all-in-one, local-first AI Role-Play & Visual Novel Studio that unifies LLM storytelling, ComfyUI scene/portrait generation, dynamic character state/inventory HUD tracking, and multi-engine character/NPC voice synthesis under a single GPU-aware task queue.

---

## Scope

### In Scope
- **Multi-Provider LLM Storytelling**: Local Ollama, LM Studio, and OpenAI-compatible chat/narrative generation with bilingual (EN/ZH) prompt engineering and Lorebook/World Info injection.
- **Character Card V2 & Persona Management**: Full Character Card V2 JSON import/export, visual appearance locks, reference portraits, and user persona switching.
- **ComfyUI Visual Generation Pipeline**: Workflow Manager with heuristic node binding, SDXL & Qwen-Image-Edit support, reference image lock, and automatic scene prompt extraction.
- **Dynamic Status & Outfit HUD (`statusTracker`)**: Real-time tracking of character outfit, location, affection, arousal/mood, and inventory blocks embedded in narrative responses.
- **Multi-Engine Text-to-Speech (TTS) & NPC Attribution**:
  - Built-in 0-VRAM 3-Tier Cloud/Offline TTS (`Edge Neural TTS` -> `Google Cloud Stream TTS` -> `Windows Native SAPI`).
  - Local GPU OpenAI-Compatible TTS (`/v1/audio/speech` for Kokoro-FastAPI / Fish Speech).
  - Local GPU Zero-Shot Voice Cloning via **GPT-SoVITS** (`http://127.0.0.1:9880` on RTX 5070 Ti `cu128`).
  - Generalized 3-Tier Multi-Voice NPC Attribution (Main Character, Known Secondary Character Cards, and Opposite-Gender/External NPC dialogue).
- **Local Disk Persistence & LAN Hosting**: Automatic filesystem persistence (`data/db.json`, `data/images/`, `data/audio/`) via Vite middleware and 1-click LAN hosting (`start-roleplay.bat`).

### Out of Scope
- Cloud-hosted multi-tenant user authentication or paid SaaS billing.
- Training full LLM checkpoints from scratch inside the web UI.

---

## Stakeholders

| Name | Role | Involvement |
|---|---|---|
| Project Owner | Sponsor & Product Lead | Requirements, UX review, hardware testing |
| Antigravity AI | Tech Lead & Developer | Architecture, full-stack implementation, GPU/TTS integration |
| Local Players | End Users | Story creation, character card import, LAN/Desktop usage |

---

## Key Constraints

| Constraint | Details |
|---|---|
| **Hardware / VRAM** | NVIDIA GeForce RTX 5070 Ti (16 GB VRAM, Blackwell `sm_120`, CUDA 12.8 `cu128`) |
| **Disk Layout** | Project in `i:\Claude\Project\RolePlay`; external AI runtimes (e.g., `I:\GPT-SoVITS`) stored on `I:\` to preserve `C:\` free space |
| **Tech Stack** | React 18, TypeScript, Vite 5, Tailwind CSS, Electron, Node.js HTTP/WebSocket middleware |
| **VRAM Coordination** | LLM, ComfyUI, and local GPU TTS tasks must serialize through `aiTaskQueue` to avoid CUDA Out-Of-Memory |

---

## Success Criteria

1. Zero data loss across browser refreshes and restarts via `data/db.json`, `data/images/`, and `data/audio/`.
2. Seamless visual continuity in ComfyUI scene generation using character visual prompts, outfit state HUD, and reference images.
3. Instant, reliable voice playback across both 0-VRAM engines and local GPU zero-shot voice cloning (`GPT-SoVITS` on RTX 5070 Ti), with distinct voices for NPC dialogue.
4. Self-documented, generalized in-app Guide & FAQ (`GuideAndFaqView.tsx`) accessible to any new user.

---

## Approval

| Stakeholder | Signature | Date |
|---|---|---|
| Project Owner | Approved | 2026-11-14 |
