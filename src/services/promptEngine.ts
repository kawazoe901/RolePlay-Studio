import {
  CharacterCardV2,
  CharacterGender,
  ChatMessage,
  ChatSession,
  ConversationLanguage,
  ImageStylePreset,
  LLMServiceConfig,
  Lorebook,
  LorebookEntry,
  StatusTrackerMode,
  StoryMemoryChapter,
  UserPersona,
  WorkflowPromptLengthPreset,
  WorkflowPromptStyle,
} from '../types';
import { ChatTurnMessage, generateChatCompletion } from './llmService';
import {
  buildCompactStatusRecencyAnchor,
  buildStatusTrackerSystemInstruction,
  extractLatestRawStatusBlock,
  getDefaultStatusTemplateForMode,
  parseMessageStatusBlocks,
  serializeStatusTemplateRows,
} from '../utils/statusTracker';

export const CONVERSATION_LANGUAGES: Array<{
  id: ConversationLanguage;
  label: string;
  shortLabel: string;
  instruction: string;
}> = [
  {
    id: 'auto',
    label: 'Auto (Match Character / Input)',
    shortLabel: 'Auto',
    instruction: '',
  },
  {
    id: 'zh-CN',
    label: '中文 (Simplified Chinese)',
    shortLabel: '中文 (简)',
    instruction:
      'MANDATORY LANGUAGE RULE: Write ALL narration (*actions*) and spoken dialogue ("quotes") strictly in natural Simplified Chinese (简体中文), even if the character profile or previous messages contain another language.',
  },
  {
    id: 'zh-TW',
    label: '繁體中文 (Traditional Chinese)',
    shortLabel: '繁體中文',
    instruction:
      'MANDATORY LANGUAGE RULE: Write ALL narration (*actions*) and spoken dialogue ("quotes") strictly in natural Traditional Chinese (繁體中文), even if the character profile or previous messages contain another language.',
  },
  {
    id: 'en',
    label: 'English',
    shortLabel: 'English',
    instruction:
      'MANDATORY LANGUAGE RULE: Write ALL narration (*actions*) and spoken dialogue ("quotes") strictly in natural English, even if the character profile or previous messages contain another language.',
  },
  {
    id: 'ja',
    label: '日本語 (Japanese)',
    shortLabel: '日本語',
    instruction:
      'MANDATORY LANGUAGE RULE: Write ALL narration (*actions*) and spoken dialogue ("quotes") strictly in natural Japanese (日本語), even if the character profile or previous messages contain another language.',
  },
  {
    id: 'ko',
    label: '한국어 (Korean)',
    shortLabel: '한국어',
    instruction:
      'MANDATORY LANGUAGE RULE: Write ALL narration (*actions*) and spoken dialogue ("quotes") strictly in natural Korean (한국어), even if the character profile or previous messages contain another language.',
  },
];

export function getLanguageInstruction(lang?: ConversationLanguage): string {
  if (!lang || lang === 'auto') return '';
  return (
    CONVERSATION_LANGUAGES.find((item) => item.id === lang)?.instruction || ''
  );
}

export function formatGenderProfile(gender?: CharacterGender): string {
  switch (gender) {
    case 'female':
      return 'Female (she/her)';
    case 'male':
      return 'Male (he/him)';
    case 'non-binary':
      return 'Non-Binary (they/them)';
    case 'other':
      return 'Other / Custom';
    default:
      return 'Unspecified';
  }
}

export function formatGenderBadge(gender?: CharacterGender): {
  symbol: string;
  label: string;
  colorClass: string;
} {
  switch (gender) {
    case 'female':
      return {
        symbol: '♀',
        label: 'Female',
        colorClass:
          'bg-pink-500/15 text-pink-300 border-pink-500/30',
      };
    case 'male':
      return {
        symbol: '♂',
        label: 'Male',
        colorClass:
          'bg-sky-500/15 text-sky-300 border-sky-500/30',
      };
    case 'non-binary':
      return {
        symbol: '⚧',
        label: 'Non-Binary',
        colorClass:
          'bg-violet-500/15 text-violet-300 border-violet-500/30',
      };
    default:
      return {
        symbol: '•',
        label: 'Other',
        colorClass:
          'bg-slate-800 text-slate-300 border-slate-700',
      };
  }
}

export function replaceMacros(
  text: string,
  charName: string,
  userName: string
): string {
  if (!text) return '';
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName);
}

/**
 * Scans recent messages against enabled Lorebooks and returns triggered entries.
 */
export function matchLorebookEntries(
  messages: ChatMessage[],
  lorebooks: Lorebook[],
  charName: string,
  userName: string
): { title: string; content: string }[] {
  const recentWindow = messages
    .slice(-6)
    .map((m) => m.swipes[m.activeSwipeIndex] || '')
    .join('\n')
    .toLowerCase();

  const matched: { title: string; content: string; priority: number }[] = [];

  for (const lb of lorebooks) {
    for (const entry of lb.entries) {
      if (!entry.enabled) continue;
      const isTriggered =
        entry.constant ||
        entry.keys.some(
          (k) => k.trim() && recentWindow.includes(k.trim().toLowerCase())
        );
      if (isTriggered) {
        matched.push({
          title: entry.name,
          content: replaceMacros(entry.content, charName, userName),
          priority: entry.priority,
        });
      }
    }
  }

  return matched
    .sort((a, b) => b.priority - a.priority)
    .map(({ title, content }) => ({ title, content }));
}

/**
 * Scans recent messages against archived Episodic Story Chapters (`session.memoryChapters`).
 * Always includes pinned chapters + up to 3 keyword-matched past chapters (plus the most recent chapter if none matched),
 * allowing 100+ turn stories to recall exact events, promises, and NPCs from early chapters without overflowing VRAM.
 */
export function matchEpisodicMemoryChapters(
  messages: ChatMessage[],
  chapters: StoryMemoryChapter[] = [],
  charName: string,
  userName: string
): StoryMemoryChapter[] {
  if (!chapters || chapters.length === 0) return [];

  const recentWindow = messages
    .slice(-6)
    .map((m) => m.swipes[m.activeSwipeIndex] || '')
    .join('\n')
    .toLowerCase();

  const pinned: StoryMemoryChapter[] = [];
  const scored: { chapter: StoryMemoryChapter; score: number }[] = [];

  for (const ch of chapters) {
    if (ch.pinned) {
      pinned.push({
        ...ch,
        summary: replaceMacros(ch.summary, charName, userName),
      });
      continue;
    }
    let score = 0;
    for (const kw of ch.keywords || []) {
      const cleanKw = kw.trim().toLowerCase();
      if (cleanKw.length >= 2 && recentWindow.includes(cleanKw)) {
        score += 2;
      }
    }
    if (score > 0) {
      scored.push({
        chapter: {
          ...ch,
          summary: replaceMacros(ch.summary, charName, userName),
        },
        score,
      });
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || b.chapter.turnRange[1] - a.chapter.turnRange[1]
  );

  const selected = [...pinned, ...scored.slice(0, 3).map((s) => s.chapter)];

  // Ensure the most recently archived chapter is always available for smooth chapter-to-chapter transition
  const latestChapter = chapters[chapters.length - 1];
  if (
    latestChapter &&
    !selected.some((c) => c.id === latestChapter.id) &&
    selected.length < 4
  ) {
    selected.push({
      ...latestChapter,
      summary: replaceMacros(latestChapter.summary, charName, userName),
    });
  }

  return selected.sort((a, b) => a.turnRange[0] - b.turnRange[0]);
}

/**
 * CJK-aware token estimator.
 * Chinese/Japanese/Korean characters average ~0.85-1.0 tokens per character in Qwen/Gemma/Llama tokenizers,
 * whereas ASCII/Latin characters average ~0.28 tokens per character.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(/[\u3000-\u9fff\uff00-\uffef\uac00-\ud7af]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const otherCount = Math.max(0, text.length - cjkCount);
  return Math.ceil(cjkCount * 0.92 + otherCount * 0.3) + 6;
}

/**
 * Strips `<status_bar>...</status_bar>` and `<UpdateVariable>...</UpdateVariable>` blocks
 * from older historical turns so they don't bloat the context window (the latest status state
 * is already injected in the system prompt and kept on the most recent assistant message).
 */
function stripHistoricalStatusBlocks(text: string): string {
  return text
    .replace(/<status_bar>[\s\S]*?<\/status_bar>/gi, '')
    .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, '')
    .trim();
}

/**
 * Builds the full prompt message array for single or multi-character group role-play,
 * plus anti-identity-bleed stop sequences and a CJK-aware sliding context window so long
 * chats (40+ turns) never overflow `num_ctx` and cut off mid-sentence.
 */
