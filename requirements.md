# Requirements

> **Project:** RolePlay Studio (`roleplay-studio`)
> **Last Updated:** 2026-11-14

---

## Summary

| Total | Approved | In Progress | Done | Deferred |
|---|---|---|---|---|
| 10 | 0 | 0 | 10 | 0 |

---

## Requirements

### REQ-001 — Multi-Provider LLM Narrative & Role-Play Engine

| Field | Value |
|---|---|
| **Priority** | Critical |
| **Status** | Done |
| **Added** | 2026-11-01 |

**User Story**
> As a role-play creator, I want to connect local Ollama or OpenAI-compatible LLM endpoints with separate Chat and Scene Prompt models so that I can generate immersive, uncensored role-play narratives and structured visual prompts.

**Acceptance Criteria**
- [x] Configure primary Chat LLM and optional dedicated Scene Prompt LLM in Service Hub (`ServiceHubView.tsx`).
- [x] Support streaming responses, message regeneration, editing, and bilingual (EN/ZH) output.
- [x] Inject Character Card V2 persona, scenario, example dialogue, and active Lorebook entries into context.

**Notes**
> Implemented in `src/services/llmService.ts`, `src/services/promptEngine.ts`, and `src/components/ServiceHubView.tsx`.

---

### REQ-002 — Character Card V2, Persona & Story Lore Management

| Field | Value |
|---|---|
| **Priority** | Critical |
| **Status** | Done |
| **Added** | 2026-11-02 |

**User Story**
> As a player, I want to create, edit, import, and export SillyTavern-compatible Character Card V2 JSON files (including visual tags, portraits, and voice settings) and manage user personas and story-specific lorebooks so that my characters are portable and consistent.

**Acceptance Criteria**
- [x] Import/export V2 Character Cards (`chara_card_v2`) with custom `extensions.roleplay_studio` metadata (`visualPrompt`, `gender`, `voiceConfig`).
- [x] Auto-clean Danbooru/booru weight syntax and infer character gender accurately.
- [x] Support per-story Lorebooks (`storyLore`) and multi-character group scenes.

**Notes**
> Implemented in `src/utils/characterCard.ts`, `src/components/CharactersView.tsx`, and `src/components/CharacterModal.tsx`.

---

### REQ-003 — ComfyUI Visual Generation & Heuristic Workflow Binding

| Field | Value |
|---|---|
| **Priority** | Critical |
| **Status** | Done |
| **Added** | 2026-11-05 |

**User Story**
> As a visual storyteller, I want to import ComfyUI API workflows (SDXL, Illustrious, Qwen-Image-Edit) and automatically bind positive/negative prompts, seed, dimensions, and character reference images so that I can generate portraits and scene illustrations directly in chat.

**Acceptance Criteria**
- [x] Heuristic workflow parser maps `positive_prompt`, `negative_prompt`, `seed`, `width`, `height`, and `reference_image` nodes automatically (`src/services/comfyService.ts`).
- [x] Prevent system-prompt nodes in Qwen-Edit workflows from being overwritten by positive scene prompts.
- [x] Support per-character preferred workflow overrides and reference image locking.

**Notes**
> Implemented in `src/services/comfyService.ts` and `src/components/WorkflowManagerView.tsx`.

---

### REQ-004 — Dynamic Character Status, Outfit & Inventory HUD

| Field | Value |
|---|---|
| **Priority** | High |
| **Status** | Done |
| **Added** | 2026-11-08 |

**User Story**
> As a player, I want the character's current outfit, location, mood/affection, and inventory to update automatically after each turn and feed into ComfyUI image prompts so that visual generations always match what the character is currently wearing and doing.

**Acceptance Criteria**
- [x] Parse structured status blocks from LLM responses (`src/utils/statusTracker.ts`).
- [x] Render collapsible status HUD cards in chat without cluttering spoken dialogue.
- [x] Feed active outfit and location state into ComfyUI scene prompt generation.

