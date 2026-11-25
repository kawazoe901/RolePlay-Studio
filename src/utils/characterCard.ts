import {
  CharacterCardV2,
  CharacterGender,
  CharacterVoiceConfig,
  ConversationLanguage,
  StatusTrackerMode,
} from '../types';

export function inferCharacterGender(
  rawText: string,
  explicitGender?: string
): CharacterGender {
  const g = (explicitGender || '').toLowerCase().trim();
  if (g === 'female' || g === 'f' || g === 'woman' || g === 'girl')
    return 'female';
  if (g === 'male' || g === 'm' || g === 'man' || g === 'boy') return 'male';
  if (g === 'non-binary' || g === 'nonbinary' || g === 'nb')
    return 'non-binary';

  const lower = rawText.toLowerCase();
  if (/\b(1boy|male|he\/him|\bhis\b|\bhim\b|man\b)\b/.test(lower)) {
    if (!/\b(1girl|female|she\/her|\bher\b|\bshe\b)\b/.test(lower)) {
      return 'male';
    }
  }
  if (/\b(1girl|female|she\/her|\bshe\b|\bher\b|woman\b)\b/.test(lower)) {
    return 'female';
  }
  if (/\b(non-binary|nonbinary|they\/them)\b/.test(lower)) {
    return 'non-binary';
  }
  return 'female';
}

/**
 * Parses a TavernAI / SillyTavern Character Card V2 from either:
 * - A `.json` file (V1 or V2 spec)
 * - A `.png` file containing a `tEXt` chunk with keyword `chara` (base64-encoded JSON)
 */
export async function importCharacterCardFile(file: File): Promise<CharacterCardV2> {
  if (file.name.toLowerCase().endsWith('.json')) {
    const text = await file.text();
    const raw = JSON.parse(text);
    return normalizeCharacterJson(raw, '');
  }

  // Read PNG binary chunks for `tEXt` -> `chara`
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const avatarDataUrl = await fileToDataUrl(file);

  // Verify PNG signature
  const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== pngSig[i]) {
      throw new Error('Not a valid PNG file.');
    }
  }

  let offset = 8;
  const decoder = new TextDecoder('latin1');

  while (offset + 8 <= bytes.length) {
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === 'tEXt' && dataEnd <= bytes.length) {
      const chunkBytes = bytes.subarray(dataStart, dataEnd);
      const nullIndex = chunkBytes.indexOf(0);
      if (nullIndex !== -1) {
        const keyword = decoder.decode(chunkBytes.subarray(0, nullIndex));
        if (keyword === 'chara' || keyword === 'ccv3') {
          const base64Text = decoder.decode(chunkBytes.subarray(nullIndex + 1));
          const binaryString = atob(base64Text.trim());
          const utf8Bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
          const jsonString = new TextDecoder('utf-8').decode(utf8Bytes);
          const parsed = JSON.parse(jsonString);
          return normalizeCharacterJson(parsed, avatarDataUrl);
        }
      }
    }

    offset = dataEnd + 4; // skip 4-byte CRC
  }

  throw new Error('No Character Card V2 metadata ("chara" tEXt chunk) found in this PNG.');
}

function normalizeCharacterJson(raw: any, fallbackAvatar: string): CharacterCardV2 {
  const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  const name = data.name || raw.name || 'Unnamed Character';
  const tags: string[] = Array.isArray(data.tags)
    ? data.tags
        .map((t: any) =>
          String(t || '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(Boolean)
    : [];
  const gender = inferCharacterGender(
    `${tags.join(' ')} ${data.extensions?.visual_prompt || ''} ${data.description || ''}`,
    data.gender || data.extensions?.gender
  );

  const validHudModes: StatusTrackerMode[] = [
    'auto',
    'off',
    'rpg_traveler',
    'romance_affection',
    'intimate_detailed',
    'custom',
  ];
  const rawHudMode = data.extensions?.status_tracker_mode;
  const defaultStatusTrackerMode: StatusTrackerMode | undefined =
    validHudModes.includes(rawHudMode) ? rawHudMode : undefined;
  const defaultCustomStatusTemplate =
    typeof data.extensions?.status_template === 'string'
      ? data.extensions.status_template
      : undefined;

  const validLanguages: ConversationLanguage[] = [
    'auto',
    'zh-CN',
    'zh-TW',
    'en',
    'ja',
    'ko',
  ];
  const rawLang = data.extensions?.language;
  const defaultLanguage: ConversationLanguage | undefined =
    validLanguages.includes(rawLang) ? rawLang : undefined;

  const rawVoice = data.extensions?.tts_voice;
  const voiceConfig: CharacterVoiceConfig | undefined =
    rawVoice && typeof rawVoice === 'object'
      ? {
          ...(rawVoice.provider ? { provider: rawVoice.provider } : {}),
          ...(rawVoice.voiceId ? { voiceId: String(rawVoice.voiceId) } : {}),
          ...(typeof rawVoice.speed === 'number' ? { speed: rawVoice.speed } : {}),
          ...(typeof rawVoice.pitch === 'number' ? { pitch: rawVoice.pitch } : {}),
          ...(rawVoice.refAudioPath
            ? { refAudioPath: String(rawVoice.refAudioPath) }
            : {}),
          ...(rawVoice.refPromptText
            ? { refPromptText: String(rawVoice.refPromptText) }
            : {}),
          ...(rawVoice.refPromptLang
            ? { refPromptLang: String(rawVoice.refPromptLang) }
            : {}),
        }
      : undefined;

  return {
    id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    gender,
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    first_mes: data.first_mes || `Hello! I am ${name}.`,
    mes_example: data.mes_example || '',
    creator_notes: data.creator_notes || '',
    system_prompt: data.system_prompt || '',
    post_history_instructions: data.post_history_instructions || '',
    alternate_greetings: Array.isArray(data.alternate_greetings)
      ? data.alternate_greetings
      : [],
    tags,
    avatarUrl: fallbackAvatar || data.avatar || '',
    visualPrompt:
      data.extensions?.visual_prompt ||
      tags.slice(0, 8).join(', ') ||
      `1girl, ${name}, detailed anime portrait, expressive eyes, cinematic lighting`,
    ...(defaultStatusTrackerMode ? { defaultStatusTrackerMode } : {}),
    ...(defaultCustomStatusTemplate ? { defaultCustomStatusTemplate } : {}),
    ...(defaultLanguage ? { defaultLanguage } : {}),
    ...(voiceConfig && Object.keys(voiceConfig).length > 0
      ? { voiceConfig }
      : {}),
  };
}

export function exportCharacterCardV2Json(char: CharacterCardV2): void {
  const payload = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: char.name,
      description: char.description,
      personality: char.personality,
      scenario: char.scenario,
      first_mes: char.first_mes,
      mes_example: char.mes_example,
      creator_notes: char.creator_notes,
      system_prompt: char.system_prompt,
      post_history_instructions: char.post_history_instructions,
      alternate_greetings: char.alternate_greetings,
      tags: char.tags,
      extensions: {
        gender: char.gender || 'female',
        visual_prompt: char.visualPrompt,
        ...(char.defaultStatusTrackerMode
          ? { status_tracker_mode: char.defaultStatusTrackerMode }
          : {}),
        ...(char.defaultCustomStatusTemplate
          ? { status_template: char.defaultCustomStatusTemplate }
          : {}),
        ...(char.defaultLanguage ? { language: char.defaultLanguage } : {}),
        ...(char.voiceConfig && Object.keys(char.voiceConfig).length > 0
          ? { tts_voice: char.voiceConfig }
          : {}),
      },
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${char.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_v2.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