export function buildRolePlayMessages(params: {
  session: ChatSession;
  activeCharacter: CharacterCardV2;
  allSessionCharacters: CharacterCardV2[];
  persona: UserPersona;
  lorebooks: Lorebook[];
  maxContextTokens: number;
  isContinue?: boolean;
  characterGuidance?: string;
}): {
  messages: ChatTurnMessage[];
  stopSequences: string[];
  injectedLoreNames: string[];
  injectedChapterTitles: string[];
  estimatedTokens: number;
} {
  const {
    session,
    activeCharacter,
    allSessionCharacters,
    persona,
    lorebooks,
    maxContextTokens,
    isContinue,
    characterGuidance,
  } = params;
  const charName = activeCharacter.name;
  const userName = persona.name || 'User';

  // Combine self-contained storyLore on the session with any explicitly attached lorebooks
  const sessionLorebook: Lorebook[] = [
    ...(session.storyLore && session.storyLore.length > 0
      ? [
          {
            id: `story-lore-${session.id}`,
            name: `${session.title} Lore`,
            description: 'Self-contained story lore',
            entries: session.storyLore,
          },
        ]
      : []),
    ...lorebooks.filter((lb) => (session.lorebookIds || []).includes(lb.id)),
  ];

  const triggeredLore = matchLorebookEntries(
    session.messages,
    sessionLorebook,
    charName,
    userName
  );

  const recalledChapters = matchEpisodicMemoryChapters(
    session.messages,
    session.memoryChapters || [],
    charName,
    userName
  );

  const systemParts: string[] = [];

  if (activeCharacter.system_prompt) {
    systemParts.push(
      replaceMacros(activeCharacter.system_prompt, charName, userName)
    );
  } else {
    systemParts.push(
      `You are role-playing as ${charName}. Stay strictly in character. Write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks ("...") strictly for words actually spoken out loud—never put unspoken thoughts inside double quotes. Never write dialogue or actions for ${userName}.`
    );
  }

  // Self-contained Story World Setting overrides or complements the character's default scenario
  const activeScenario =
    session.worldSetting && session.worldSetting.trim()
      ? session.worldSetting
      : activeCharacter.scenario;

  const charGenderStr = formatGenderProfile(activeCharacter.gender);
  const userGenderStr = formatGenderProfile(persona.gender);
  const hasStoryProgressed =
    session.messages.length > 2 || Boolean(session.characterEvolution?.trim());

  systemParts.push(
    `### ${
      hasStoryProgressed
        ? `Starting Character Baseline: ${charName} (Initial Profile Only — Evolved State Below Takes Priority)`
        : `Story World & Character Profile: ${charName}`
    }\n` +
      (hasStoryProgressed
        ? `Continuity Override Note: Description, Personality, and Scenario below describe ${charName}'s starting point at Turn 1. Whenever Current Evolved Character State, Rolling Memory, or Live Status HUD shows personal growth, confidence, or relationship changes, ALWAYS act according to ${charName}'s EVOLVED state instead of snapping back to old Day-1 habits.\n`
        : '') +
      `Gender & Pronouns: ${charGenderStr}\n` +
      `Description: ${replaceMacros(
        activeCharacter.description,
        charName,
        userName
      )}\n` +
      (activeCharacter.personality
        ? `Personality: ${replaceMacros(
            activeCharacter.personality,
            charName,
            userName
          )}\n`
        : '') +
      (activeScenario
        ? `${
            hasStoryProgressed
              ? 'Initial Story Premise & Opening Setup (Note: This describes the starting scene only — always follow recent chat turns and the Live Status HUD for the current Location, Time, and Outfit!)'
              : 'Current Story World & Scenario'
          }: ${replaceMacros(activeScenario, charName, userName)}`
        : '')
  );

  if (session.isGroup && allSessionCharacters.length > 1) {
    const others = allSessionCharacters
      .filter((c) => c.id !== activeCharacter.id)
      .map(
        (c) =>
          `- ${c.name} [${formatGenderProfile(c.gender)}]: ${replaceMacros(
            c.personality || c.description,
            c.name,
            userName
          )}`
      )
      .join('\n');
    systemParts.push(
      `### Group Scene Participants\nOther characters present in this scene:\n${others}\nRespond ONLY as ${charName} (${charGenderStr}). Do not write lines for other characters or ${userName}.`
    );
  }

  systemParts.push(
    `### User Persona (${userName})\n` +
      `Gender & Pronouns: ${userGenderStr}\n` +
      (persona.description
        ? `Bio: ${replaceMacros(persona.description, charName, userName)}\n`
        : '') +
      `Gender & Interaction Note: ${charName} is ${charGenderStr} and ${userName} is ${userGenderStr}. Always use the correct pronouns, forms of address, body language, and interpersonal/romantic reactions appropriate for ${charName}'s gender and ${userName}'s gender.`
  );

  if (triggeredLore.length > 0) {
    systemParts.push(
      `### World Info & Lorebook\n` +
        triggeredLore.map((l) => `[${l.title}]: ${l.content}`).join('\n')
    );
  }

  if (session.memorySummary.trim()) {
    systemParts.push(
      `### Rolling Story Memory Synopsis\n${replaceMacros(
        session.memorySummary,
        charName,
        userName
      )}`
    );
  }

  if (recalledChapters.length > 0) {
    systemParts.push(
      `### Recalled Long-Term Story Chapters (Episodic Memory Archive)\n` +
        recalledChapters
          .map(
            (ch) =>
              `[${ch.title} (Turns ${ch.turnRange[0]}–${ch.turnRange[1]})]:\n${ch.summary}`
          )
          .join('\n\n')
    );
  }

  if (activeCharacter.mes_example.trim()) {
    systemParts.push(
      `### Example Dialogue\n${replaceMacros(
        activeCharacter.mes_example,
        charName,
        userName
      )}`
    );
  }

  if (activeCharacter.post_history_instructions?.trim()) {
    systemParts.push(
      `### Author's Note / Post-History Instructions\n${replaceMacros(
        activeCharacter.post_history_instructions,
        charName,
        userName
      )}`
    );
  }

  if (session.characterEvolution?.trim()) {
    systemParts.push(
      `### Current Evolved Character State (STRICTLY OVERRIDES STARTING BASELINE)\n` +
        `${replaceMacros(
          session.characterEvolution.trim(),
          charName,
          userName
        )}\n` +
        `Priority Rule: Embody ${charName}'s evolved demeanor, poise, habits, and relationship stance above—never reset back to Day-1 shyness or old habits unless the current scene specifically calls for a brief moment of vulnerability.`
    );
  }

  systemParts.push(
    `### Topic Continuity & Anti-Divergence Rule\n` +
      `1. Stay strictly anchored on what was just said and done in the immediate conversation.\n` +
      `2. Respond directly to ${userName}'s latest words, gestures, and presence. Do NOT abruptly change subjects, divert to unrelated background trivia, or invent unrequested plot twists.\n` +
      `3. AUTHORIZED SECONDARY NPCS & LIVE DIALOGUE: Whenever Director's Scene Guidance or ${userName}'s message introduces a secondary character (NPC, e.g. a friend, rival, waiter, caller, bystander, stranger) or incoming phone call/knock/text: you ARE explicitly authorized and expected to enact that NPC's speech LIVE in the scene (quote the NPC's actual spoken dialogue in quotes: e.g. *电话那头传来赵杰的声音：“喂，你们在哪？”* / *侍应生微笑着上前：“打扰一下，请问两位需要加水吗？”*). NEVER fast-forward to the aftermath or only show the result after the NPC spoke!\n` +
      `4. Keep ${charName}'s reaction focused on their immediate emotions, physical sensations, and natural relationship dynamics.`
  );

  const isChineseSession =
    session.language === 'zh-CN' ||
    session.language === 'zh-TW' ||
    /[\u4e00-\u9fa5]/.test(charName);

  const formattingRule = isChineseSession
    ? `### 角色扮演输出排版格式规范（严格执行）：\n` +
      `1. 说话台词：必须且只能使用双引号包裹实际说出口的话，例如：“这里是台词。” 或 "这里是台词。" 严禁将台词说话写在星号*中，也严禁将未说出口的心声或心理活动放进双引号中！\n` +
      `2. 动作神态、旁白描写与无声心理活动：必须使用单星号包裹，例如：*她微微侧头，发丝间露出修长的脖颈线条，心里暗自思忖着*（简短心声可用星号内的单引号区分）。严禁将动作或心理活动写在双引号中。\n` +
      `3. 严禁反转颠倒！绝不可将台词套在星号里、把动作写在星号外（如错误范例：*走吧？*她笑了笑*别客气* 是严重格式错误，正确必须为：“走吧？”*她笑了笑*“别客气”）。\n` +
      `4. 每段内的星号和引号必须严格成对闭合，不得遗漏或留下未闭合的单边符号。`
    : `### Role-Play Syntax & Formatting Rules (Strictly Enforced):\n` +
      `1. Spoken Dialogue: ALWAYS wrap words actually spoken out loud in double quotes ("..." or “...”). Spoken words MUST NEVER be wrapped in asterisks (*), and silent internal thoughts MUST NEVER be wrapped in double quotes.\n` +
      `2. Actions, Sensory Descriptions & Silent Thoughts: ALWAYS wrap physical actions, narration, and unspoken internal thoughts in single asterisks (*...*)—brief inner thoughts may use *single quotes* inside asterisks. Actions and unspoken thoughts MUST NEVER be placed in double quotation marks.\n` +
      `3. NEVER invert asterisks and quotes (NEVER write *spoken words* she glanced over *more words*).\n` +
      `4. Always properly pair and close every quotation mark and asterisk within the same paragraph.`;

  systemParts.push(formattingRule);

  const langRule = getLanguageInstruction(session.language);
  if (langRule) {
    systemParts.push(`### Conversation Language\n${langRule}`);
  }

  const prevStatusBlock = extractLatestRawStatusBlock(session.messages);
  const statusRule = buildStatusTrackerSystemInstruction({
    mode: session.statusTrackerMode || 'auto',
    customTemplate: session.customStatusTemplate,
    charName,
    userName,
    language: session.language,
    previousStatusBlock: prevStatusBlock,
  });
  if (statusRule) {
    systemParts.push(statusRule);
  }

  // Find the index of the latest assistant message that carries a status block so we only keep
  // the raw <status_bar> on the most recent assistant message in history (saving ~150 tokens per older turn).
  let lastAssistantIdx = -1;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  const candidateTurns: Array<{
    role: 'user' | 'assistant';
    content: string;
    tokens: number;
    msgIndex: number;
  }> = [];

  for (let idx = 0; idx < session.messages.length; idx++) {
    const msg = session.messages[idx];
    const rawText = msg.swipes[msg.activeSwipeIndex] || '';
    let cleanText = replaceMacros(
      rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
      charName,
      userName
    );
    if (!cleanText) continue;

    // Strip redundant <status_bar> / <UpdateVariable> blocks from older assistant turns
    if (msg.role === 'assistant' && idx !== lastAssistantIdx) {
      cleanText = stripHistoricalStatusBlocks(cleanText);
    }

    // Skip broken/truncated 1-phrase assistant stubs from earlier context-overflowed turns
    // unless it is the very last message being continued.
    if (
      msg.role === 'assistant' &&
      idx < session.messages.length - 1 &&
      cleanText.length <= 15 &&
      !cleanText.endsWith('。') &&
      !cleanText.endsWith('”') &&
      !cleanText.endsWith('"') &&
      !cleanText.endsWith('*') &&
      !cleanText.endsWith('!') &&
      !cleanText.endsWith('！')
    ) {
      continue;
    }

    if (!cleanText) continue;

    if (msg.role === 'user') {
      const content = session.isGroup ? `${userName}: ${cleanText}` : cleanText;
      candidateTurns.push({
        role: 'user',
        content,
        tokens: estimateTokenCount(content),
        msgIndex: idx,
      });
    } else if (msg.role === 'assistant') {
      const isSameSpeaker = msg.speakerId === activeCharacter.id;
      const content = session.isGroup
        ? `${msg.speakerName}: ${cleanText}`
        : cleanText;
      candidateTurns.push({
        role: isSameSpeaker ? 'assistant' : 'user',
        content,
        tokens: estimateTokenCount(content),
        msgIndex: idx,
      });
    }
  }

  // Sliding Context Window budget calculation:
  // Always reserve at least 2048 tokens (or 32% of context window) for the model's reply + <status_bar>
  const effectiveMaxContext = Math.max(4096, maxContextTokens || 8192);
  const reservedOutputTokens = Math.min(
    2400,
    Math.max(1600, Math.floor(effectiveMaxContext * 0.3))
  );
  const baseSystemText = systemParts.join('\n\n');
  const systemTokens = estimateTokenCount(baseSystemText) + 180; // +180 for trailing reinforcement notes
  const availableHistoryTokens = Math.max(
    1200,
    effectiveMaxContext - systemTokens - reservedOutputTokens
  );

  // Select the most recent turns that fit within availableHistoryTokens AND session.maxRecentMessages
  // Default maxRecentMessages is 16 (8 back-and-forth exchanges) for optimal VRAM & focus; 0 = unlimited up to token budget
  const configuredMaxRecent =
    session.maxRecentMessages === undefined ? 16 : session.maxRecentMessages;
  const maxTurnCap =
    configuredMaxRecent > 0 ? configuredMaxRecent : candidateTurns.length;

  const selectedTurns: typeof candidateTurns = [];
  let usedHistoryTokens = 0;
  for (let i = candidateTurns.length - 1; i >= 0; i--) {
    if (selectedTurns.length >= maxTurnCap) {
      break;
    }
    const turn = candidateTurns[i];
    const isMandatoryRecent = candidateTurns.length - 1 - i < 4;
    if (
      usedHistoryTokens + turn.tokens <= availableHistoryTokens ||
      isMandatoryRecent
    ) {
      selectedTurns.unshift(turn);
      usedHistoryTokens += turn.tokens;
    } else {
      break;
    }
  }

  // If earlier turns were trimmed off and have not yet been folded into session.memorySummary,
  // build a compact automatic recap of those unsummarized turns so no plot beat is ever lost!
  const trimmedCount = candidateTurns.length - selectedTurns.length;
  const firstSelectedMsgIdx =
    selectedTurns.length > 0
      ? selectedTurns[0].msgIndex
      : session.messages.length;
  const summarizedUpTo = session.summarizedUpToIndex || 0;
  const unsummarizedTrimmedTurns = candidateTurns
    .slice(0, trimmedCount)
    .filter(
      (t) => !session.memorySummary.trim() || t.msgIndex >= summarizedUpTo
    );

  if (unsummarizedTrimmedTurns.length > 0) {
    const sampledRecapLines: string[] = [];
    const sampleStep = Math.max(
      1,
      Math.floor(unsummarizedTrimmedTurns.length / 6)
    );
    for (
      let i = 0;
      i < unsummarizedTrimmedTurns.length;
      i += sampleStep
    ) {
      if (sampledRecapLines.length >= 7) break;
      const t = unsummarizedTrimmedTurns[i];
      const snippet = stripHistoricalStatusBlocks(t.content)
        .replace(/\s+/g, ' ')
        .slice(0, 110);
      sampledRecapLines.push(
        `- [Turn ${t.msgIndex + 1} ${t.role === 'user' ? userName : charName}]: ${snippet}${
          t.content.length > 110 ? '...' : ''
        }`
      );
    }
    if (sampledRecapLines.length > 0 && firstSelectedMsgIdx > 0) {
      systemParts.push(
        `### Earlier Conversation Recap (${unsummarizedTrimmedTurns.length} earlier turns condensed to save VRAM)\n` +
          sampledRecapLines.join('\n')
      );
    }
  }

  const systemContent = systemParts.join('\n\n');
  const turnMessages: ChatTurnMessage[] = [
    { role: 'system', content: systemContent },
  ];

  for (const turn of selectedTurns) {
    turnMessages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  const recencyStatusAnchor = statusRule
    ? buildCompactStatusRecencyAnchor(prevStatusBlock, charName, userName)
    : '';

  const cleanGuidance = characterGuidance
    ? replaceMacros(characterGuidance.trim(), charName, userName)
    : '';

  const formatRecencyNote = isChineseSession
    ? '输出排版格式注意：台词说话必须在引号中，动作神态描写必须在星号*中，绝对不可颠倒！'
    : 'Format strictly: "Spoken dialogue in quotes", *actions/narration in asterisks*, never inverted!';

  if (isContinue) {
    turnMessages.push({
      role: 'user',
      content: `[System Note: Continue and advance the story naturally as ${charName} from the previous moment. Introduce a new action, observation, or line of dialogue to move the scene forward without speaking for ${userName}.${
        cleanGuidance
          ? ` Mandatory Director's Scene Direction for ${charName}: "${cleanGuidance}". You MUST follow this direction in ${charName}'s immediate actions and words! (If this direction introduces an NPC, phone call, or interruption, enact the NPC's actual spoken dialogue LIVE in the scene in quotation marks—do NOT skip to the result after the NPC spoke!)`
          : ''
      }${
        langRule ? ` ${langRule}` : ''
      } ${formatRecencyNote}${
        statusRule
          ? ` ${
              recencyStatusAnchor ||
              'Remember to append the updated <status_bar>...</status_bar> block at the very end of your reply.'
            }`
          : ''
      }]`,
    });
  } else {
    // When responding to a turn, attach Director's Scene Direction, language, formatting, and status anchor to the latest user message
    const notes: string[] = [];
    if (cleanGuidance) {
      notes.push(
        `Mandatory Director's Scene Direction for ${charName}: "${cleanGuidance}". You MUST follow this direction in ${charName}'s immediate emotional reaction, physical gestures, and dialogue—do not divert away from this direction! If this direction introduces an NPC, phone call, or interruption, enact the NPC's actual spoken dialogue LIVE in the scene in quotation marks—do NOT skip to the result after the NPC spoke!`
      );
    }
    if (langRule) notes.push(langRule);
    notes.push(formatRecencyNote);
    if (statusRule) {
      notes.push(
        recencyStatusAnchor ||
          `Append the updated <status_bar>...</status_bar> block at the very end of ${charName}'s reply.`
      );
    }

    if (notes.length > 0) {
      for (let i = turnMessages.length - 1; i >= 1; i--) {
        if (turnMessages[i].role === 'user') {
          turnMessages[i] = {
            ...turnMessages[i],
            content: `${turnMessages[i].content}\n\n[Note: ${notes.join(' ')}]`,
          };
          break;
        }
      }
    }
  }

  const stopSequences = [
    `\n${userName}:`,
    ...allSessionCharacters
      .filter((c) => c.id !== activeCharacter.id)
      .map((c) => `\n${c.name}:`),
  ];

  const estimatedTokens = turnMessages.reduce(
    (acc, m) => acc + estimateTokenCount(m.content),
    0
  );

  return {
    messages: turnMessages,
    stopSequences,
    injectedLoreNames: triggeredLore.map((l) => l.title),
    injectedChapterTitles: recalledChapters.map((ch) => ch.title),
    estimatedTokens,
  };
}

/**
 * Selects the next character to speak in a Group Chat based on the session's turn mode.
 */
export function selectNextGroupSpeaker(
  session: ChatSession,
  characters: CharacterCardV2[]
): CharacterCardV2 {
  if (characters.length === 0) {
    throw new Error('No characters in session');
  }
  if (characters.length === 1) return characters[0];

  const lastMessage = session.messages[session.messages.length - 1];
  const lastText = (
    lastMessage?.swipes[lastMessage.activeSwipeIndex] || ''
  ).toLowerCase();

  if (session.groupTurnMode === 'natural') {
    for (const c of characters) {
      const firstName = c.name.split(' ')[0].toLowerCase();
      if (lastText.includes(firstName) && lastMessage?.speakerId !== c.id) {
        return c;
      }
    }
  }

  const lastAssistantMsg = [...session.messages]
    .reverse()
    .find((m) => m.role === 'assistant');
  if (!lastAssistantMsg) return characters[0];

  const lastIdx = characters.findIndex(
    (c) => c.id === lastAssistantMsg.speakerId
  );
  const nextIdx = (lastIdx + 1) % characters.length;
  return characters[nextIdx];
}

/**
 * Uses the connected Ollama / LM Studio LLM to craft an optimized ComfyUI prompt
 * tailored to the workflow's architecture:
 * - 'edit_instruction': Character-Consistency Edit Instruction for Qwen-Image-2.1-Edit / Flux Kontext / OmniGen
 * - 'natural': Rich natural-language prose for Moss / Flux / SD3.5
 * - 'tags': Danbooru tags for SDXL / Illustrious / Pony
 */
/**
 * Extracts only the core permanent physical identity traits (hair, eyes, face,
 * body build, skin tone, permanent accessories) from a potentially long or
 * scene-polluted `visualPrompt`.
 *
 * Strips out static portrait poses ("sitting on stool"), studio/background tags
 * ("photography studio background"), quality boilerplate ("masterpiece, 8k, soft lighting"),
 * and temporary expressions so that long Character Visual Appearance Tags never
 * override the dynamic role-play chat scene's pose, outfit state, or location.
 */
