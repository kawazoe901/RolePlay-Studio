import { AppDatabase } from '../types';
import {
  DEFAULT_DATABASE,
  DEFAULT_TTS_SERVICE,
  STARTER_WORKFLOW_TEMPLATES,
} from './defaultData';
import { inferCharacterGender } from '../utils/characterCard';
import { cleanCharacterTag } from './promptEngine';
import { heuristicMapWorkflow } from './comfyService';

const LOCAL_STORAGE_KEY = 'roleplay_studio_db_v1';

function isDicebearSvg(url?: string): boolean {
  return Boolean(url && url.includes('api.dicebear.com'));
}

function mergeStarterWorkflows(loaded: AppDatabase): AppDatabase {
  const existingIds = new Set((loaded.workflows || []).map((w) => w.id));
  const dismissedIds = new Set(loaded.dismissedStarterWorkflowIds || []);
  const missingStarters = STARTER_WORKFLOW_TEMPLATES.filter(
    (tpl) => !existingIds.has(tpl.id) && !dismissedIds.has(tpl.id)
  );
  const workflows = [...missingStarters, ...(loaded.workflows || [])].map(
    (wf) => {
      if (
        wf.id === 'wf-sdxl-standard' &&
        wf.rawApiJson?.['4']?.inputs?.ckpt_name === 'sd_xl_base_1.0.safetensors'
      ) {
        wf.rawApiJson['4'].inputs.ckpt_name =
          'ILSDXL\\waiIllustriousSDXL_v170.safetensors';
      }
      // Auto-repair any Qwen-Edit / Moss workflow where positive_prompt was bound to a System Prompt node
      const posBinding = (wf.bindings || []).find(
        (b) => b.role === 'positive_prompt'
      );
      if (
        posBinding &&
        (/system\s*prompt/i.test(posBinding.nodeTitle || '') ||
          posBinding.inputKey === 'system_prompt' ||
          String(posBinding.currentValue || '').startsWith(
            '# Edit Prompt Enhancer'
          )) &&
        wf.rawApiJson
      ) {
        return {
          ...wf,
          bindings: heuristicMapWorkflow(wf.rawApiJson),
        };
      }
      return wf;
    }
  );
  const characters = (loaded.characters || []).map((c) => ({
    ...c,
    tags: Array.isArray(c.tags)
      ? c.tags.map((t) => cleanCharacterTag(t)).filter(Boolean)
      : [],
    gender:
      c.gender ||
      inferCharacterGender(
        `${(c.tags || []).join(' ')} ${c.visualPrompt || ''} ${c.description || ''}`
      ),
    avatarUrl: isDicebearSvg(c.avatarUrl) ? '' : c.avatarUrl || '',
    referenceImageUrl: isDicebearSvg(c.referenceImageUrl)
      ? undefined
      : c.referenceImageUrl,
    preferredWorkflowId:
      c.preferredWorkflowId === 'wf-sdxl-standard'
        ? undefined
        : c.preferredWorkflowId,
  }));
  const personas = (loaded.personas || []).map((p) => ({
    ...p,
    gender: p.gender || 'male',
    avatarUrl: isDicebearSvg(p.avatarUrl) ? '' : p.avatarUrl || '',
  }));
  const chats = (loaded.chats || []).map((chat) => {
    const cleanedMessages = (chat.messages || []).map((m) => ({
      ...m,
      speakerAvatar: isDicebearSvg(m.speakerAvatar)
        ? ''
        : m.speakerAvatar || '',
    }));
    // Migrate any attached starter lorebook entries into the story's own self-contained storyLore
    if (
      !chat.storyLore &&
      Array.isArray(chat.lorebookIds) &&
      chat.lorebookIds.length > 0
    ) {
      const migratedEntries = (loaded.lorebooks || [])
        .filter((lb) => chat.lorebookIds.includes(lb.id))
        .flatMap((lb) => lb.entries);
      return {
        ...chat,
        messages: cleanedMessages,
        storyLore: migratedEntries,
        lorebookIds: [],
      };
    }
    return {
      ...chat,
      messages: cleanedMessages,
    };
  });
  return {
    ...DEFAULT_DATABASE,
    ...loaded,
    ttsService: (() => {
      const savedRefPath =
        loaded.ttsService?.gptSovitsRefAudioPath ||
        DEFAULT_TTS_SERVICE.gptSovitsRefAudioPath ||
        'I:\\GPT-SoVITS\\voices\\default_ref_zh.wav';
      const isDefaultZhRef = savedRefPath
        .replace(/\//g, '\\')
        .toLowerCase()
        .endsWith('default_ref_zh.wav');
      return {
        ...DEFAULT_TTS_SERVICE,
        ...(loaded.ttsService || {}),
        gptSovitsRefAudioPath: savedRefPath,
        gptSovitsPromptText: isDefaultZhRef
          ? loaded.ttsService?.gptSovitsPromptText ||
            DEFAULT_TTS_SERVICE.gptSovitsPromptText
          : loaded.ttsService?.gptSovitsPromptText ===
            DEFAULT_TTS_SERVICE.gptSovitsPromptText
          ? ''
          : loaded.ttsService?.gptSovitsPromptText ?? '',
      };
    })(),
    workflows,
    characters,
    personas,
    chats,
  };
}

export async function loadDatabase(): Promise<AppDatabase> {
  try {
    const res = await fetch('/api/db');
    if (res.ok) {
      const data = await res.json();
      if (data && !data.empty && Array.isArray(data.characters)) {
        return mergeStarterWorkflows(data);
      }
    }
  } catch {
    // Fallback to localStorage
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return mergeStarterWorkflows(parsed);
    }
  } catch {
    // Ignore parse errors
  }

  return DEFAULT_DATABASE;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDbToSave: AppDatabase | null = null;

const MAX_LOCAL_STORAGE_CHARS = 4_000_000;

async function flushDatabaseSave(db: AppDatabase): Promise<void> {
  const serialized = JSON.stringify(db);
  if (serialized.length < MAX_LOCAL_STORAGE_CHARS) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
    } catch {
      // Ignore quota issues if base64 images are large
    }
  }

  try {
    await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
    });
  } catch {
    // Non-fatal in pure static preview
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (pendingDbToSave) {
      const db = pendingDbToSave;
      pendingDbToSave = null;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const serialized = JSON.stringify(db);
      if (serialized.length < MAX_LOCAL_STORAGE_CHARS) {
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
        } catch {
          // Ignore quota errors
        }
      }
      if (navigator.sendBeacon) {
        const blob = new Blob([serialized], { type: 'application/json' });
        navigator.sendBeacon('/api/db', blob);
      }
    }
  });
}

export async function saveDatabase(db: AppDatabase): Promise<void> {
  pendingDbToSave = db;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const toWrite = pendingDbToSave;
    pendingDbToSave = null;
    if (toWrite) {
      void flushDatabaseSave(toWrite);
    }
  }, 450);
}
