# Risk Register

> **Project:** RolePlay Studio (`roleplay-studio`)
> **Last Updated:** 2026-11-14

---

## Risk Summary

| Total | Open | Mitigated | Closed |
|---|---|---|---|
| 5 | 0 | 5 | 0 |

### Risk Matrix

|  | Low Impact | Medium Impact | High Impact |
|---|---|---|---|
| **High Likelihood** | Monitor | 🔴 Critical | 🔴 Critical |
| **Medium Likelihood** | Monitor | 🟡 Significant | 🔴 Critical |
| **Low Likelihood** | Accept | Monitor | 🟡 Significant |

---

## Risks

### RISK-001 — Edge TTS WebSocket 403 Forbidden Blocking

| Field | Value |
|---|---|
| **Likelihood** | High |
| **Impact** | Medium |
| **Rating** | 🟡 Medium |
| **Status** | Mitigated |
| **Owner** | Tech Lead |
| **Identified** | 2026-11-14 |

**Description**
> Microsoft's `speech.platform.bing.com` WebSocket endpoint periodically blocks automated or region-specific handshakes with `HTTP/1.1 403 Forbidden`.

**Mitigation Plan**
> Implemented a 3-tier automatic fallback inside `/api/edge-tts` (`vite.config.ts`): if Edge WebSocket fails, it transparently falls back to Google Cloud Stream TTS (`translate_tts`, 0 VRAM) and then Windows Native SAPI (`System.Speech`, 100% offline WAV), plus allows selecting any engine directly in Service Hub.

---

### RISK-002 — RTX 5070 Ti (Blackwell `sm_120`) PyTorch & Torchaudio Compatibility

| Field | Value |
|---|---|
| **Likelihood** | High |
| **Impact** | High |
| **Rating** | 🔴 High |
| **Status** | Mitigated |
| **Owner** | Tech Lead |
| **Identified** | 2026-11-14 |

**Description**
> RTX 5070 Ti requires CUDA 12.8 (`cu128`) PyTorch 2.11+ wheels, where `torchaudio.load()` defaults to `load_with_torchcodec` (unavailable on Windows), causing `400 Bad Request` in GPT-SoVITS. Additionally, `pip install -r requirements.txt` can overwrite `torch+cu128` with CPU `torch` from PyPI.

**Mitigation Plan**
> Force-installed `torch-2.11.0+cu128`, `torchvision-0.26.0+cu128`, and `torchaudio-2.11.0+cu128` into `I:\GPT-SoVITS\runtime`, and added a `soundfile`/`librosa` compatibility shim in `sitecustomize.py` and `tools/portable_runtime.py`.

---

### RISK-003 — GPT-SoVITS Gibberish Output from Mismatched `prompt_text`

| Field | Value |
|---|---|
| **Likelihood** | High |
| **Impact** | High |
| **Rating** | 🔴 High |
| **Status** | Mitigated |
| **Owner** | Tech Lead |
| **Identified** | 2026-11-14 |

**Description**
> In GPT-SoVITS, if a user sets a custom `.wav` reference clip while `prompt_text` still contains the default starter transcript (or an inaccurate transcript), phoneme-to-audio alignment fails and produces gibberish speech.

**Mitigation Plan**
> Automatically clear starter `prompt_text` (`""`) whenever a custom `.wav` path is used so GPT-SoVITS v2 runs in **Reference-Text-Free Mode**, and added 1-click preset buttons in Service Hub (`Starter Chinese WAV`, `Starter English WAV`, `Clear Transcript`).

---

### RISK-004 — GPU VRAM Contention Across LLM, ComfyUI & Local TTS

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | High |
| **Rating** | 🟡 Medium |
| **Status** | Mitigated |
| **Owner** | Tech Lead |
| **Identified** | 2026-11-09 |

**Description**
> Running Ollama LLM inference, ComfyUI image generation, and GPT-SoVITS simultaneously on a single 16 GB GPU can cause VRAM spikes or slowdowns.

**Mitigation Plan**
> All heavy AI operations (LLM narrative, scene prompt generation, ComfyUI image generation, and local GPU TTS synthesis) are serialized through `aiTaskQueue` (`src/services/aiTaskQueue.ts`), and GPT-SoVITS runs in FP16 (`is_half: True`, ~1.8 GB VRAM) with `use_cuda_graph: false` to avoid startup compilation stalls.

---

### RISK-005 — System Drive (`C:\`) Disk Space Exhaustion

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Rating** | 🟢 Low |
| **Status** | Mitigated |
| **Owner** | Tech Lead |
| **Identified** | 2026-11-14 |

**Description**
> Large AI runtimes, pretrained checkpoints (~5+ GB), and Conda environments can quickly fill `C:\`.

**Mitigation Plan**
> Installed GPT-SoVITS and its self-contained Conda environment (`I:\GPT-SoVITS\runtime`) and pretrained weights entirely on `I:\` (`400+ GB` free), and stored RolePlay Studio's database, images, and cached audio under `i:\Claude\Project\RolePlay\data\`.