**Notes**
> Implemented in `src/utils/statusTracker.ts` and `src/components/RolePlayView.tsx`.

---

### REQ-005 — Multi-Engine Text-to-Speech (TTS) & Zero-Shot Voice Cloning

| Field | Value |
|---|---|
| **Priority** | High |
| **Status** | Done |
| **Added** | 2026-11-14 |

**User Story**
> As a player, I want to hear character dialogue spoken aloud using either zero-VRAM built-in voices or local GPU zero-shot voice cloning (`GPT-SoVITS` / `Kokoro`), with automatic audio caching to disk.

**Acceptance Criteria**
- [x] 3-Tier 0-VRAM built-in TTS engine in `vite.config.ts` (`Edge Neural TTS` -> `Google Cloud Stream TTS` -> `Windows Native SAPI`) that automatically bypasses Edge HTTP 403 blocks.
- [x] Support OpenAI-compatible local GPU TTS (`/v1/audio/speech` for Kokoro-FastAPI / Fish Speech).
- [x] Support **GPT-SoVITS** (`http://127.0.0.1:9880`) installed at `I:\GPT-SoVITS` with CUDA 12.8 (`torch 2.11.0+cu128`) for RTX 5070 Ti, including Reference-Text-Free Mode for custom `.wav` files and clean starter ZH/EN reference clips.
- [x] Cache synthesized audio files to `data/audio/` via `/api/audio` so replaying messages is instant.

**Notes**
> Implemented in `src/services/ttsService.ts`, `vite.config.ts`, `src/components/ServiceHubView.tsx`, and `I:\GPT-SoVITS`.

---

### REQ-006 — Generalized 3-Tier Multi-Voice NPC Attribution

| Field | Value |
|---|---|
| **Priority** | High |
| **Status** | Done |
| **Added** | 2026-11-14 |

**User Story**
> As a player in stories with multiple speakers or NPCs (e.g., phone calls, bystanders, secondary characters), I want quoted dialogue spoken by NPCs or secondary characters to automatically use distinct voices rather than the main character's voice.

**Acceptance Criteria**
- [x] Split message text into multi-speaker segments (`extractMultiSpeakerSegments` in `src/services/ttsService.ts`).
- [x] Tier 1: Main character dialogue uses the main character's configured voice.
- [x] Tier 2: Named secondary Character Cards in the workspace use their own `voiceConfig`.
- [x] Tier 3: Generic/unnamed NPC cues (e.g., male/female speech cues, phone/door/bystander cues) automatically switch to an opposite-gender or secondary voice preset.

**Notes**
> Implemented in `src/services/ttsService.ts`.

---

### REQ-007 — Generalized In-App Guide, FAQ & 1-Click Host Launchers

| Field | Value |
|---|---|
| **Priority** | Medium |
| **Status** | Done |
| **Added** | 2026-11-14 |

**User Story**
> As a user, I want clear, general-purpose documentation inside the app (`Guide & FAQ`) and 1-click `.bat` launchers for both RolePlay Studio (`start-roleplay.bat`) and GPT-SoVITS (`start-api.bat`, `start-webui.bat`).

**Acceptance Criteria**
- [x] Generalize all FAQ items in `src/components/GuideAndFaqView.tsx` so they apply to any character, workflow, or hardware setup.
- [x] Provide `start-roleplay.bat` in project root to launch `npm run host` (`0.0.0.0:5173`) and open the browser.
- [x] Provide `I:\GPT-SoVITS\start-api.bat` and `I:\GPT-SoVITS\start-webui.bat`.

**Notes**
> Implemented in `src/components/GuideAndFaqView.tsx` and `start-roleplay.bat`.

---

### REQ-008 — Per-Speaker Reference Audio in GPT-SoVITS Multi-NPC Scenes

| Field | Value |
|---|---|
| **Priority** | Medium |
| **Status** | Done |
| **Added** | 2026-11-14 |