export function extractCoreAppearanceTraits(
  visualPrompt: string,
  gender: CharacterGender = 'female'
): string {
  const genderTag =
    gender === 'male'
      ? '1boy, male'
      : gender === 'non-binary'
      ? '1person, androgynous'
      : '1girl, female';

  const raw = String(visualPrompt || '').trim();
  if (!raw) return genderTag;

  // Split by comma, semicolon, or sentence period
  const tokens = raw
    .split(/[,;]+|\.\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Patterns that belong to a static portrait render or quality boilerplate, NOT permanent identity
  const nonIdentityPattern =
    /\b(masterpiece|best quality|high quality|ultra[- ]?detailed|highres|absurdres|8k|4k|raw photo|photorealistic|detailed skin|skin texture|lighting|soft light|cinematic|dramatic|volumetric|ray tracing|depth of field|bokeh|sharp focus|background|studio|indoors|outdoors|bedroom|room|street|classroom|sitting|stool|chair|standing|lying|kneeling|leaning|looking at viewer|pose|portrait|upper body|full body|cowboy shot|close[- ]?up|from above|from below|expression|smiling|smile|blushing|crying|tears|solo)\b/i;

  // Priority physical identity keywords (hair, eyes, body/figure, skin, face, glasses/ears)
  const coreIdentityPattern =
    /\b(hair|bangs|braid|ponytail|twintails|bun|eyes|eyelashes|pupil|glasses|eyeglasses|freckles|mole|scar|ears|horns|tail|wings|skin|pale|tan|fair|dark skin|tall|petite|slender|slim|curvy|voluptuous|athletic|muscular|plump|bust|breasts|chest|waist|hips|thighs|physique|build|figure|body|young|mature|college|student)\b/i;

  const filtered = tokens.filter((tok) => !nonIdentityPattern.test(tok));

  // Separate into core physical traits first, then any remaining concise clothing/style descriptors
  const corePhysical: string[] = [];
  const secondaryTraits: string[] = [];

  for (const tok of filtered) {
    if (/^(1girl|1boy|1person|female|male|woman|man|girl|boy)$/i.test(tok)) {
      continue;
    }
    if (coreIdentityPattern.test(tok)) {
      corePhysical.push(tok);
    } else if (tok.split(/\s+/).length <= 8) {
      secondaryTraits.push(tok);
    }
  }

  // Keep up to 6 core physical traits + up to 2 secondary traits, capped around 160 chars
  const selected = [...corePhysical.slice(0, 6), ...secondaryTraits.slice(0, 2)];
  if (selected.length === 0) {
    return `${genderTag}, ${raw.slice(0, 120)}`;
  }

  let result = `${genderTag}, ${selected.join(', ')}`;
  if (result.length > 180) {
    result = result.slice(0, 180).replace(/,\s*[^,]*$/, '');
  }
  return result;
}

/**
 * Extracts a concise plain-English scene summary from the latest chat message
 * for fallback image generation when the LLM prompt crafter is unavailable.
 */
function extractFallbackSceneSnippet(messageText: string): string {
  if (!messageText) return '';
  // Remove speaker prefix "Name: "
  const withoutSpeaker = messageText.replace(/^[^:]{1,30}:\s*/, '');
  // Prefer physical action blocks in *asterisks* if present
  const actionMatches = Array.from(withoutSpeaker.matchAll(/\*([^*]+)\*/g))
    .map((m) => m[1].trim())
    .filter(Boolean);
  const rawSnippet =
    actionMatches.length > 0
      ? actionMatches.slice(-2).join('. ')
      : withoutSpeaker.replace(/["“”]/g, '').trim();
  return rawSnippet.replace(/\s+/g, ' ').slice(0, 200).trim();
}

export interface MossBoundingBoxItem {
  label: 'character' | 'object' | 'text';
  caption: string;
  text?: string;
  /** [y_min, x_min, y_max, x_max] in abs_centralized pixel coordinates (0,0 is canvas center) */
  bbox: [number, number, number, number];
}

export interface MossLayoutPromptPayload {
  summary: {
    meta: string[];
    canvas: string;
    caption: string;
  };
  items: MossBoundingBoxItem[];
  bbox_coord_space: 'abs_centralized';
  bbox_format: 'yxyx';
}

/**
 * Converts a [topPct, leftPct, bottomPct, rightPct] (0..100) percentage box
 * into MOSS-Image's native `abs_centralized` `yxyx` pixel coordinates `[y_min, x_min, y_max, x_max]`
 * where (0,0) is the center of the WxH canvas.
 */
export function pctBoxToAbsCentralizedYxyx(
  pctBox: [number, number, number, number],
  width = 1024,
  height = 1024
): [number, number, number, number] {
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));
  const toNum = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const rawTop = clamp(toNum(pctBox[0], 0), 0, 95);
  const rawLeft = clamp(toNum(pctBox[1], 0), 0, 95);
  const rawBottom = clamp(toNum(pctBox[2], 100), rawTop + 5, 100);
  const rawRight = clamp(toNum(pctBox[3], 100), rawLeft + 5, 100);

  const halfW = width / 2;
  const halfH = height / 2;
  const snap8 = (val: number, limit: number) =>
    clamp(Math.round(val / 8) * 8, -limit, limit);

  const yMin = snap8((rawTop / 100) * height - halfH, halfH);
  const xMin = snap8((rawLeft / 100) * width - halfW, halfW);
  const yMax = Math.max(
    yMin + 16,
    snap8((rawBottom / 100) * height - halfH, halfH)
  );
  const xMax = Math.max(
    xMin + 16,
    snap8((rawRight / 100) * width - halfW, halfW)
  );

  return [yMin, xMin, yMax, xMax];
}

/**
 * Converts MOSS-Image's `abs_centralized` `yxyx` pixel coordinates `[y_min, x_min, y_max, x_max]`
 * back into `[topPct, leftPct, bottomPct, rightPct]` (0..100) percentages for visual rendering & sliders.
 */
export function absCentralizedYxyxToPctBox(
  bbox: [number, number, number, number],
  width = 1024,
  height = 1024
): [number, number, number, number] {
  const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const halfW = width / 2;
  const halfH = height / 2;
  const topPct = clampPct(((bbox[0] + halfH) / height) * 100);
  const leftPct = clampPct(((bbox[1] + halfW) / width) * 100);
  const bottomPct = Math.max(
    topPct + 5,
    clampPct(((bbox[2] + halfH) / height) * 100)
  );
  const rightPct = Math.max(
    leftPct + 5,
    clampPct(((bbox[3] + halfW) / width) * 100)
  );
  return [topPct, leftPct, bottomPct, rightPct];
}

/**
 * Parses a MOSS-Image Layout Prompt JSON string if valid, or returns null if plain text.
 */
export function parseMossLayoutPrompt(
  rawPrompt: string
): MossLayoutPromptPayload | null {
  if (!rawPrompt || typeof rawPrompt !== 'string') return null;
  const trimmed = rawPrompt.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.summary &&
      Array.isArray(parsed.items)
    ) {
      const caption =
        typeof parsed.summary === 'string'
          ? parsed.summary
          : String(parsed.summary.caption || '');
      const meta = Array.isArray(parsed.summary?.meta)
        ? parsed.summary.meta.map(String)
        : ['photography', 'cinematic portrait'];
      const canvas = String(parsed.summary?.canvas || 'single');
      const items: MossBoundingBoxItem[] = parsed.items
        .filter((it: any) => it && typeof it === 'object')
        .map((it: any) => {
          const label: 'character' | 'object' | 'text' =
            it.label === 'text' || it.label === 'object'
              ? it.label
              : 'character';
          const rawBox = Array.isArray(it.bbox) ? it.bbox : [-400, -300, 440, 300];
          const bbox: [number, number, number, number] = [
            Math.round(Number(rawBox[0]) || -400),
            Math.round(Number(rawBox[1]) || -300),
            Math.round(Number(rawBox[2]) || 440),
            Math.round(Number(rawBox[3]) || 300),
          ];
          const itemObj: MossBoundingBoxItem = {
            label,
            caption: String(it.caption ?? ''),
            bbox,
          };
          if (label === 'text' || it.text !== undefined) {
            itemObj.text = String(it.text ?? '');
          }
          return itemObj;
        });

      return {
        summary: {
          meta,
          canvas,
          caption,
        },
        items,
        bbox_coord_space: 'abs_centralized',
        bbox_format: 'yxyx',
      };
    }
  } catch {
    // not valid JSON
  }
  return null;
}

export function serializeMossLayoutPrompt(
  payload: MossLayoutPromptPayload
): string {
  return JSON.stringify(payload, null, 2);
}

export interface ImageStylePresetSpec {
  id: ImageStylePreset;
  label: string;
  shortLabel: string;
  mossMeta: string[];
  captionOpener: string;
  styleGuidance: string;
  captionDetail: string;
  danbooruPrefix: string;
}

export const IMAGE_STYLE_PRESETS: ImageStylePresetSpec[] = [
  {
    id: 'photography',
    label: 'Photography · Cinematic',
    shortLabel: '📸 Photo',
    mossMeta: ['photography', 'cinematic portrait'],
    captionOpener: 'Photorealistic cinematic portrait',
    styleGuidance:
      'Use photorealistic cinematic photography aesthetics, natural skin and fabric detail, shallow depth of field, and realistic lighting.',
    captionDetail:
      'Soft directional lighting highlights facial expression, skin texture, and fabric folds, with shallow depth of field and natural human proportions.',
    danbooruPrefix: 'photorealistic, cinematic lighting, depth of field',
  },
  {
    id: 'anime',
    label: 'Anime · Digital Illustration',
    shortLabel: '🌸 Anime',
    mossMeta: ['anime', 'digital illustration'],
    captionOpener: 'Anime-style digital illustration',
    styleGuidance:
      'Use crisp high-quality anime illustration aesthetics: clean anime linework, expressive stylized eyes, vibrant cel/digital shading, and detailed anime background art. Do NOT describe as photorealistic or photography.',
    captionDetail:
      'Crisp anime linework, expressive stylized eyes, luminous cel-shaded highlights, rich anime color grading, and expressive composition.',
    danbooruPrefix: 'anime style, digital illustration, vibrant colors, crisp linework',
  },
  {
    id: 'semi_realistic',
    label: 'Semi-Realistic · 2.5D CG',
    shortLabel: '✨ 2.5D CG',
    mossMeta: ['digital painting', 'semi-realistic illustration'],
    captionOpener: 'Semi-realistic 2.5D CG digital illustration',
    styleGuidance:
      'Use polished semi-realistic 2.5D CG illustration aesthetics with refined painterly skin shading, detailed hair strands, stylized beauty, and volumetric lighting.',
    captionDetail:
      'Luminous painterly 2.5D CG rendering, refined facial shading, soft volumetric rim lighting, and rich atmospheric depth.',
    danbooruPrefix: 'semi-realistic, digital painting, 2.5d illustration, volumetric lighting',
  },
  {
    id: 'painting',
    label: 'Fantasy · Oil / Painterly',
    shortLabel: '🎨 Painting',
    mossMeta: ['digital painting', 'fantasy illustration'],
    captionOpener: 'Lush painterly fantasy illustration',
    styleGuidance:
      'Use expressive digital oil / fantasy concept art brushwork, dramatic chiaroscuro lighting, and textured artistic atmosphere.',
    captionDetail:
      'Expressive painterly brushwork, rich oil-style color harmonies, dramatic chiaroscuro light, and atmospheric depth.',
    danbooruPrefix: 'digital painting, painterly brushwork, fantasy illustration, dramatic lighting',
  },
  {
    id: 'manga',
    label: 'Manga · Cel-Shaded',
    shortLabel: '🖍️ Cel Manga',
    mossMeta: ['anime', 'cel-shaded illustration'],
    captionOpener: 'Clean cel-shaded manga-style illustration',
    styleGuidance:
      'Use clean cel-shaded anime/manga art style, crisp ink outlines, bold shadow shapes, and stylized dramatic framing.',
    captionDetail:
      'Clean ink outlines, crisp cel shading, high-contrast illustrative light, and expressive manga-inspired framing.',
    danbooruPrefix: 'manga style, cel shading, clean lineart, anime',
  },
];

export function getImageStylePresetSpec(
  styleId?: ImageStylePreset
): ImageStylePresetSpec {
  return (
    IMAGE_STYLE_PRESETS.find((s) => s.id === styleId) || IMAGE_STYLE_PRESETS[0]
  );
}

/**
 * Replaces a known leading style opener phrase (e.g. "Photorealistic cinematic portrait")
 * with the selected visual style's opener so toggling Photography <-> Anime updates existing drafts cleanly.
 */
export function applyVisualStyleToMossCaption(
  caption: string,
  targetStyle: ImageStylePreset
): string {
  const targetSpec = getImageStylePresetSpec(targetStyle);
  const trimmed = caption.trim();
  if (!trimmed) {
    return `${targetSpec.captionOpener} of the character in the current scene.`;
  }
  const openerAlternation = IMAGE_STYLE_PRESETS.map((s) =>
    s.captionOpener.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('|');
  const genericLeadRe = new RegExp(
    `^(?:${openerAlternation}|Photorealistic cinematic(?: medium(?: waist-up)?)? portrait|Cinematic photography of)`,
    'i'
  );
  if (genericLeadRe.test(trimmed)) {
    return trimmed.replace(genericLeadRe, targetSpec.captionOpener);
  }
  return trimmed;
}

export interface MossSpatialPreset {
  id: string;
  label: string;
  description: string;
  boxes: {
    label: 'character' | 'object' | 'text';
    pctBox: [number, number, number, number];
    roleHint: string;
  }[];
}

export const MOSS_SPATIAL_PRESETS: MossSpatialPreset[] = [
  {
    id: 'solo_portrait_foreground',
    label: '1. Solo Portrait + Foreground',
    description: 'Centered waist-up character + foreground table/bed/prop box',
    boxes: [
      {
        label: 'character',
        pctBox: [6, 16, 92, 84],
        roleHint: 'Primary character (waist-up / three-quarter pose, outfit & expression)',
      },
      {
        label: 'object',
        pctBox: [68, 8, 98, 92],
        roleHint: 'Foreground surface, table, bedding, or interactive item',
      },
    ],
  },
  {
    id: 'two_characters_interaction',
    label: '2. Two-Character Interaction',
    description: 'Left & right bounding boxes for two characters interacting',
    boxes: [
      {
        label: 'character',
        pctBox: [8, 4, 96, 56],
        roleHint: 'Primary character on the left/center-left',
      },
      {
        label: 'character',
        pctBox: [8, 46, 96, 96],
        roleHint: 'Second character / Player Persona on the right/center-right',
      },
    ],
  },
  {
    id: 'solo_full_body',
    label: '3. Solo Full-Body / Three-Quarter',
    description: 'Single large central character bounding box',
    boxes: [
      {
        label: 'character',
        pctBox: [4, 18, 96, 82],
        roleHint: 'Primary character full/three-quarter body framing in center',
      },
    ],
  },
  {
    id: 'intimate_closeup',
    label: '4. Intimate Close-Up + Environment',
    description: 'Large close-up character box + surrounding bed/couch context',
    boxes: [
      {
        label: 'character',
        pctBox: [8, 12, 94, 88],
        roleHint: 'Primary character intimate close-up / upper-body posture & expression',
      },
      {
        label: 'object',
        pctBox: [55, 4, 98, 96],
        roleHint: 'Soft pillows, sheets, couch, or furniture supporting the pose',
      },
    ],
  },
];

export const WORKFLOW_PROMPT_LENGTH_PRESETS: Array<{
  id: WorkflowPromptLengthPreset;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'compact',
    label: 'Compact (Short & Focused)',
    shortLabel: 'Compact',
    description: 'Tight prompt focusing on core framing, pose, and outfit.',
  },
  {
    id: 'balanced',
    label: 'Balanced (Default)',
    shortLabel: 'Balanced',
    description: 'Clear motion, expression, outfit, props, lighting, and setting.',
  },
  {
    id: 'detailed',
    label: 'Detailed (Rich Scene & Textures)',
    shortLabel: 'Detailed',
    description: 'Expanded hand/body nuance, fabric drape, props, and layered lighting.',
  },
  {
    id: 'ultra',
    label: 'Ultra Detailed (Maximum Prose)',
    shortLabel: 'Ultra',
    description: 'Deeply descriptive cinematic prose for complex scenes and multi-element prompts.',
  },
];

function getPromptLengthBudget(
  promptStyle: WorkflowPromptStyle,
  preset: WorkflowPromptLengthPreset = 'balanced'
): {
  proseRange: string;
  sdxlHybridTags: string;
  sdxlHybridSentences: string;
  animaSentences: string;
  tagCountRange: string;
  detailGuidance: string;
} {
  const detailMap: Record<WorkflowPromptLengthPreset, string> = {
    compact:
      'Keep descriptions concise and punchy, focusing cleanly on main framing, pose, expression, outfit, and key setting.',
    balanced:
      'Include clear physical motion, facial nuance, current outfit state, active props, ambient lighting, and surrounding setting.',
    detailed:
      'Richly articulate fine visual details: exact hand/finger and posture mechanics, fabric textures and drape, subtle facial emotion, foreground/background objects, and directional lighting contrast.',
    ultra:
      'Provide maximally rich, layered visual storytelling: precise full-pose geometry, micro-expressions, skin/hair/fabric surface textures, multi-plane foreground-to-background environmental details, and atmospheric color/lighting depth.',
  };

  if (promptStyle === 'moss_bbox') {
    const mossRanges: Record<WorkflowPromptLengthPreset, string> = {
      compact: '85 to 130 words',
      balanced: '130 to 210 words',
      detailed: '210 to 290 words',
      ultra: '280 to 360 words',
    };
    return {
      proseRange: mossRanges[preset],
      sdxlHybridTags: '',
      sdxlHybridSentences: '',
      animaSentences: '',
      tagCountRange: '',
      detailGuidance: detailMap[preset],
    };
  }

  if (promptStyle === 'sdxl_natural') {
    const sdxlRanges: Record<WorkflowPromptLengthPreset, string> = {
      compact: '35 to 55 words',
      balanced: '55 to 85 words',
      detailed: '85 to 130 words',
      ultra: '130 to 180 words',
    };
    return {
      proseRange: sdxlRanges[preset],
      sdxlHybridTags: '',
      sdxlHybridSentences: '',
      animaSentences: '',
      tagCountRange: '',
      detailGuidance: detailMap[preset],
    };
  }

  if (promptStyle === 'sdxl_hybrid' || promptStyle === 'anima_xl') {
    const hybridRanges: Record<
      WorkflowPromptLengthPreset,
      { prose: string; tags: string; sent: string }
    > = {
      compact: {
        prose: '40 to 65 words total',
        tags: '8 to 10 anchor tags',
        sent: '1 crisp natural sentence',
      },
      balanced: {
        prose: '65 to 105 words total',
        tags: '10 to 14 anchor tags',
        sent: '2 vivid natural sentences',
      },
      detailed: {
        prose: '105 to 155 words total',
        tags: '12 to 16 anchor tags',
        sent: '3 to 4 richly detailed sentences',
      },
      ultra: {
        prose: '155 to 210 words total',
        tags: '14 to 20 anchor tags',
        sent: '4 to 6 deeply descriptive sentences',
      },
    };
    const h = hybridRanges[preset];
    return {
      proseRange: h.prose,
      sdxlHybridTags: h.tags,
      sdxlHybridSentences: h.sent,
      animaSentences: h.sent,
      tagCountRange: '',
      detailGuidance: detailMap[preset],
    };
  }

  if (promptStyle === 'tags') {
    const tagRanges: Record<WorkflowPromptLengthPreset, string> = {
      compact: '12 to 20 tags',
      balanced: '18 to 28 tags',
      detailed: '28 to 40 tags',
      ultra: '40 to 55 tags',
    };
    return {
      proseRange: '',
      sdxlHybridTags: '',
      sdxlHybridSentences: '',
      animaSentences: '',
      tagCountRange: tagRanges[preset],
      detailGuidance: detailMap[preset],
    };
  }

  // 'edit_instruction' | 'natural'
  const proseRanges: Record<WorkflowPromptLengthPreset, string> = {
    compact: '35 to 60 words',
    balanced: '65 to 100 words',
    detailed: '100 to 150 words',
    ultra: '150 to 210 words',
  };
  return {
    proseRange: proseRanges[preset],
    sdxlHybridTags: '',
    sdxlHybridSentences: '',
    animaSentences: '',
    tagCountRange: '',
    detailGuidance: detailMap[preset],
  };
}

