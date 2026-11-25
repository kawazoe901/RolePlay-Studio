# Task Board

> **Project:** RolePlay Studio (`roleplay-studio`)
> **Last Updated:** 2026-11-14

---

## Milestone M1 — Core Role-Play Engine & Local Disk Persistence
- [x] **TASK-001**: Implement local filesystem database (`/api/db`) and image storage (`/api/images`) in `vite.config.ts` (`REQ-001`)
- [x] **TASK-002**: Build Character Card V2 JSON import/export with `roleplay_studio` extension metadata (`REQ-002`)
- [x] **TASK-003**: Implement Story Lorebooks and multi-character chat session support (`REQ-001`, `REQ-002`)

## Milestone M2 — ComfyUI Visual Pipeline & Dynamic Status HUD
- [x] **TASK-004**: Build heuristic ComfyUI workflow node mapper and protect Qwen-Edit system prompt nodes (`REQ-003`)
- [x] **TASK-005**: Implement real-time character outfit/location/affection status HUD parser (`src/utils/statusTracker.ts`) (`REQ-004`)
- [x] **TASK-006**: Generalize all entries in `src/components/GuideAndFaqView.tsx` to remove user-specific names and paths (`REQ-007`)

## Milestone M3 — Multi-Engine TTS, NPC Attribution & GPT-SoVITS Integration
- [x] **TASK-007**: Implement Multi-Engine TTS client (`src/services/ttsService.ts`), disk audio cache (`/api/audio`), and per-character voice settings (`REQ-005`)
- [x] **TASK-008**: Add 3-tier 0-VRAM fallback (`Edge TTS` -> `Google Cloud Stream TTS` -> `Windows Native SAPI`) to resolve Edge HTTP 403 handshake errors (`REQ-005`)
- [x] **TASK-009**: Implement Generalized 3-Tier Multi-Voice NPC Attribution (`extractMultiSpeakerSegments`) for secondary characters and opposite-gender NPCs (`REQ-006`)
- [x] **TASK-010**: Install GPT-SoVITS at `I:\GPT-SoVITS` with CUDA 12.8 (`torch-2.11.0+cu128`) for RTX 5070 Ti (`REQ-005`)
- [x] **TASK-011**: Patch `torchaudio.load` (`sitecustomize.py` & `tools/portable_runtime.py`), install `resampy`, and add file `mtime` cache invalidation in `TTS.py` (`REQ-005`)
- [x] **TASK-012**: Generate clean 32kHz Mandarin & English starter reference WAVs (`default_ref_zh.wav`, `default_ref_en.wav`) and auto-enable Reference-Text-Free Mode for custom `.wav` clips (`REQ-005`)
- [x] **TASK-013**: Create 1-click startup scripts (`start-roleplay.bat`, `I:\GPT-SoVITS\start-api.bat`, `I:\GPT-SoVITS\start-webui.bat`) (`REQ-007`)

## Milestone M4 — Advanced Audio Polish & Bundle Optimization
- [x] **TASK-014**: Support per-segment multi-speaker synthesis and PCM WAV concatenation (`combineWavBuffers`) in GPT-SoVITS with dedicated male/female starter reference clips (`default_ref_male_zh.wav`, `default_ref_male_en.wav`) (`REQ-008`)
- [x] **TASK-015**: Add **Browse WAV** file picker & `/api/ref-voice` upload endpoint in `ServiceHubView.tsx`, `CharactersAndLoreView.tsx`, and `vite.config.ts` (`REQ-005`)
- [x] **TASK-016**: Configure Rollup `manualChunks` (`vendor-react`, `vendor-icons`) in `vite.config.ts` so all production chunks build under 500 kB with zero warnings (`M4`)

## Milestone M5 — 3-Layer Long-Term Story Memory & Visual Novel Theater Mode
- [x] **TASK-017**: Implement 3-Layer Long-Term Story Memory (`StoryMemoryChapter` archive, keyword & pinned chapter recall in `buildRolePlayMessages`, single-pass chapter + auto-lore extraction in `generateIncrementalStorySummary`, and Story Bible Chapter Archive UI) (`REQ-009`)
- [x] **TASK-018**: Implement Visual Novel (`VN Theater`) Stage Mode in `ChatWorkspaceView.tsx` with full-stage scene/portrait backdrop, floating Live Status HUD overlay, turn stepper (`◀ / ▶ / Latest`), and translucent VN dialogue box (`REQ-010`)