**User Story**
> As a player using GPT-SoVITS zero-shot voice cloning, I want unnamed opposite-gender NPCs and secondary characters in a single message to automatically switch to their own `.wav` reference clip and play back as a seamless combined audio stream.

**Acceptance Criteria**
- [x] Generate distinct male starter reference WAVs (`default_ref_male_zh.wav` & `default_ref_male_en.wav`) alongside female starter WAVs (`default_ref_zh.wav` & `default_ref_en.wav`).
- [x] Attach per-segment `refAudioPath`, `refPromptText`, and `refPromptLang` in `extractMultiSpeakerSegments` (`src/services/ttsService.ts`).
- [x] Synthesize multi-speaker segments sequentially via GPT-SoVITS and concatenate PCM WAV buffers (`combineWavBuffers`) into a single cacheable WAV file.

**Notes**
> Implemented in `src/services/ttsService.ts` and `I:\GPT-SoVITS\voices\`.

---

### REQ-009 — 3-Layer Long-Term Story Memory & Auto-Lorebook Archiving

| Field | Value |
|---|---|
| **Priority** | Critical |
| **Status** | Done |
| **Added** | 2026-11-14 |

**User Story**
> As a long-term role-play storyteller playing 100+ turn campaigns, I want older turns that age out of the sliding context window to be permanently archived into episodic chapters with keyword auto-recall and automatic Lorebook extraction so early events, promises, and NPCs are never overwritten or forgotten.

**Acceptance Criteria**
- [x] **Layer 1 (Rolling Core Synopsis)**: Incrementally merge aged-out turns into `session.memorySummary` for active plot and relationship continuity.
- [x] **Layer 2 (Episodic Chapter Archive)**: Permanently record each summarized slice (`Turns X–Y`) as a `StoryMemoryChapter` in `session.memoryChapters` with title, concrete bullet points, trigger keywords, and Pin-to-Context support (`matchEpisodicMemoryChapters` in `src/services/promptEngine.ts`).
- [x] **Layer 3 (Auto-Lore Extraction)**: Automatically discover and merge newly introduced NPCs, locations, items, and secrets into `session.storyLore` during chapter archiving when `session.autoExtractLore` is enabled.
- [x] **Story Bible UI**: Manage Rolling Synopsis, Episodic Chapters (edit title/summary/keywords, Pin/Unpin, add/delete), and Auto-Lore toggle in `ChatWorkspaceView.tsx`.

**Notes**
> Implemented in `src/types/index.ts`, `src/services/promptEngine.ts`, and `src/components/ChatWorkspaceView.tsx`.

---

### REQ-010 — Visual Novel (VN) Theater & Immersive Stage Mode

| Field | Value |
|---|---|
| **Priority** | High |
| **Status** | Done |
| **Added** | 2026-11-14 |

**User Story**
> As a visual novel fan, I want a 1-click "VN Theater" mode inside the chat workspace that transforms the scrolling chat into a full-stage Visual Novel view with a dynamic scene backdrop, floating Live Status HUD, and translucent bottom dialogue box.

**Acceptance Criteria**
- [x] Add **VN Theater** toggle button in both Desktop and Mobile chat headers (`ChatWorkspaceView.tsx`).
- [x] Render full-stage ComfyUI scene illustration (or character reference portrait) with blurred ambient backdrop fill and click-to-zoom Lightbox support.
- [x] Include floating top stage bar (`Exit VN`, `◀ Prev / Next ▶ / Latest ⏭` turn stepper, `Visualize Scene`, `Prompt Studio`, and `HUD` toggle) plus a translucent top-right **Live Status HUD** overlay (`Location`, `Time`, `Outfit`, and progress meters).
- [x] Render a translucent bottom Visual Novel dialogue box with speaker nameplate, gender badge, recalled Lore/Chapter badges, `Speak` voice button, swipe switcher, live streaming text, and docked reply composer.

**Notes**
> Implemented in `src/components/ChatWorkspaceView.tsx`.