/**
 * Strips invisible internal monologues and mental flashbacks (e.g. `*心里乱糟糟地哀鸣：‘...’*`)
 * so the image prompt crafter only sees externally visible physical actions, body positions,
 * clothing states, and spoken dialogue—preventing hallucinated props or off-screen people.
 */
function stripInternalThoughtsForVisualPrompt(text: string): string {
  if (!text) return '';
  return text
    .replace(
      /\*[^*\n]{0,24}(?:心里|内心|心底|暗想|暗忖|心想|脑海中|脑海里)[^*\n]{0,16}[：:]\s*[‘'“"][^*]+?[’'”"]\s*\*/g,
      ' '
    )
    .replace(
      /\*[^*\n]{0,20}(?:心里|内心|心底)[^*\n]{0,14}(?:哀鸣|哀求|呐喊|咆哮|挣扎|想道|想着|默念|暗道)[：:][^*]+?\*/g,
      ' '
    )
    .replace(/\*?\s*脑海(?:中|里)[^。！？*\n]{4,120}[。！？]\s*\*?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function craftSceneImagePrompt(params: {
  llmService?: LLMServiceConfig;
  character: CharacterCardV2;
  persona: UserPersona;
  recentMessages: ChatMessage[];
  promptStyle: WorkflowPromptStyle;
  promptLengthPreset?: WorkflowPromptLengthPreset;
  referenceImageCount?: number;
  secondImageRole?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  imageStylePreset?: ImageStylePreset;
}): Promise<string> {
  const {
    llmService,
    character,
    recentMessages,
    promptStyle,
    promptLengthPreset = 'balanced',
    referenceImageCount = 1,
    secondImageRole = 'second subject / reference',
    canvasWidth = 1024,
    canvasHeight = 1024,
    imageStylePreset,
  } = params;
  const activeStyleSpec = getImageStylePresetSpec(imageStylePreset);
  const lengthBudget = getPromptLengthBudget(promptStyle, promptLengthPreset);
  const targetMessage = recentMessages[recentMessages.length - 1];
  const rawTargetText = targetMessage
    ? stripThinkBlocks(
        targetMessage.swipes[targetMessage.activeSwipeIndex] || ''
      )
    : '';
  const parsedTargetStatus = parseMessageStatusBlocks(rawTargetText);
  const statusSceneContextParts: string[] = [];
  if (parsedTargetStatus.metaFields.location) {
    statusSceneContextParts.push(
      `Current Location: ${parsedTargetStatus.metaFields.location}`
    );
  }
  if (parsedTargetStatus.metaFields.outfit) {
    statusSceneContextParts.push(
      `Status Bar Outfit (NOTE: if the narrative text below describes clothing pulled up, shifted, soaked, or removed, the narrative text ALWAYS overrides this): ${parsedTargetStatus.metaFields.outfit}`
    );
  }
  for (const cond of parsedTargetStatus.conditionFields || []) {
    if (
      cond.key &&
      cond.value &&
      !/(message|短信|消息|微信|电话|thought|心声|心理|memory|记忆|secret|秘密|stage|阶段)/i.test(
        cond.key
      )
    ) {
      statusSceneContextParts.push(`${cond.key}: ${cond.value}`);
    }
  }
  const statusSceneContext =
    statusSceneContextParts.length > 0
      ? `\nObservable Status State: ${statusSceneContextParts.join(' | ')}`
      : '';

  const cleanTargetNarrative = stripInternalThoughtsForVisualPrompt(
    parsedTargetStatus.cleanNarrativeText || rawTargetText
  );

  const latestTurnText = targetMessage
    ? `${targetMessage.speakerName}: ${cleanTargetNarrative}${statusSceneContext}`
    : '';

  const immediateTriggerMsg =
    recentMessages.length >= 2
      ? recentMessages[recentMessages.length - 2]
      : undefined;
  const triggerTurnText = immediateTriggerMsg
    ? (() => {
        const parsedTrig = parseMessageStatusBlocks(
          stripThinkBlocks(
            immediateTriggerMsg.swipes[immediateTriggerMsg.activeSwipeIndex] ||
              ''
          )
        );
        return `${
          immediateTriggerMsg.speakerName
        }: ${stripInternalThoughtsForVisualPrompt(
          parsedTrig.cleanNarrativeText
        ).slice(0, 420)}`;
      })()
    : '';

  const olderSettingMsg =
    recentMessages.length >= 3
      ? recentMessages[recentMessages.length - 3]
      : undefined;
  const olderSettingText = olderSettingMsg
    ? (() => {
        const parsedOld = parseMessageStatusBlocks(
          stripThinkBlocks(
            olderSettingMsg.swipes[olderSettingMsg.activeSwipeIndex] || ''
          )
        );
        return `${
          olderSettingMsg.speakerName
        }: ${stripInternalThoughtsForVisualPrompt(
          parsedOld.cleanNarrativeText
        ).slice(0, 200)}`;
      })()
    : '';

  const genderTag =
    character.gender === 'male'
      ? '1boy, male'
      : character.gender === 'non-binary'
      ? '1person, androgynous'
      : '1girl, female';
  const subjectNoun =
    character.gender === 'male'
      ? 'man'
      : character.gender === 'non-binary'
      ? 'person'
      : 'woman';
  const subjectPronoun =
    character.gender === 'male'
      ? 'his'
      : character.gender === 'non-binary'
      ? 'their'
      : 'her';

  // Extract compact permanent physical identity traits (hair, eyes, body build)
  // so long or studio-specific visualPrompt tags never drown out the live chat scene!
  const coreIdentity = extractCoreAppearanceTraits(
    character.visualPrompt || `${genderTag}, ${character.name}`,
    character.gender
  );

  const sharedVisualGroundingRules = `CRITICAL SCENE-FAITHFULNESS & INTERACTION RULES (HIGHEST PRIORITY):
- PRIMARY PHYSICAL ACTION SYNTHESIS: Depict the MAIN, MOST VISUALLY DEFINING PHYSICAL ACTION & BODY INTERACTION taking place in the Latest Turn combined with ${character.name}'s culminating clothing state and facial expression at the end of the turn. NEVER ignore the main physical interaction from earlier paragraphs of the Latest Turn just because the final paragraph zooms in on facial emotion or breathing!
- 1-PERSON vs 2-PERSON PHYSICAL INTERACTION: Check if ${params.persona.name} (${formatGenderProfile(
    params.persona.gender
  )}) is physically touching, holding, embracing, pressing against, undressing, or intimately intertwined with ${character.name} in the Latest Turn (or Immediately Preceding Turn). If YES, you MUST depict BOTH ${character.name} AND ${params.persona.name} actively engaged in that physical contact! Only depict ${character.name} solo if ${params.persona.name} is not in physical contact (e.g., watching from behind a camera or across the room).
- MATCH CAMERA FRAMING TO THE ACTION: If the action involves the lower body, hips, thighs, sitting on a desk/bed edge, lifting/pulling/removing a dress or underwear, or a two-person physical embrace/interaction, choose a three-quarter knee-up shot (cowboy shot) or full-body shot that clearly shows the action—do NOT crop to a chest-up headshot that hides what is happening!
- NARRATIVE OVERRIDES STATUS BAR OUTFIT: If the Latest Turn narrative describes clothing being pulled up, unbuttoned, shifted, soaked, or removed/undressed, the narrative text's exact clothing/undressed state ALWAYS overrides the baseline Status Bar Outfit.
- EXTERIOR CAMERA ONLY (NO HALLUCINATED PROPS): Depict ONLY what a physical camera in the room can visibly see right now. NEVER invent unmentioned objects (like phones, books, or tables) and NEVER depict off-screen people, memories, or metaphors.`;

  if (llmService && llmService.defaultModel) {
    try {
      let styleInstruction = '';
      if (promptStyle === 'edit_instruction') {
        const refRule =
          referenceImageCount >= 2
            ? `MULTI-IMAGE REFERENCE RULE (N = 2): Two input images are provided. Use the exact tags <image1> and <image2> (no spaces inside the brackets). <image1> is ${character.name}'s identity reference, and <image2> is the ${secondImageRole}. Open directly with "${activeStyleSpec.captionOpener} depicting the ${subjectNoun} from <image1>..." and integrate <image2> clearly.`
            : `SINGLE-IMAGE REFERENCE RULE (N = 1): One reference image of ${character.name} is provided. Refer to ${character.name} naturally as "the ${subjectNoun} in the image" (NEVER use Danbooru tags like "1girl", "solo", "masterpiece", or "8k"). Open directly with "${activeStyleSpec.captionOpener} depicting the ${subjectNoun} in the image..." or "Place the ${subjectNoun} in the image into...".`;

        styleInstruction = `/no_think
You are writing a vivid, scene-faithful image generation directive for Qwen-Image-2.1-Edit (TextEncodeQwenImage21).
The input image of ${character.name} is ONLY a character identity/face reference—your #1 job is to faithfully illustrate the EXACT MOTION, ACTION, BODY LANGUAGE, EXPRESSION, OUTFIT, and SETTING of the Latest Turn below (80% current scene & motion, 20% identity reference).
${sharedVisualGroundingRules}
Follow these strict rules:
1. ${refRule}
2. VISUAL MEDIUM & ART STYLE: ${activeStyleSpec.label}. ${activeStyleSpec.styleGuidance}
3. FAITHFULLY DEPICT THE LIVE MOTION & INTERACTION (DO NOT WATER DOWN INTO A STATIC PORTRAIT):
   - Capture what ${character.name} (and ${params.persona.name} if physically touching/interacting) is PHYSICALLY DOING in the Latest Turn (exact body posture, active motion, hand gestures, clothing/undressed state, head tilt, and gaze).
   - Pick ONE camera framing matching the action (use a three-quarter knee-up or full-body shot when lower-body/hip/clothing/embrace action is happening; if medium waist-up, do not mention feet).
4. OUTFIT, SETTING & IDENTITY PRESERVATION:
   - Explicitly state ${subjectPronoun} exact current clothing/undressed state in this scene, facial expression, ambient lighting, and surrounding setting.
   - ${lengthBudget.detailGuidance}
   - End with one short identity clause preserving ${subjectPronoun} facial identity, hairstyle, and natural proportions from the reference image—do NOT copy static reference backgrounds or outdated sheet outfits when the chat scene differs.
5. LENGTH & FORMAT: Write ${lengthBudget.proseRange} as a single continuous plain-English paragraph with NO line breaks, NO markdown, NO resolution numbers, and NO surrounding quotes.`;
      } else if (promptStyle === 'moss_bbox') {
        styleInstruction = `/no_think
You are an expert MOSS-Image spatial layout & bounding-box prompt architect for RolePlay Studio.
Your task is to design a layout-guided MOSS-Image scene prompt faithfully illustrating the Latest Turn below, with exact spatial placement boxes so the character's pose, framing, outfit state, and any physical partner/objects are positioned accurately.
${sharedVisualGroundingRules}
Follow these strict rules:
1. VISUAL MEDIUM & ART STYLE (MANDATORY):
   - Use this exact visual style: ${activeStyleSpec.label}
   - ${activeStyleSpec.styleGuidance}
   - Set "meta" to ${JSON.stringify(activeStyleSpec.mossMeta)}.
2. 80% CURRENT CHAT SCENE / 20% PERMANENT PHYSICAL IDENTITY:
   - Depict the main physical action, body posture, current clothing/undressed state, facial expression, and setting of the Latest Turn below.
   - Use "Core Physical Identity Traits" ONLY for permanent features (hair, eyes, body figure). NEVER copy static studio backgrounds or unrelated poses.
3. GLOBAL SCENE CAPTION ("summaryCaption"):
   - Open with "${activeStyleSpec.captionOpener} of ..." (never start with a verb, and keep the entire prose aligned with ${activeStyleSpec.label}).
   - Write ${lengthBudget.proseRange} of rich, flowing natural English prose covering: Subject(s) appearance & exact current clothing/undressed state, Main physical action & body interaction, Space (foreground/midground/background), Setting details, Camera Framing (use three-quarter thigh/knee-up or full-body shot when lower-body/dress/hip/embrace action occurs, or medium waist-up shot for upper-body dialogue), Lighting, and Tone.
   - ${lengthBudget.detailGuidance}
   - Do NOT use Danbooru tag soup ("1girl, masterpiece, 8k") and do NOT mention resolution numbers.
4. SPATIAL BOUNDING BOXES ("boxes" array — 1 to 3 boxes):
   - Specify each box's position using percentage coordinates "box_pct": [top_pct, left_pct, bottom_pct, right_pct] from 0 to 100 (where [0,0] is top-left and [100,100] is bottom-right; our compiler converts these to MOSS's native abs_centralized yxyx pixel coordinates).
   - Box 1 MUST be label: "character" for ${character.name}. Its "caption" (1 to 3 sentences) must describe ${character.name}'s appearance, hair, eyes, exact current clothing/undressed state in this turn, facial expression, and physical pose inside that box.
   - Box 2:
     * IF ${params.persona.name} (or another character) is physically touching, holding, embracing, or visibly interacting with ${character.name} in the scene: Box 2 MUST be label: "character" for ${params.persona.name} (${formatGenderProfile(
       params.persona.gender
     )}), positioned to overlap or adjoin Box 1 according to their physical interaction (e.g. "box_pct": [4, 24, 96, 92] while Box 1 is [8, 12, 96, 78]).
     * ONLY use label: "object" if there is a real, physically touched surface or prop in the scene (e.g., desk edge, bed, camera). NEVER invent phones, books, or props that are not physically being used in the Latest Turn!
   - Only add a label: "text" box if the scene explicitly features a physically visible sign or poster in the room.

Return ONLY valid JSON matching this schema:
{
  "meta": ${JSON.stringify(activeStyleSpec.mossMeta)},
  "summaryCaption": "${activeStyleSpec.captionOpener} of ...",
  "boxes": [
    {
      "label": "character",
      "box_pct": [6, 14, 96, 86],
      "caption": "Primary character appearance, exact current outfit/undressed state, expression, and active pose..."
    }
  ]
}`;
      } else if (promptStyle === 'anima_xl') {
        styleInstruction = `/no_think
Write an Anima / Anima XL prompt following the official Anima hierarchical ordering and hybrid format (structured tags FIRST in exact order, followed by vivid natural English scene prose) illustrating the Latest Turn below.
${sharedVisualGroundingRules}
STRICT ANIMA PROMPT ORDER & FORMATTING RULES:
1. MANDATORY SEQUENCE (in this exact order):
   [Quality / Meta / Year / Safety] -> [Subject Count] -> [Character Physical Anchors] -> [General Scene Tags] -> [Natural Language Scene Prose]
2. HEADER & SAFETY TAG:
   - Start with: "masterpiece, best quality, score_7, highres, year 2025, newest, <safety>"
   - Choose <safety> accurately from the scene content: "safe" (normal/wholesome), "sensitive" (flirty/suggestive/lingerie/soaked clothing), or "nsfw" / "explicit" if the Latest Turn depicts nudity or sexual intimacy. (If an artist tag is requested in the character's visual traits, keep its "@" prefix like "@artistname".)
3. TAG FORMATTING (CRITICAL):
   - Write all general tags in LOWERCASE WITH SPACES instead of underscores (e.g. "long hair", "looking at viewer", "cowboy shot" — NEVER "long_hair" or "looking_at_viewer"; ONLY "score_7" keeps an underscore).
   - Subject count: use "1girl, 1boy" (or "2people") whenever ${params.persona.name} is physically touching, holding, or interacting with ${character.name} in the turn; otherwise use "${subjectNoun === 'man' ? '1boy, solo' : '1girl, solo'}".
   - Anchor 3 permanent character traits right after count (${coreIdentity} rewritten as lowercase space-separated tags), followed by concise lowercase tags for exact current outfit/undressed state, active physical interaction/pose, expression, and framing ("cowboy shot", "full body", or "medium shot").
4. NATURAL LANGUAGE SCENE PROSE (at the end):
   - Immediately after the tags, write ${lengthBudget.animaSentences} (${lengthBudget.proseRange}) describing the exact physical action, interaction with ${params.persona.name} (if present), current clothing/undressed state, setting, lighting, and mood of the Latest Turn.
   - ${lengthBudget.detailGuidance}
   - Style alignment: ${activeStyleSpec.label}. ${activeStyleSpec.styleGuidance}
5. STRICTLY AVOID:
   - NEVER use Pony strings ("score_9, score_8_up, source_anime"), underscored general tags, or static studio backgrounds that contradict the scene.
   - Output ONLY the final single-line hybrid prompt without commentary or surrounding quotes.`;
      } else if (promptStyle === 'sdxl_natural') {
        styleInstruction = `/no_think
Write a vivid, cohesive natural-language image prompt (${lengthBudget.proseRange}, plain single paragraph) specifically optimized for SDXL's dual CLIP encoders (CLIP-L + OpenCLIP ViT-bigG) illustrating the Latest Turn below.
${sharedVisualGroundingRules}
STRICT SDXL NATURAL PROMPT RULES:
1. ART MEDIUM & STYLE: ${activeStyleSpec.label}. ${activeStyleSpec.styleGuidance}
2. TOKEN-BUDGET & DETAIL (${lengthBudget.proseRange.toUpperCase()}):
   - Open directly with camera framing and visual style (e.g., "${activeStyleSpec.captionOpener}, three-quarter shot of ..."), then describe the main physical action and interaction of the Latest Turn.
   - Clearly describe ${character.name}'s current action/posture (and ${params.persona.name}'s physical interaction if touching/holding ${subjectPronoun}), facial expression, exact current clothing or undressed state, lighting, and location/background in natural descriptive English.
   - ${lengthBudget.detailGuidance}
   - Weave in ONLY permanent physical traits from Core Physical Identity Traits (hair color/style, eye color, body build)—NEVER copy conflicting static outfits or studio backgrounds from the character sheet.
3. ANATOMY & COHERENCE:
   - Choose ONE consistent camera framing that clearly shows the main action of the turn.
   - Use natural prose instead of Danbooru tag soup or quality spam (no "1girl, solo, masterpiece, best quality, 8k").`;
      } else if (promptStyle === 'sdxl_hybrid') {
        styleInstruction = `/no_think
Write a two-part hybrid SDXL / Illustrious prompt combining concise anchor tags FIRST followed by natural English scene prose (${lengthBudget.proseRange}) illustrating the Latest Turn below.
${sharedVisualGroundingRules}
STRICT SDXL HYBRID RULES:
1. PART 1 — CONCISE ANCHOR TAGS (${lengthBudget.sdxlHybridTags.toUpperCase()}, COMMA-SEPARATED):
   - Start with essential quality/style and identity anchors matching ${activeStyleSpec.label} (${activeStyleSpec.danbooruPrefix}), camera framing tag matching the action (e.g. "cowboy shot", "full body", or "medium shot"), subject count ("1girl, 1boy" if ${params.persona.name} is physically interacting with ${character.name}, or "${subjectNoun === 'man' ? '1boy, solo' : '1girl, solo'}" if solo), and 3 to 5 permanent physical traits from ${coreIdentity} plus current outfit/undressed state tags.
   - NEVER include static studio backgrounds or conflicting default outfits in the anchor tags.
2. PART 2 — NATURAL LANGUAGE SCENE PROSE (${lengthBudget.sdxlHybridSentences.toUpperCase()} RIGHT AFTER THE ANCHORS):
   - Immediately after the anchor tags, write ${lengthBudget.sdxlHybridSentences} describing what is happening right now in the Latest Turn: ${character.name}'s exact current pose/action (and physical interaction with ${params.persona.name} if present), facial expression, current outfit or undressed state, foreground/background environment, and lighting.
   - ${lengthBudget.detailGuidance}
   - Style alignment: ${activeStyleSpec.label}. ${activeStyleSpec.styleGuidance}`;
      } else if (promptStyle === 'natural') {
        styleInstruction = `/no_think
Write a vivid, single-paragraph natural language image generation caption (${lengthBudget.proseRange}) optimized for Moss / Flux.1 illustrating the Latest Turn below.
${sharedVisualGroundingRules}
STRICT SCENE PRIORITY RULES (DO NOT JUST OUTPUT CHARACTER APPEARANCE):
1. ART MEDIUM & STYLE: ${activeStyleSpec.label}. ${activeStyleSpec.styleGuidance}
2. 80% CURRENT CHAT SCENE / 20% CORE PHYSICAL TRAITS:
   - Your prompt MUST primarily depict the main physical action and interaction happening in the Latest Turn: ${character.name}'s active posture (and physical interaction with ${params.persona.name} if touching/holding ${subjectPronoun}), current facial emotion, exact current clothing/undressed state in the scene, and the current room/location lighting.
   - ${lengthBudget.detailGuidance}
   - Use "Core Physical Identity Traits" ONLY for permanent features (hair color/style, eye color, body figure). NEVER copy static portrait poses (like "sitting on stool") or studio backgrounds from the character sheet!
3. ANATOMY & FRAMING:
   - Pick ONE consistent camera framing that clearly shows the main physical action (use a three-quarter knee-up shot or full-body shot when lower-body/dress/hip/embrace action is happening).
   - Start with the medium/camera shot and scene action, weave in ${character.name}'s core physical traits naturally, and describe the current outfit state and environment. Do NOT use Danbooru tag soup ("1girl, solo, masterpiece, 8k").`;
      } else {
        styleInstruction = `/no_think
Write a comma-separated list of Danbooru / SDXL tags (${lengthBudget.tagCountRange} total) illustrating the Latest Turn below.
${sharedVisualGroundingRules}
STRICT TAG PRIORITY RULES (DO NOT JUST COPY CHARACTER APPEARANCE TAGS):
1. Include style tags matching ${activeStyleSpec.label} (${activeStyleSpec.danbooruPrefix}) alongside CURRENT SCENE tags FIRST: subject count ("1girl, 1boy" if ${params.persona.name} is physically interacting with ${character.name}, else "${subjectNoun === 'man' ? '1boy, solo' : '1girl, solo'}"), camera framing ("cowboy shot" or "full body" for lower-body/embrace actions, or "medium shot"), current pose/interaction from the Latest Turn, current facial expression, exact current clothing/undressed state in the scene, lighting, and current location/background.
2. ${lengthBudget.detailGuidance}
3. Include ONLY 4 to 6 core permanent physical traits for ${character.name} (hair color/style, eye color, body figure).
4. NEVER copy static studio backgrounds (e.g. "photography studio background"), static portrait poses (e.g. "sitting on stool"), or conflicting default outfits if the Latest Turn takes place elsewhere or changes clothing!
5. Output ONLY the comma-separated tags.`;
      }

      const contextParts: string[] = [];
      if (olderSettingText) {
        contextParts.push(
          `Earlier Turn (for room/location continuity ONLY — ignore old poses here):\n${olderSettingText}`
        );
      }
      if (triggerTurnText) {
        contextParts.push(
          `Immediately Preceding Turn (what ${
            immediateTriggerMsg?.speakerName || params.persona.name
          } just did/said to initiate or continue this physical interaction):\n${triggerTurnText}`
        );
      }
      contextParts.push(
        `Latest Turn to Illustrate (depict the MAIN physical action/interaction and culminating clothing/expression state here):\n${latestTurnText}`
      );
      const sceneBlock = contextParts.join('\n\n');

      const userContent =
        promptStyle === 'edit_instruction'
          ? `Character Name (${
              referenceImageCount >= 2 ? '<image1>' : 'reference image'
            }): ${character.name} (${formatGenderProfile(
              character.gender
            )})\nCore Physical Identity Traits (hair/eyes/face ONLY — do NOT let static reference poses or outfits override the live motion below): ${coreIdentity}\n${
              referenceImageCount >= 2
                ? `Second Input Image (<image2>): ${secondImageRole}\n`
                : ''
            }Interacting With (${params.persona.name}): ${formatGenderProfile(
              params.persona.gender
            )}\n\n${sceneBlock}\n\nWrite the ${lengthBudget.proseRange} Qwen-Image-2.1-Edit scene directive faithfully capturing ${character.name}'s exact motion, action, expression, outfit, and setting in the Latest Turn now:`
          : `Character: ${character.name} (${formatGenderProfile(
              character.gender
            )})\nCore Physical Identity Traits (hair/eyes/figure ONLY — do NOT let this override the scene's action, outfit, or location): ${coreIdentity}\nUser Persona: ${
              params.persona.name
            } (${formatGenderProfile(
              params.persona.gender
            )})\n\n${sceneBlock}\n\nGenerate the ${promptStyle} scene prompt illustrating the Latest Turn now:`;

      const crafted = await generateChatCompletion(
        llmService,
        [
          {
            role: 'system',
            content: `You are an expert ComfyUI prompt engineer for RolePlay Studio.\n${styleInstruction}\nOutput ONLY the final ${
              promptStyle === 'moss_bbox' ? 'JSON object' : 'prompt text'
            } without commentary or surrounding quotes.`,
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        {
          temperature: 0.4,
          disableThinking: true,
          jsonMode: promptStyle === 'moss_bbox',
          maxTokensOverride: 1200,
          taskLabel: `Craft ${
            promptStyle === 'edit_instruction'
              ? 'Qwen Edit'
              : promptStyle === 'moss_bbox'
              ? 'MOSS Bounding Box'
              : promptStyle === 'anima_xl'
              ? 'Anima XL'
              : promptStyle === 'sdxl_natural'
              ? 'SDXL Natural'
              : promptStyle === 'sdxl_hybrid'
              ? 'SDXL Hybrid'
              : 'Scene'
          } Prompt (${llmService.defaultModel || llmService.name})`,
        }
      );

      if (promptStyle === 'moss_bbox') {
        const rawClean = stripThinkBlocks(crafted).trim();
        const jsonMatch = rawClean.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            // Case A: LLM already returned native MOSS Layout JSON
            const directMoss = parseMossLayoutPrompt(jsonMatch[0]);
            if (directMoss && directMoss.items.length > 0) {
              if (imageStylePreset) {
                directMoss.summary.meta = [...activeStyleSpec.mossMeta];
                directMoss.summary.caption = applyVisualStyleToMossCaption(
                  directMoss.summary.caption,
                  imageStylePreset
                );
              }
              return serializeMossLayoutPrompt(directMoss);
            }
            // Case B: Convert LLM's box_pct (0..100) schema into native MOSS abs_centralized yxyx JSON
            const summaryCaption = String(
              parsed.summaryCaption ||
                parsed.summary?.caption ||
                parsed.caption ||
                ''
            ).trim();
            const rawBoxes = Array.isArray(parsed.boxes)
              ? parsed.boxes
              : Array.isArray(parsed.items)
              ? parsed.items
              : [];

            if (summaryCaption.length > 20 && rawBoxes.length > 0) {
              const compiledItems: MossBoundingBoxItem[] = rawBoxes
                .filter((b: any) => b && typeof b === 'object')
                .slice(0, 4)
                .map((b: any, idx: number) => {
                  const label: 'character' | 'object' | 'text' =
                    b.label === 'object' || b.label === 'text'
                      ? b.label
                      : 'character';
                  const pctArr: [number, number, number, number] =
                    Array.isArray(b.box_pct) && b.box_pct.length === 4
                      ? [
                          Number(b.box_pct[0]),
                          Number(b.box_pct[1]),
                          Number(b.box_pct[2]),
                          Number(b.box_pct[3]),
                        ]
                      : idx === 0
                      ? [6, 16, 94, 84]
                      : [68, 10, 98, 90];
                  const bbox = pctBoxToAbsCentralizedYxyx(
                    pctArr,
                    canvasWidth,
                    canvasHeight
                  );
                  const item: MossBoundingBoxItem = {
                    label,
                    caption:
                      String(b.caption || '').trim() ||
                      (label === 'character'
                        ? `A ${subjectNoun} (${coreIdentity}) in the current scene with an expressive reaction.`
                        : 'Foreground scene element supporting the character.'),
                    bbox,
                  };
                  if (label === 'text' && b.text) {
                    item.text = String(b.text);
                  }
                  return item;
                });

              const payload: MossLayoutPromptPayload = {
                summary: {
                  meta: imageStylePreset
                    ? [...activeStyleSpec.mossMeta]
                    : Array.isArray(parsed.meta)
                    ? parsed.meta.map(String)
                    : [...activeStyleSpec.mossMeta],
                  canvas: 'single',
                  caption: imageStylePreset
                    ? applyVisualStyleToMossCaption(
                        summaryCaption,
                        imageStylePreset
                      )
                    : summaryCaption,
                },
                items: compiledItems,
                bbox_coord_space: 'abs_centralized',
                bbox_format: 'yxyx',
              };
              return serializeMossLayoutPrompt(payload);
            }
          } catch {
            // Fall through to deterministic MOSS bounding-box builder below
          }
        }
      }

      const cleaned = stripThinkBlocks(crafted)
        .replace(/^["']|["']$/g, '')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length > 15 && promptStyle !== 'moss_bbox') {
        return cleaned;
      }
    } catch {
      // Fallback below if LLM call fails
    }
  }

  const fallbackSceneSnippet = extractFallbackSceneSnippet(latestTurnText);

  if (promptStyle === 'edit_instruction') {
    const targetRef =
      referenceImageCount >= 2
        ? `the ${subjectNoun} from <image1>`
        : `the ${subjectNoun} in the image`;
    const outfitText = parsedTargetStatus.metaFields.outfit
      ? `, wearing ${parsedTargetStatus.metaFields.outfit}`
      : '';
    const locationText = parsedTargetStatus.metaFields.location
      ? ` inside ${parsedTargetStatus.metaFields.location}`
      : '';
    return `${activeStyleSpec.captionOpener} depicting ${targetRef}${outfitText}${locationText}, ${
      fallbackSceneSnippet ||
      'caught mid-action in the current scene with an expressive reaction and natural posture'
    }, preserving ${subjectPronoun} exact facial features, hairstyle, and natural proportions from the reference image, ${activeStyleSpec.captionDetail}.`;
  }
  if (promptStyle === 'moss_bbox') {
    const outfitText = parsedTargetStatus.metaFields.outfit
      ? `wearing ${parsedTargetStatus.metaFields.outfit}`
      : 'in her current scene attire';
    const locationText = parsedTargetStatus.metaFields.location
      ? `inside ${parsedTargetStatus.metaFields.location}`
      : 'in an atmospheric interior setting';
    const actionDesc =
      fallbackSceneSnippet ||
      'leaning forward slightly with a subtle blush and expressive gaze';

    const fallbackPayload: MossLayoutPromptPayload = {
      summary: {
        meta: [...activeStyleSpec.mossMeta],
        canvas: 'single',
        caption: `${activeStyleSpec.captionOpener} of a ${subjectNoun} (${coreIdentity}), ${outfitText}, ${locationText}. ${actionDesc}. ${activeStyleSpec.captionDetail}`,
      },
      items: [
        {
          label: 'character',
          caption: `A ${subjectNoun} with ${coreIdentity}, ${outfitText}, ${actionDesc}, framed in a natural medium waist-up posture.`,
          bbox: pctBoxToAbsCentralizedYxyx(
            [6, 16, 94, 84],
            canvasWidth,
            canvasHeight
          ),
        },
        {
          label: 'object',
          caption: `Foreground surface and ambient props ${locationText}, softly lit in the lower frame.`,
          bbox: pctBoxToAbsCentralizedYxyx(
            [70, 8, 98, 92],
            canvasWidth,
            canvasHeight
          ),
        },
      ],
      bbox_coord_space: 'abs_centralized',
      bbox_format: 'yxyx',
    };
    return serializeMossLayoutPrompt(fallbackPayload);
  }
  if (promptStyle === 'anima_xl') {
    const subjTag = subjectNoun === 'man' ? '1boy, solo' : '1girl, solo';
    const spaceCore = coreIdentity.replace(/_/g, ' ').toLowerCase();
    const outfitSnippet = parsedTargetStatus.metaFields.outfit
      ? `wearing ${parsedTargetStatus.metaFields.outfit}`
      : 'in current scene attire';
    const locSnippet = parsedTargetStatus.metaFields.location
      ? `inside ${parsedTargetStatus.metaFields.location}`
      : 'in an atmospheric interior setting';
    return fallbackSceneSnippet
      ? `masterpiece, best quality, score_7, highres, year 2025, newest, safe, ${subjTag}, ${spaceCore}, medium shot. ${character.name} ${outfitSnippet}, ${locSnippet}, ${fallbackSceneSnippet}, expressive anime eyes, atmospheric lighting.`
      : `masterpiece, best quality, score_7, highres, year 2025, newest, safe, ${subjTag}, ${spaceCore}, medium shot. ${character.name} ${outfitSnippet}, ${locSnippet}, expressive emotion, soft anime shading, warm atmospheric lighting.`;
  }
  if (promptStyle === 'sdxl_natural') {
    return fallbackSceneSnippet
      ? `${activeStyleSpec.captionOpener} of ${character.name} (${coreIdentity}) in a natural medium waist-up shot: ${fallbackSceneSnippet}, expressive facial emotion, atmospheric scene lighting, ${activeStyleSpec.captionDetail}.`
      : `${activeStyleSpec.captionOpener} of ${character.name} (${coreIdentity}) in a natural medium waist-up shot with expressive emotion and atmospheric scene lighting, ${activeStyleSpec.captionDetail}.`;
  }
  if (promptStyle === 'sdxl_hybrid') {
    const subjTag = subjectNoun === 'man' ? '1boy, solo' : '1girl, solo';
    return fallbackSceneSnippet
      ? `${activeStyleSpec.danbooruPrefix}, medium shot, ${subjTag}, ${coreIdentity}. ${character.name} is captured in the current scene: ${fallbackSceneSnippet}, warm atmospheric lighting, expressive facial emotion.`
      : `${activeStyleSpec.danbooruPrefix}, medium shot, ${subjTag}, ${coreIdentity}. ${character.name} is framed in a medium waist-up portrait with expressive emotion and soft atmospheric lighting.`;
  }
  if (promptStyle === 'natural') {
    return fallbackSceneSnippet
      ? `A cinematic medium portrait of ${character.name} (${coreIdentity}) in the current scene: ${fallbackSceneSnippet}, atmospheric lighting, natural proportions.`
      : `A cinematic medium portrait of ${character.name} (${coreIdentity}) in an atmospheric scene with expressive emotion and dramatic lighting.`;
  }
  return fallbackSceneSnippet
    ? `masterpiece, best quality, medium shot, ${coreIdentity}, ${fallbackSceneSnippet}, expressive emotion, dramatic scene lighting`
    : `masterpiece, best quality, medium shot, ${coreIdentity}, expressive emotion, dramatic scene lighting, high detail`;
}

/**
 * Generates a self-contained Story World Setting, starter Story Lore entries,
 * and an Opening Scene greeting from a user premise using the connected local LLM.
 */
export async function aiGenerateStoryWorldAndOpening(params: {
  llmService: LLMServiceConfig;
  premise: string;
  characters: CharacterCardV2[];
  persona: UserPersona;
  language?: ConversationLanguage;
}): Promise<{
  title: string;
  worldSetting: string;
  openingMessage: string;
  storyLore: LorebookEntry[];
}> {
  const { llmService, premise, characters, persona, language } = params;
  const leadChar = characters[0];
  const castNames = characters
    .map(
      (c) =>
        `${c.name} [${formatGenderProfile(c.gender)}] (${c.personality})`
    )
    .join('; ');
  const langRule = getLanguageInstruction(language);

  const systemPrompt = `You are a master interactive fiction and role-play world-builder.
Given a user's story premise and the participating character(s), create a self-contained Story Bible in valid JSON format with:
- "title": A catchy 3-6 word title for this story
- "worldSetting": A rich 2-3 sentence description of the world rules, atmosphere, location, and immediate scenario involving ${leadChar.name} and ${persona.name}
- "openingMessage": An immersive opening role-play message written from the perspective of ${leadChar.name} (actions in *asterisks*, dialogue in "quotes") setting the scene
- "loreEntries": An array of 3 self-contained world lore items for this story, each with { "name": "Entry Title", "keys": ["keyword1", "keyword2"], "content": "1-2 sentences of lore" }
${langRule ? `\n${langRule}` : ''}
Return ONLY valid JSON.`;

  const userPrompt = `Story Premise: ${premise || 'An atmospheric new adventure'}
Cast: ${castNames}
User Persona: ${persona.name} [${formatGenderProfile(persona.gender)}] (${persona.description})

Generate the JSON Story Bible now:`;

  const raw = await generateChatCompletion(
    llmService,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      jsonMode: true,
      temperature: 0.7,
      disableThinking: true,
      maxTokensOverride: 1000,
    }
  );

  const cleaned = stripThinkBlocks(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Could not parse AI story response');
  }
  const parsed = JSON.parse(match[0]);

  const storyLore: LorebookEntry[] = Array.isArray(parsed.loreEntries)
    ? parsed.loreEntries.map((item: any, idx: number) => ({
        id: `slore-${Date.now()}-${idx}`,
        name: String(item.name || `World Fact #${idx + 1}`),
        keys: Array.isArray(item.keys)
          ? item.keys.map(String)
          : String(item.keys || item.name || '')
              .split(',')
              .map((k: string) => k.trim())
              .filter(Boolean),
        content: String(item.content || ''),
        enabled: true,
        constant: false,
        priority: 15,
      }))
    : [];

  return {
    title: String(parsed.title || `Story with ${leadChar.name}`),
    worldSetting: String(parsed.worldSetting || premise),
    openingMessage: String(parsed.openingMessage || leadChar.first_mes),
    storyLore,
  };
}

/**
 * Scans the current story's messages and extracts new self-contained Lore entries
 * (locations, items, characters, rules) that emerged during role-play.
 */
const GENERIC_LORE_STOP_KEYS = new Set([
  'schedule',
  'timeline',
  'calendar',
  'meeting',
  'appointment',
  'deadline',
  'today',
  'tomorrow',
  'yesterday',
  'morning',
  'afternoon',
  'evening',
  'night',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'day',
  'week',
  'time',
  'outfit',
  'clothes',
  'clothing',
  'room',
  'office',
  'home',
  'house',
  'work',
  'job',
  'life',
  'love',
  'relationship',
  'secret',
  'plan',
  'plans',
  'story',
  'character',
  'user',
  'player',
  '日程',
  '安排',
  '时间表',
  '今天',
  '明天',
  '昨天',
  '上午',
  '下午',
  '晚上',
  '衣服',
  '房间',
  '关系',
]);

function collectProtagonistNamesForLoreGuard(
  session: ChatSession,
  characters: CharacterCardV2[] = []
): string[] {
  const names = new Set<string>();
  for (const c of characters) {
    if (c?.name?.trim()) names.add(c.name.trim());
  }
  for (const m of session.messages) {
    if (m.speakerName?.trim()) {
      names.add(m.speakerName.trim());
    }
  }
  return Array.from(names);
}

function sanitizeAutoLoreKeys(
  rawKeys: string[],
  entryName: string,
  blockedNames: string[]
): string[] {
  const blockedLower = new Set<string>();
  for (const name of blockedNames) {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) continue;
    blockedLower.add(trimmed);
    for (const part of trimmed.split(/[\s·_-]+/)) {
      if (part.length >= 2) blockedLower.add(part);
    }
  }

  const isAllowedKey = (key: string): boolean => {
    const lower = key.trim().toLowerCase();
    if (lower.length < 2) return false;
    if (blockedLower.has(lower)) return false;
    if (GENERIC_LORE_STOP_KEYS.has(lower)) return false;
    return true;
  };

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawKeys) {
    const cleaned = raw.trim();
    if (!isAllowedKey(cleaned)) continue;
    const lower = cleaned.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(cleaned);
    }
  }

  if (deduped.length === 0 && isAllowedKey(entryName)) {
    deduped.push(entryName.trim());
  }
  return deduped;
}

export async function aiExtractLoreFromStory(params: {
  llmService: LLMServiceConfig;
  session: ChatSession;
}): Promise<LorebookEntry[]> {
  const { llmService, session } = params;
  const recentTranscript = session.messages
    .slice(-10)
    .map((m) => `${m.speakerName}: ${m.swipes[m.activeSwipeIndex] || ''}`)
    .join('\n');

  const existingNames = (session.storyLore || []).map((e) => e.name).join(', ');
  const blockedProtagonistNames = collectProtagonistNamesForLoreGuard(session);
  const blockedListStr = blockedProtagonistNames.join(', ') || 'the main characters';

  const raw = await generateChatCompletion(
    llmService,
    [
      {
        role: 'system',
        content: `You are a Story Lore Archivist. Read the role-play transcript and extract 0 to 3 durable, long-term locations, items, factions, recurring NPCs, or world secrets that belong to this story's world.
Avoid duplicating existing entries (${existingNames || 'none'}).
STRICT GUARDRAILS:
- NEVER include protagonist/player names (${blockedListStr}) in "keys" (those trigger on every turn and bloat context).
- NEVER use overly generic single words like "schedule", "timeline", "meeting", "outfit", "today", "tomorrow", or weekday names ("Monday", "Friday", etc.) as "keys".
- Do NOT create permanent lorebook entries for one-time temporary appointments, errands, or daily schedules.
Return ONLY valid JSON with this structure:
{
  "entries": [
    {
      "name": "Entry Name",
      "keys": ["specific keyword 1", "specific alias 2"],
      "content": "Concise 1-2 sentence lore description based on the story."
    }
  ]
}`,
      },
      {
        role: 'user',
        content: `Story Title: ${session.title}\nWorld Setting: ${
          session.worldSetting || 'N/A'
        }\n\nRecent Transcript:\n${recentTranscript}`,
      },
    ],
    {
      jsonMode: true,
      temperature: 0.3,
      disableThinking: true,
      maxTokensOverride: 800,
    }
  );

  const cleaned = stripThinkBlocks(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.entries)) return [];

  const existingSet = new Set(
    (session.storyLore || []).map((e) => e.name.trim().toLowerCase())
  );

  return parsed.entries
    .map((item: any, idx: number) => {
      const name = String(item?.name || '').trim();
      const rawKeys = Array.isArray(item?.keys)
        ? item.keys.map((k: any) => String(k).trim()).filter(Boolean)
        : String(item?.keys || item?.name || '')
            .split(',')
            .map((k: string) => k.trim())
            .filter(Boolean);
      const safeKeys = sanitizeAutoLoreKeys(rawKeys, name, blockedProtagonistNames);
      return {
        id: `slore-${Date.now()}-${idx}`,
        name,
        keys: safeKeys,
        content: String(item?.content || '').trim(),
        enabled: true,
        constant: false,
        priority: 15,
      };
    })
    .filter(
      (entry: LorebookEntry) =>
        entry.name.length >= 2 &&
        entry.keys.length > 0 &&
        entry.content.length >= 8 &&
        !existingSet.has(entry.name.toLowerCase())
    );
}

/**
 * Helper to strip both complete `<think>...</think>` / `<thought>...</thought>` blocks and any unclosed prefix.
 */
function stripThinkBlocks(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/gi, '')
    .trim();
  if (/<(?:think|thought)>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<(?:think|thought)>[\s\S]*/i, '').trim();
  }
  return cleaned;
}

/**
 * Generates 3 suggested responses/actions for the User Persona ({{user}})
 * based on the latest role-play turn so the player can pick or tweak a reply in 1 click.
 * Optionally accepts `userDirection` so the player can steer the scene with a rough idea/prompt!
 */
export async function generateSuggestedUserResponses(params: {
  llmService: LLMServiceConfig;
  session: ChatSession;
  activeCharacter: CharacterCardV2;
  persona: UserPersona;
  userDirection?: string;
}): Promise<string[]> {
  const { llmService, session, activeCharacter, persona, userDirection } =
    params;
  const userName = persona.name || 'User';
  const charName = activeCharacter.name;
  const trimmedDirection = replaceMacros(
    (userDirection || '').trim(),
    charName,
    userName
  );
  const recentTranscript = session.messages
    .slice(-4)
    .map(
      (m) =>
        `${m.speakerName}: ${replaceMacros(
          stripHistoricalStatusBlocks(
            stripThinkBlocks(m.swipes[m.activeSwipeIndex] || '')
          ),
          charName,
          userName
        )}`
    )
    .join('\n\n');

  const latestStatus = extractLatestRawStatusBlock(session.messages);

  const npcEnactmentInstruction = `### CRITICAL MANDATE — LIVE NPC SPEECH & REAL-TIME ACTIONS (NEVER SKIP AHEAD):
If the player's direction introduces, mentions, or prompts a secondary character (NPC, e.g. a friend, caller, waiter, coworker, rival, passerby, doctor, parent) or incoming phone call/message/interruption to speak or interact:
1. NEVER skip ahead to the aftermath or only write the result AFTER the NPC has already spoken! (Strict violation: NEVER write "*After Zhao Jie spoke on the phone...*" or "*The waiter finished taking our order...*" or "*I hung up the call...*").
2. ALWAYS depict the NPC speaking LIVE in real-time! Quote the NPC's actual spoken words in dialogue quotes ("...") inside the physical narration block (*...*), followed by ${userName}'s live verbal reaction.
   - Example (Phone Call): *手机突然震动响起，接通后听筒里传来赵杰的声音：“喂！你现在有空吗？晚上要不要出来吃夜宵？”我有些尴尬地看了看身边的${charName}，对着电话说道：* “我现在有点走不开，晚点再联系你。”
   - Example (In-Person NPC): *这时侍应生走到桌旁，微微躬身礼貌询问道：“打扰一下两位，请问现在可以点单了吗？”我转头看向${charName}，微笑着把菜单递过去：* “你想先尝尝什么推荐菜？”
   - Example (Knock / Interruption): *门外突然传来急促的敲门声与男人的喊声：“里面有人吗？开一下门！”我神色一紧，拉住${charName}的手低声安抚：* “别慌，先别出声。”
3. All 3 suggested options (1 = Mild, 2 = Medium, 3 = High) must feature the NPC's actual live spoken dialogue, while varying ${userName}'s response from gentle/cautious -> direct/active -> bold/decisive.`;

  const directionSystemBlock = trimmedDirection
    ? `IMPORTANT — PLAYER'S DESIRED SCENE DIRECTION:
The player wants their reply to follow this idea/direction: "${trimmedDirection}".
All 3 suggested replies MUST carry out "${trimmedDirection}" from ${userName}'s perspective (with *physical actions* and "spoken dialogue"), scaled across 3 clear intensity levels based on the current situation:
1. [MILD — Gentle, subtle, or cautious way of doing "${trimmedDirection}" that keeps a relaxed pace]
2. [MEDIUM — Active, confident, or flirty way of doing "${trimmedDirection}" that noticeably advances the scene]
3. [HIGH — Bold, intense, or boundary-pushing way of doing "${trimmedDirection}" that strongly escalates the intimacy, tension, or drama of the situation]

${npcEnactmentInstruction}`
    : `Structure the 3 replies as a clear 3-tier escalation ladder tailored to the current situation and relationship stage (do NOT include the words "MILD/MEDIUM/HIGH" inside the reply text itself—only output 1., 2., 3.):
1. [MILD — Gentle, subtle, or conversational response that maintains the current pace naturally]
2. [MEDIUM — Active, flirty, or closer-proximity response that advances the interaction forward]
3. [HIGH — Bold, intense, or decisive escalation of intimacy, tension, or action based on the current situation]`;

  const raw = await generateChatCompletion(
    llmService,
    [
      {
        role: 'system',
        content: `You are a role-play assistant helping the player (${userName}) respond to ${activeCharacter.name}.
Write exactly 3 distinct, engaging replies from ${userName}'s perspective (using *asterisks* for physical actions and "quotes" for spoken dialogue) ordered strictly:
1. [Mild intensity]
2. [Medium intensity]
3. [High escalation intensity]
Rules:
- Keep each reply concise and punchy (1-2 sentences).
- Put each numbered reply completely on its own line (do NOT split an option across multiple paragraphs or blank lines).
- If a secondary NPC, caller, or bystander speaks, quote their live words in quotes inside the action asterisks before ${userName}'s reply. NEVER fast-forward to the result after an NPC spoke.
${getLanguageInstruction(session.language)}
${directionSystemBlock}
Output ONLY the 3 numbered lines (1., 2., 3.) and nothing else. Do not output any preamble, explanation, or closing chat.`,
      },
      {
        role: 'user',
        content: `World Setting: ${
          session.worldSetting || activeCharacter.scenario
        }\nActive Character: ${activeCharacter.name} [${formatGenderProfile(
          activeCharacter.gender
        )}]\nPlayer Persona (${userName}) [${formatGenderProfile(
          persona.gender
        )}]: ${
          persona.description
        }${
          latestStatus ? `\nCurrent Status HUD State:\n${latestStatus}` : ''
        }\n\nRecent Scene:\n${recentTranscript}${
          trimmedDirection
            ? `\n\nPlayer's Desired Direction / Prompt for ${userName}'s Reply: "${trimmedDirection}"`
            : ''
        }\n\nOutput the 3 numbered response options (1 = Mild, 2 = Medium, 3 = High) for ${userName} now:`,
      },
    ],
    {
      temperature: 0.75,
      disableThinking: true,
      maxTokensOverride: Math.max(2048, (llmService.maxTokens || 1024) * 2),
    }
  );

  const cleaned = stripThinkBlocks(raw);
  const stripTierPrefix = (text: string) =>
    text
      .replace(
        /^\[?\s*(?:mild|medium|high|轻度|中度|高度|温和|进阶|大胆|强势)\s*\]?\s*[:：\-—]\s*/i,
        ''
      )
      .trim();

  const healSuggestionLine = (text: string): string => {
    let l = stripTierPrefix(text).replace(/\s+/g, ' ').trim();
    if (!l) return '';
    // Auto-close unbalanced asterisks if cut off
    const starCount = (l.match(/\*/g) || []).length;
    if (starCount % 2 !== 0) l += '*';
    // Auto-close unbalanced quotes if cut off with matching closing quote
    const openDouble = (l.match(/["“]/g) || []).length;
    const closeDouble = (l.match(/["”]/g) || []).length;
    if (openDouble > closeDouble) {
      l += l.includes('“') ? '”' : '"';
    }
    const openCorner = (l.match(/「/g) || []).length;
    const closeCorner = (l.match(/」/g) || []).length;
    if (openCorner > closeCorner) {
      l += '」';
    }
    return l;
  };

  // 1. Check if model returned JSON anyway
  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed.suggestions || parsed.responses || parsed.options;
      if (Array.isArray(arr) && arr.length > 0) {
        return arr
          .map((item) => healSuggestionLine(String(item)))
          .filter(Boolean)
          .slice(0, 3);
      }
    }
  } catch {
    // Continue to block parser
  }

  // 2. Multi-line Block Parser: Split by numbered markers (1., 2., 3., Option 1, etc.)
  const rawSections = cleaned.split(
    /(?:^|\n+)\s*(?:(?:Option\s*)?[1-3][\.\)\:、]|【[1-3]】|\[[1-3]\])\s*/i
  );
  if (rawSections.length >= 2) {
    const candidateBlocks: string[] = [];
    for (let i = 1; i < rawSections.length && candidateBlocks.length < 3; i++) {
      const blockText = rawSections[i].trim();
      if (!blockText) continue;
      // Join multiple lines inside this block with spaces so actions and dialogue are unified
      const unified = blockText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ');
      const healed = healSuggestionLine(unified);
      if (healed && healed.length > 5) {
        candidateBlocks.push(healed);
      }
    }
    if (candidateBlocks.length >= 2) {
      return candidateBlocks.slice(0, 3);
    }
  }

  // 3. Fallback: Bullet or line-by-line parser with continuation joining
  const rawLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const groupedItems: string[] = [];
  let currentItem = '';

  for (const line of rawLines) {
    const isNewItem =
      /^([1-3][\.\)\:、]|[-•\*]\s+|Option\s*[1-3][\:\.]?|【?[1-3]】?)\s*/i.test(
        line
      );
    if (isNewItem) {
      if (currentItem.trim().length > 5) {
        groupedItems.push(healSuggestionLine(currentItem));
      }
      currentItem = line.replace(
        /^([1-3][\.\)\:、]|[-•\*]\s+|Option\s*[1-3][\:\.]?|【?[1-3]】?)\s*/i,
        ''
      );
    } else {
      if (currentItem) {
        currentItem += ' ' + line;
      }
    }
  }
  if (currentItem.trim().length > 5) {
    groupedItems.push(healSuggestionLine(currentItem));
  }

  const validGrouped = groupedItems.filter((item) => item.length > 8);
  if (validGrouped.length >= 2) {
    return validGrouped.slice(0, 3);
  }

  if (rawLines.length > 0) {
    return rawLines.slice(0, 3).map((l) => healSuggestionLine(l));
  }

  // 3. Fallback if model output was empty
  return [
    `*${userName} steps closer, studying ${activeCharacter.name} carefully.* "Tell me more about what you just mentioned—I don't think that's the whole story."`,
    `*${userName} glances around the room before meeting ${activeCharacter.name}'s gaze.* "We don't have much time. What's our next move?"`,
    `*A faint smile crosses ${userName}'s face.* "You're testing me, aren't you, ${activeCharacter.name.split(' ')[0]}?"`,
  ];
}

/**
 * Formats a character tag cleanly without underscores (e.g. "college_student" -> "College Student").
 */
export function cleanCharacterTag(rawTag: string): string {
  return String(rawTag || '')
    .replace(/^#+/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Auto-generates a complete V2 Character Card from just a Character Name,
 * Gender, and a brief user-provided Description/Concept.
 */
function normalizeAiStatusHud(params: {
  rawMode: any;
  rawFields: any;
  charName: string;
}): { mode: StatusTrackerMode; template: string } {
  const allowed: StatusTrackerMode[] = [
    'rpg_traveler',
    'romance_affection',
    'intimate_detailed',
    'custom',
  ];
  const candidateMode = String(params.rawMode || '').trim() as StatusTrackerMode;
  const mode: StatusTrackerMode = allowed.includes(candidateMode)
    ? candidateMode
    : 'custom';

  if (Array.isArray(params.rawFields)) {
    const validRows = params.rawFields
      .map((f: any) => ({
        key: String(f?.key || '').replace(/[|\[\]]/g, '').trim(),
        value: String(f?.value || '').replace(/[|\[\]]/g, '').trim(),
      }))
      .filter((r) => r.key && r.value);
    if (validRows.length >= 3) {
      return {
        mode,
        template: `<status_bar>\n${serializeStatusTemplateRows(validRows)}\n</status_bar>`,
      };
    }
  }

  const fallbackMode: StatusTrackerMode =
    mode === 'custom' ? 'romance_affection' : mode;
  const body = getDefaultStatusTemplateForMode({
    mode: fallbackMode,
    charName: params.charName,
    userName: '{{user}}',
  });
  return {
    mode: fallbackMode,
    template: `<status_bar>\n${body}\n</status_bar>`,
  };
}

/**
 * Generates an initial Character Profile + Default Status HUD from a brief concept.
 */
export async function aiGenerateCharacterProfile(params: {
  llmService: LLMServiceConfig;
  name: string;
  gender: CharacterGender;
  briefDescription: string;
}): Promise<{
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  tags: string[];
  visualPrompt: string;
  defaultStatusTrackerMode: StatusTrackerMode;
  defaultCustomStatusTemplate: string;
}> {
  const { llmService, name, gender, briefDescription } = params;
  const genderProfile = formatGenderProfile(gender);
  const baseTag =
    gender === 'female'
      ? '1girl, solo'
      : gender === 'male'
      ? '1boy, solo'
      : '1person, solo';

  const systemPrompt = `/no_think
You are an expert SillyTavern V2 Character Card creator and role-play writer.
Given a character's Name, Gender, and a brief Description/Concept from the user, flesh out and auto-fill ALL required character fields in valid JSON format.

IMPORTANT LANGUAGE RULE:
- Write "description", "personality", "scenario", "first_mes", "mes_example", "system_prompt", "tags", and "status_hud_fields" in the SAME language as the user's input Name/Description (e.g., if the user wrote in Chinese, write those fields in rich, natural Chinese; if English, write in English).
- For "tags", write 4 to 6 short, clean, human-readable tags WITHOUT underscores (use spaces instead of "_", e.g. "College Student", "Model", "Shy", or natural Chinese words like "清纯学姐", "平面模特", "害羞").
- Always write "visualPrompt" in concise English appearance tags (6 to 10 tags max) starting with "${baseTag}" focused ONLY on permanent physical identity traits (hair color/style, eye color, facial features, body build, and signature outfit)—do NOT include static backgrounds, studio poses, or quality boilerplate so chat scene generation remains dynamic.
- Use {{char}} to refer to ${name} and {{user}} to refer to the player where appropriate.
- For "system_prompt", instruct {{char}} to stay strictly in character, write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks ("...") strictly for words actually spoken out loud—never putting unspoken thoughts inside double quotes (do not include "e.g." example snippets).
- For "status_hud_mode", choose one of: "rpg_traveler", "romance_affection", "intimate_detailed", or "custom".
- For "status_hud_fields", provide 7 to 9 concise starting status HUD rows fitting the character's scenario (include Time, Location, Outfit, Condition/Demeanor, Attitude toward {{user}}, Inner Thought, 2-3 numeric 0/100 meters like "20/100", and Stage). Keep numeric meter values strictly between 0 and 100.

Return ONLY a valid JSON object with these exact keys:
{
  "description": "A rich 3-5 sentence biography, physical appearance, attire, background, and relationship toward {{user}}.",
  "personality": "Concise comma-separated personality traits plus 1-2 sentences describing their demeanor, speech style, and how they react based on their gender (${genderProfile}).",
  "scenario": "A vivid 2-3 sentence world setting and immediate starting scenario where {{char}} and {{user}} interact.",
  "first_mes": "An immersive 2-3 paragraph opening greeting written in-character as ${name}. Put physical actions/narration in *asterisks* and spoken dialogue in \\"double quotes\\".",
  "mes_example": "<START>\\n{{user}}: *approaches ${name}*\\n{{char}}: *characteristic physical reaction* \\"Characteristic spoken dialogue showing their unique voice.\\"",
  "system_prompt": "Stay strictly in character as {{char}} (${genderProfile}). Write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks (\\"...\\") strictly for words actually spoken out loud—never put unspoken thoughts inside double quotes. Adapt your reactions naturally to {{user}}.",
  "tags": ["Tag One", "Tag Two", "Tag Three", "Tag Four"],
  "visualPrompt": "${baseTag}, detailed hair color and style, eye color, body build, signature outfit",
  "status_hud_mode": "custom",
  "status_hud_fields": [
    { "key": "Time", "value": "Starting time of day" },
    { "key": "Location", "value": "Exact starting location" },
    { "key": "Outfit", "value": "Starting outfit" },
    { "key": "Attitude toward {{user}}", "value": "Initial impression" },
    { "key": "Inner Thought", "value": "Unspoken opening thought" },
    { "key": "Affection", "value": "20/100" },
    { "key": "Trust", "value": "30/100" },
    { "key": "Stage", "value": "Stage 1 · First Encounter" }
  ]
}`;

  const userPrompt = `Character Name: ${name}
Character Gender: ${genderProfile}
User's Concept / Description: ${briefDescription}

Generate the complete JSON character profile for ${name} now:`;

  const raw = await generateChatCompletion(
    llmService,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      jsonMode: true,
      temperature: 0.75,
      disableThinking: true,
      maxTokensOverride: 1200,
      taskLabel: `Auto-Generate Character "${name}" (${
        llmService.defaultModel || llmService.name
      })`,
    }
  );

  const cleaned = stripThinkBlocks(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.map((t: any) => cleanCharacterTag(String(t))).filter(Boolean)
        : String(parsed.tags || 'original, roleplay')
            .split(',')
            .map((t) => cleanCharacterTag(t))
            .filter(Boolean);

      let visualPrompt = String(
        parsed.visualPrompt ||
          `${baseTag}, detailed portrait of ${name}, ${briefDescription}, cinematic lighting, masterpiece`
      ).trim();
      if (
        gender === 'female' &&
        !visualPrompt.toLowerCase().includes('1girl')
      ) {
        visualPrompt = `1girl, solo, ${visualPrompt}`;
      } else if (
        gender === 'male' &&
        !visualPrompt.toLowerCase().includes('1boy')
      ) {
        visualPrompt = `1boy, solo, ${visualPrompt}`;
      }

      const hud = normalizeAiStatusHud({
        rawMode: parsed.status_hud_mode,
        rawFields: parsed.status_hud_fields,
        charName: name,
      });

      return {
        description: String(parsed.description || briefDescription).trim(),
        personality: String(
          parsed.personality || 'Expressive, observant, dynamic.'
        ).trim(),
        scenario: String(
          parsed.scenario || `{{user}} encounters ${name} in an atmospheric setting.`
        ).trim(),
        first_mes: String(
          parsed.first_mes ||
            `*${name} turns toward {{user}}, eyes lingering for a moment.*\n\n"So you're the one I've been hearing about."`
        ).trim(),
        mes_example: String(
          parsed.mes_example ||
            `<START>\n{{user}}: "Tell me about yourself."\n{{char}}: *${name} offers a subtle smile.* "There is plenty to tell, if you have the patience to listen."`
        ).trim(),
        system_prompt: String(
          parsed.system_prompt ||
            `Stay strictly in character as {{char}} (${genderProfile}). Write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks ("...") strictly for words actually spoken out loud—never put unspoken thoughts inside double quotes.`
        ).trim(),
        tags: tags.length > 0 ? tags : ['original'],
        visualPrompt,
        defaultStatusTrackerMode: hud.mode,
        defaultCustomStatusTemplate: hud.template,
      };
    } catch {
      // Fall through to fallback synthesis if JSON was malformed
    }
  }

  const fallbackHud = normalizeAiStatusHud({
    rawMode: 'romance_affection',
    rawFields: null,
    charName: name,
  });

  return {
    description: briefDescription,
    personality: 'Expressive, observant, memorable.',
    scenario: `{{user}} meets ${name} in a tense and atmospheric encounter.`,
    first_mes: `*${name} notices {{user}} approaching and pauses.*\n\n"I didn't expect to see you here so soon."`,
    mes_example: `<START>\n{{user}}: "What are you doing here?"\n{{char}}: *${name} glances around before answering.* "Looking for answers—just like you."`,
    system_prompt: `Stay strictly in character as {{char}} (${genderProfile}). Write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks ("...") strictly for words actually spoken out loud—never put unspoken thoughts inside double quotes.`,
    tags: ['original'],
    visualPrompt: `${baseTag}, detailed anime portrait, ${briefDescription}, expressive eyes, cinematic lighting, masterpiece`,
    defaultStatusTrackerMode: fallbackHud.mode,
    defaultCustomStatusTemplate: fallbackHud.template,
  };
}

/**
 * AI-generates a tailored Default Status HUD (`mode` + starting `<status_bar>` template)
 * for an existing character based on their biography, personality, and scenario.
 */
export async function aiGenerateCharacterStatusHud(params: {
  llmService: LLMServiceConfig;
  char: CharacterCardV2;
}): Promise<{ mode: StatusTrackerMode; template: string }> {
  const { llmService, char } = params;
  const systemPrompt = `/no_think
You design tailored RPG / Story Status HUD panels for role-play characters.
Given a character's Name, Description, Personality, Scenario, and Opening Greeting, design a fitting initial Status HUD in valid JSON.

RULES:
- Match the language of the character profile (Chinese if profile is Chinese, English if English).
- Choose "status_hud_mode" from: "rpg_traveler", "romance_affection", "intimate_detailed", or "custom".
- Provide 7 to 9 concise fields in "status_hud_fields" as { "key": "...", "value": "..." }.
- Always include starting Time, Location, Outfit, Condition/Demeanor, Attitude toward {{user}}, Inner Thought, 2 to 3 numeric meters formatted as "N/100" (0 to 100), and Stage.
- Keep field values specific to the opening scenario rather than generic placeholders.

Return ONLY valid JSON:
{
  "status_hud_mode": "custom",
  "status_hud_fields": [
    { "key": "Time", "value": "..." },
    { "key": "Location", "value": "..." }
  ]
}`;

  const userPrompt = `Name: ${char.name}
Description: ${char.description}
Personality: ${char.personality}
Scenario: ${char.scenario}
Opening Greeting: ${char.first_mes.slice(0, 600)}

Generate the JSON Status HUD now:`;

  const raw = await generateChatCompletion(
    llmService,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      jsonMode: true,
      temperature: 0.65,
      disableThinking: true,
      maxTokensOverride: 650,
      taskLabel: `Auto-Generate Status HUD for "${char.name}"`,
    }
  );

  const cleaned = stripThinkBlocks(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return normalizeAiStatusHud({
        rawMode: parsed.status_hud_mode,
        rawFields: parsed.status_hud_fields,
        charName: char.name,
      });
    } catch {
      // Fallback below
    }
  }

  return normalizeAiStatusHud({
    rawMode: 'romance_affection',
    rawFields: null,
    charName: char.name,
  });
}

/**
 * Generates or incrementally updates `session.memorySummary`, archives a permanent Episodic Chapter
 * (`StoryMemoryChapter`) for the summarized turn range so early events are never overwritten in 100+ turn stories,
 * and optionally extracts newly discovered NPCs/locations/items into `session.storyLore`.
 */
export async function generateIncrementalStorySummary(params: {
  llmService: LLMServiceConfig;
  session: ChatSession;
  characters?: CharacterCardV2[];
  effectiveLanguage?: ConversationLanguage;
  onlySummarizeOlderThanRecentWindow?: boolean;
}): Promise<{
  summary: string;
  characterEvolution?: string;
  summarizedUpToIndex: number;
  newChapter?: StoryMemoryChapter;
  extractedLore?: LorebookEntry[];
} | null> {
  const {
    llmService,
    session,
    characters = [],
    effectiveLanguage = 'auto',
    onlySummarizeOlderThanRecentWindow = false,
  } = params;

  const keepRecent =
    session.maxRecentMessages === undefined ? 16 : session.maxRecentMessages;
  const endIndex =
    onlySummarizeOlderThanRecentWindow && keepRecent > 0
      ? Math.max(0, session.messages.length - keepRecent)
      : session.messages.length;

  if (endIndex <= 0) return null;

  const prevSummarizedIdx = session.summarizedUpToIndex || 0;
  const hasExistingSummary = Boolean(session.memorySummary?.trim());
  const existingChapters = (session.memoryChapters || []).filter(
    (ch, idx, arr) =>
      !(idx > 0 && ch.turnRange[0] === 1 && ch.turnRange[1] > 40 && arr.length > 2)
  );
  const lastChapter =
    existingChapters.length > 0
      ? existingChapters[existingChapters.length - 1]
      : undefined;

  // If all turns up to endIndex were already summarized and the user clicks "Archive Chapter & Compress Memory Now"
  // manually, re-analyze the last chapter's turn window (or latest keepRecent turns) in-place instead of resetting to 0!
  const isReArchivingLatestSlice =
    hasExistingSummary && prevSummarizedIdx >= endIndex;
  const startIndex =
    prevSummarizedIdx > 0 && prevSummarizedIdx < endIndex
      ? prevSummarizedIdx
      : isReArchivingLatestSlice
      ? lastChapter
        ? Math.max(0, lastChapter.turnRange[0] - 1)
        : Math.max(0, endIndex - Math.max(12, keepRecent))
      : 0;

  const targetMessages = session.messages.slice(startIndex, endIndex);
  if (targetMessages.length === 0) return null;

  // Build a compact transcript (max ~2,600 tokens) with status bars stripped
  const lines: string[] = [];
  let charBudget = 5500;
  for (let i = targetMessages.length - 1; i >= 0; i--) {
    const m = targetMessages[i];
    const raw = m.swipes[m.activeSwipeIndex] || '';
    const cleaned = stripHistoricalStatusBlocks(stripThinkBlocks(raw)).trim();
    if (!cleaned) continue;
    const clipped =
      cleaned.length > 360 ? `${cleaned.slice(0, 360)}...` : cleaned;
    const line = `${m.speakerName}: ${clipped}`;
    if (charBudget - line.length < 0 && lines.length >= 4) break;
    lines.unshift(line);
    charBudget -= line.length;
  }

  if (lines.length === 0) return null;

  // Extract latest live <status_bar> HUD fields (Stage, Attitude, Demeanor, Meters) so characterEvolution sees current state
  let latestHudSummary = '';
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role !== 'assistant') continue;
    const parsedHud = parseMessageStatusBlocks(
      stripThinkBlocks(m.swipes[m.activeSwipeIndex] || '')
    );
    if (parsedHud.hasStatus) {
      const hudParts: string[] = [];
      if (parsedHud.stage) hudParts.push(`Stage: ${parsedHud.stage}`);
      for (const rel of parsedHud.relationshipFields) {
        hudParts.push(`${rel.key}: ${rel.value}`);
      }
      for (const cond of parsedHud.conditionFields) {
        hudParts.push(`${cond.key}: ${cond.value}`);
      }
      for (const meter of parsedHud.statusMeters) {
        hudParts.push(`${meter.key}: ${meter.rawDisplay}`);
      }
      if (hudParts.length > 0) {
        latestHudSummary = hudParts.join(' | ');
        break;
      }
    }
  }

  const baselineCharBlock =
    characters.length > 0
      ? characters
          .map(
            (c) =>
              `${c.name} (Day-1 Baseline Personality: ${
                c.personality || 'N/A'
              } | Bio: ${(c.description || '').slice(0, 220)})`
          )
          .join('\n')
      : '';

  const recentChaptersBlock =
    existingChapters.length > 0
      ? existingChapters
          .slice(-4)
          .map((ch) => `${ch.title}: ${ch.summary.replace(/\n+/g, ' ')}`)
          .join('\n')
      : '';

  const chapterNum = isReArchivingLatestSlice
    ? Math.max(1, existingChapters.length)
    : existingChapters.length + 1;
  const turnStart = startIndex + 1;
  const turnEnd = endIndex;
  const existingLoreNames = (session.storyLore || [])
    .map((e) => e.name)
    .join(', ');

  const mainCharNames =
    characters.map((c) => c.name).join(', ') || 'the main character';
  const blockedProtagonistNames = collectProtagonistNamesForLoreGuard(
    session,
    characters
  );
  const blockedListStr = blockedProtagonistNames.join(', ') || mainCharNames;
  const existingEvolution = (session.characterEvolution || '').trim();
  const langInstr = getLanguageInstruction(effectiveLanguage);
  const systemPrompt = [
    '/no_think',
    'You are the 3-Layer Long-Term Story Memory, Character Evolution & Lore Archivist for an interactive role-play session.',
    'Analyze the story progression and return ONLY a valid JSON object with these exact 4 top-level keys:',
    '1. "rollingSummary": An array of 5 to 8 concise bullet strings merging the Previous Story Summary (if any) with the New Turns, capturing current plot events, active goals, and overall progression.',
    `2. "chapter": A permanent episodic chapter record specifically for Turns ${turnStart}–${turnEnd}: { "title": "Chapter ${chapterNum}: <Short 3-6 word title>", "bullets": ["3 to 4 concrete events, promises, locations, or secrets from Turns ${turnStart}–${turnEnd}"], "keywords": ["4 to 7 trigger keywords: NPC names, locations, items, or key topics from these turns"] }.`,
    `3. "newLore": An array of 0 to 2 durable, permanent newly introduced NPCs, locations, items, or lasting world facts discovered in Turns ${turnStart}–${turnEnd} (avoid duplicating existing lore: ${
      existingLoreNames || 'none'
    }), each formatted as { "name": "Entry Name", "keys": ["specific keyword", "specific alias"], "content": "Concise 1-2 sentence factual description." }. GUARDRAILS: NEVER put protagonist/user names (${blockedListStr}) or generic single words ("schedule", "timeline", "meeting", "outfit", "today", weekday names) into "keys", and NEVER create permanent lore entries for temporary one-day deadlines or daily schedules (leave empty [] if nothing permanent was introduced).`,
    `4. "characterEvolution": REQUIRED NON-EMPTY STRING (3 to 4 sentences). Compare ${mainCharNames}'s Day-1 Baseline Personality against the Rolling Story Synopsis, Recent Chapters, Latest Status HUD, and New Turns. Describe who ${mainCharNames} is NOW—specifically how their confidence, poise, demeanor, clothing comfort, speech style, lowered emotional walls, and bond/relationship with the user have evolved up to Turn ${turnEnd}. NEVER leave "characterEvolution" empty!`,
    langInstr,
    `Required JSON schema:
{
  "rollingSummary": ["- Bullet 1", "- Bullet 2"],
  "chapter": {
    "title": "Chapter ${chapterNum}: ...",
    "bullets": ["- Event 1", "- Event 2"],
    "keywords": ["Keyword1", "Keyword2"]
  },
  "newLore": [],
  "characterEvolution": "3 to 4 sentences describing how ${mainCharNames} has personally evolved from Turn 1 up to Turn ${turnEnd}..."
}`,
  ]
    .filter(Boolean)
    .join('\n');

  const promptSections: string[] = [];
  if (baselineCharBlock) {
    promptSections.push(`Day-1 Baseline Character Profile:\n${baselineCharBlock}`);
  }
  if (existingEvolution) {
    promptSections.push(`Previous Evolved Character State:\n${existingEvolution}`);
  }
  if (hasExistingSummary) {
    promptSections.push(
      `Previous Rolling Story Synopsis:\n${session.memorySummary.trim()}`
    );
  }
  if (recentChaptersBlock) {
    promptSections.push(`Recent Archived Chapters:\n${recentChaptersBlock}`);
  }
  if (latestHudSummary) {
    promptSections.push(`Latest Live Status HUD State:\n${latestHudSummary}`);
  }
  promptSections.push(
    `Turns to Archive & Analyze (Turns ${turnStart}–${turnEnd}):\n${lines.join(
      '\n\n'
    )}`
  );
  promptSections.push(
    'Output the complete JSON object now (ensure "characterEvolution" is a non-empty 3-4 sentence paragraph):'
  );
  const userPrompt = promptSections.join('\n\n');

  const rawResult = await generateChatCompletion(
    llmService,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      jsonMode: true,
      temperature: 0.3,
      disableThinking: true,
      maxTokensOverride: 1400,
      taskLabel: `Archive Chapter ${chapterNum} & Memory (${
        llmService.defaultModel || llmService.name
      })`,
    }
  );

  const cleanedRaw = stripHistoricalStatusBlocks(
    stripThinkBlocks(rawResult)
  ).trim();
  if (!cleanedRaw) return null;

  // Try structured JSON parse first
  const jsonMatch = cleanedRaw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const rollingBullets: string[] = Array.isArray(parsed.rollingSummary)
        ? parsed.rollingSummary.map((b: any) => String(b).trim()).filter(Boolean)
        : typeof parsed.rollingSummary === 'string'
        ? parsed.rollingSummary
            .split('\n')
            .map((b: string) => b.trim())
            .filter(Boolean)
        : [];

      const formattedRolling =
        rollingBullets.length > 0
          ? rollingBullets
              .map((b) => (b.startsWith('-') || b.startsWith('•') ? b : `- ${b}`))
              .join('\n')
          : session.memorySummary;

      const rawChapter = parsed.chapter || {};
      const chBullets: string[] = Array.isArray(rawChapter.bullets)
        ? rawChapter.bullets.map((b: any) => String(b).trim()).filter(Boolean)
        : typeof rawChapter.summary === 'string'
        ? [rawChapter.summary.trim()]
        : rollingBullets.slice(-4);

      const chKeywords: string[] = Array.isArray(rawChapter.keywords)
        ? rawChapter.keywords
            .map((k: any) => String(k).trim())
            .filter((k: string) => k.length >= 2)
        : [];

      const newChapter: StoryMemoryChapter = {
        id: `chap-${Date.now()}-${turnStart}-${turnEnd}`,
        title: String(
          rawChapter.title || `Chapter ${chapterNum} (Turns ${turnStart}–${turnEnd})`
        ).trim(),
        turnRange: [turnStart, turnEnd],
        summary: chBullets
          .map((b) => (b.startsWith('-') || b.startsWith('•') ? b : `- ${b}`))
          .join('\n'),
        keywords: chKeywords.slice(0, 8),
        pinned: false,
        createdAt: new Date().toISOString(),
      };

      const existingSet = new Set(
        (session.storyLore || []).map((e) => e.name.trim().toLowerCase())
      );
      const extractedLore: LorebookEntry[] = Array.isArray(parsed.newLore)
        ? parsed.newLore
            .map((item: any, idx: number) => {
              const name = String(item?.name || '').trim();
              const rawKeys = Array.isArray(item?.keys)
                ? item.keys.map((k: any) => String(k).trim()).filter(Boolean)
                : String(item?.keys || item?.name || '')
                    .split(',')
                    .map((k: string) => k.trim())
                    .filter(Boolean);
              const safeKeys = sanitizeAutoLoreKeys(
                rawKeys,
                name,
                blockedProtagonistNames
              );
              return {
                id: `slore-auto-${Date.now()}-${idx}`,
                name,
                keys: safeKeys,
                content: String(item?.content || '').trim(),
                enabled: true,
                constant: false,
                priority: 15,
              };
            })
            .filter(
              (entry: LorebookEntry) =>
                entry.name.length >= 2 &&
                entry.keys.length > 0 &&
                entry.content.length >= 8 &&
                !existingSet.has(entry.name.toLowerCase())
            )
        : [];

      const rawEvo =
        parsed.characterEvolution ??
        parsed.character_evolution ??
        parsed.evolvedCharacterState ??
        parsed.evolved_state ??
        parsed.characterState;

      let parsedEvoStr = '';
      if (typeof rawEvo === 'string') {
        parsedEvoStr = rawEvo.trim();
      } else if (Array.isArray(rawEvo)) {
        parsedEvoStr = rawEvo
          .map((item: any) => String(item || '').replace(/^[-•]\s*/, '').trim())
          .filter(Boolean)
          .join(' ');
      } else if (rawEvo && typeof rawEvo === 'object') {
        parsedEvoStr = Object.entries(rawEvo)
          .map(([k, v]) => `${k}: ${String(v || '').trim()}`)
          .join(' ');
      }

      const fallbackEvoFromHud =
        !parsedEvoStr && !existingEvolution
          ? [
              latestHudSummary
                ? `Current state (${mainCharNames}): ${latestHudSummary}.`
                : '',
              rollingBullets.length > 0
                ? rollingBullets
                    .slice(-2)
                    .map((b) => b.replace(/^[-•]\s*/, ''))
                    .join(' ')
                : '',
            ]
              .filter(Boolean)
              .join(' ')
              .trim()
          : '';

      const nextEvolution =
        parsedEvoStr || existingEvolution || fallbackEvoFromHud || undefined;

      if (formattedRolling) {
        return {
          summary: formattedRolling,
          characterEvolution: nextEvolution,
          summarizedUpToIndex: endIndex,
          newChapter,
          extractedLore,
        };
      }
    } catch {
      // Fall through to plain-text bullet fallback below
    }
  }

  // Fallback if local model returned plain bullet points instead of JSON
  const fallbackChapter: StoryMemoryChapter = {
    id: `chap-${Date.now()}-${turnStart}-${turnEnd}`,
    title: `Chapter ${chapterNum} (Turns ${turnStart}–${turnEnd})`,
    turnRange: [turnStart, turnEnd],
    summary: cleanedRaw,
    keywords: Array.from(
      new Set(
        targetMessages
          .map((m) => m.speakerName)
          .filter((n) => n && n.length >= 2)
      )
    ),
    pinned: false,
    createdAt: new Date().toISOString(),
  };

  return {
    summary: cleanedRaw,
    summarizedUpToIndex: endIndex,
    newChapter: fallbackChapter,
    extractedLore: [],
  };
}
