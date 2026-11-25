import {
  CharacterCardV2,
  ChatMessage,
  ConversationLanguage,
  StatusTrackerMode,
} from '../types';

export interface ParsedStatusField {
  key: string;
  value: string;
}

export interface ParsedStatusMeter {
  key: string;
  actorPrefix?: string;
  value: number;
  max: number;
  prevValue?: number;
  delta?: number;
  reason?: string;
  rawDisplay: string;
  colorScheme: 'rose' | 'fuchsia' | 'emerald' | 'amber' | 'sky' | 'indigo';
}

export interface ParsedStatusBlock {
  hasStatus: boolean;
  /** Narrative text with <status_bar> and <UpdateVariable> blocks stripped out */
  cleanNarrativeText: string;
  /** Stage / Phase badge on the top-right (e.g. "阶段二·开发觉醒·接受期") */
  stage?: string;
  /** Time, Location, Outfit top bar items */
  metaFields: {
    time?: string;
    location?: string;
    outfit?: string;
  };
  /** Body / Physical / RPG Condition / Inventory rows */
  conditionFields: ParsedStatusField[];
  /** Special italic memory/lingering sensation row (e.g. "身体记忆") */
  memoryField?: ParsedStatusField;
  /** Relationship / Attitude toward specific characters (e.g. "对赵杰", "对凯") */
  relationshipFields: ParsedStatusField[];
  /** Inner thought / psychology quote (e.g. "心理", "内心想法") */
  thoughtField?: ParsedStatusField;
  /** Numeric progress meters (0-100 or X/Y) from <status_bar> */
  statusMeters: ParsedStatusMeter[];
  /** Cumulative variable meters from <UpdateVariable> blocks (Example 2 / Screenshot 1) */
  variableMeters: ParsedStatusMeter[];
  /** Optional <Analysis> text inside <UpdateVariable> */
  variableAnalysis?: string;
}

const METER_KEYWORDS =
  /^(?:.*[度值率量感恨怒]|hp|mp|sp|level|meter|rate|gauge|score|bar|points?|affinity|intimacy|loyalty|purity|mood|energy|stamina|health|mana|sanity|affection|desire|lust|corruption|trust|obedience|arousal|stress|fatigue|hate|hatred|hostility|resentment|disgust|anger|wrath|rage)$/i;

export function isHateOrHostilityMeterKey(key: string): boolean {
  return /(厌恶|仇恨|反感|恨意|敌意|绝交|愤怒|怒气|嫌弃|恶心|死心|hate|hatred|hostility|resentment|disgust|wrath|anger|rage)/i.test(
    key.trim()
  );
}

export function isVitalHpMeterKey(key: string): boolean {
  return /^(生命|生命值|血量|気力|hp|health|hit\s*points?)$/i.test(key.trim());
}

export interface GameOverStatusResult {
  isGameOver: boolean;
  triggerType?: 'hate_max' | 'hp_zero';
  meterName?: string;
  meterValue?: number;
  meterMax?: number;
  meterDisplay?: string;
  stageText?: string;
  speakerName?: string;
  messageId?: string;
}

/**
 * Checks the latest assistant message's Status HUD to see if a Game Over condition has been reached:
 * - Any Hate / Hostility / Resentment meter (`厌恶值`, `仇恨度`, `反感度`, `Hate`, `Hostility`, etc.) reaches >= 100% (e.g. 100/100)
 * - Or any Vital HP meter (`生命值`, `HP`, `Health`) drops to <= 0 (e.g. 0/100)
 */
export function detectGameOverFromMessages(
  messages: ChatMessage[],
  statusTrackerMode?: StatusTrackerMode
): GameOverStatusResult {
  if (statusTrackerMode === 'off' || !messages || messages.length === 0) {
    return { isGameOver: false };
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;
    const raw = msg.swipes?.[msg.activeSwipeIndex] || '';
    if (!raw) continue;

    const parsed = parseMessageStatusBlocks(raw, messages, i);
    if (!parsed.hasStatus) continue;

    const allMeters: ParsedStatusMeter[] = [
      ...parsed.statusMeters,
      ...parsed.variableMeters.filter(
        (vm) =>
          !parsed.statusMeters.some(
            (sm) => sm.key.toLowerCase() === vm.key.toLowerCase()
          )
      ),
    ];

    for (const m of allMeters) {
      const maxVal = m.max || 100;
      if (isHateOrHostilityMeterKey(m.key) && maxVal > 0 && m.value >= maxVal) {
        return {
          isGameOver: true,
          triggerType: 'hate_max',
          meterName: m.key,
          meterValue: m.value,
          meterMax: maxVal,
          meterDisplay: `${m.value}/${maxVal}`,
          stageText: parsed.stage,
          speakerName: msg.speakerName,
          messageId: msg.id,
        };
      }
      if (isVitalHpMeterKey(m.key) && maxVal > 0 && m.value <= 0) {
        return {
          isGameOver: true,
          triggerType: 'hp_zero',
          meterName: m.key,
          meterValue: m.value,
          meterMax: maxVal,
          meterDisplay: `${m.value}/${maxVal}`,
          stageText: parsed.stage,
          speakerName: msg.speakerName,
          messageId: msg.id,
        };
      }
    }

    // Only inspect the most recent assistant message that has a status block
    break;
  }

  return { isGameOver: false };
}

function pickMeterColor(
  key: string
): 'rose' | 'fuchsia' | 'emerald' | 'amber' | 'sky' | 'indigo' {
  const k = key.toLowerCase();
  if (
    isHateOrHostilityMeterKey(k) ||
    k.includes('堕落') ||
    k.includes('欲望') ||
    k.includes('羞耻') ||
    k.includes('敏感') ||
    k.includes('corruption') ||
    k.includes('lust') ||
    k.includes('desire') ||
    k.includes('arousal')
  ) {
    return 'rose';
  }
  if (
    k.includes('好感') ||
    k.includes('心动') ||
    k.includes('爱意') ||
    k.includes('affection') ||
    k.includes('love')
  ) {
    return 'fuchsia';
  }
  if (
    k.includes('生命') ||
    k.includes('健康') ||
    k === 'hp' ||
    k.includes('health')
  ) {
    return 'emerald';
  }
  if (
    k.includes('体力') ||
    k.includes('精力') ||
    k === 'sp' ||
    k.includes('stamina') ||
    k.includes('energy')
  ) {
    return 'amber';
  }
  if (
    k.includes('魔力') ||
    k.includes('法力') ||
    k.includes('理智') ||
    k === 'mp' ||
    k.includes('mana') ||
    k.includes('sanity') ||
    k.includes('信任') ||
    k.includes('trust')
  ) {
    return 'sky';
  }
  return 'indigo';
}

/**
 * Checks if a [Key|Value] pair represents a numeric progress meter (e.g. [堕落度|68] or [HP|85/100 (+5)])
 */
function tryParseStatusMeter(
  key: string,
  rawVal: string
): ParsedStatusMeter | null {
  const trimmedKey = key.trim();
  const trimmedVal = rawVal.trim();

  // Pattern A: "68 / 100 (optional note)" or "68/100"
  const fractionMatch = trimmedVal.match(
    /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*(.*))?$/
  );
  if (fractionMatch) {
    const rawValNum = Number(fractionMatch[1]);
    const max = Number(fractionMatch[2]) || 100;
    const clampedVal = Math.max(0, Math.min(max, rawValNum));
    const note = (fractionMatch[3] || '').replace(/^\(|\)$/g, '').trim();
    return {
      key: trimmedKey,
      value: clampedVal,
      max,
      reason: note || undefined,
      rawDisplay: `${clampedVal} / ${max}${note ? ` (${note})` : ''}`,
      colorScheme: pickMeterColor(trimmedKey),
    };
  }

  // Pattern B: "68%" or pure number "68" or "68 (+5 reason)" when key is a known meter keyword (or number 0..100)
  const numMatch = trimmedVal.match(
    /^(-?\d+(?:\.\d+)?)\s*(%)?(?:\s*\((.*)\)|\s+(.*))?$/
  );
  if (numMatch) {
    const rawValNum = Number(numMatch[1]);
    const hasPercent = Boolean(numMatch[2]);
    const extraNote = (numMatch[3] || numMatch[4] || '').trim();
    const isKnownMeter = METER_KEYWORDS.test(trimmedKey) || hasPercent;

    if (isKnownMeter || (rawValNum >= 0 && rawValNum <= 200)) {
      const max = 100;
      const clampedVal = Math.max(0, Math.min(max, rawValNum));
      return {
        key: trimmedKey,
        value: clampedVal,
        max: 100,
        reason: extraNote || undefined,
        rawDisplay: `${clampedVal} / 100${extraNote ? ` (${extraNote})` : ''}`,
        colorScheme: pickMeterColor(trimmedKey),
      };
    }
  }

  return null;
}

/**
 * Computes cumulative `<UpdateVariable>` state across the conversation up to `upToMessageIndex`
 * so `_.add('姜小白.欲望值', -40);//获得强烈高潮后欲望值大幅下降` displays both current value,
 * previous -> new transition, and the inline comment reason (matching Screenshot 1).
 */
export function computeUpdateVariableMeters(
  messages: ChatMessage[],
  upToMessageIndex: number
): {
  meters: ParsedStatusMeter[];
  latestAnalysis?: string;
  hasUpdateBlockInTarget: boolean;
} {
  const stateMap = new Map<
    string,
    {
      actorPrefix?: string;
      key: string;
      value: number;
      prevValue?: number;
      delta?: number;
      reason?: string;
    }
  >();

  let latestAnalysis: string | undefined;
  let hasUpdateBlockInTarget = false;

  const endIdx =
    upToMessageIndex >= 0 && upToMessageIndex < messages.length
      ? upToMessageIndex
      : messages.length - 1;

  for (let idx = 0; idx <= endIdx; idx++) {
    const msg = messages[idx];
    const raw = msg?.swipes?.[msg.activeSwipeIndex] || '';
    const updateMatches = Array.from(
      raw.matchAll(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi)
    );
    if (updateMatches.length === 0) continue;

    const isTargetTurn = idx === endIdx;
    if (isTargetTurn) {
      hasUpdateBlockInTarget = true;
    }

    for (const m of updateMatches) {
      const block = m[1] || '';
      const analysisMatch = block.match(/<Analysis>([\s\S]*?)<\/Analysis>/i);
      if (isTargetTurn && analysisMatch) {
        latestAnalysis = analysisMatch[1].trim();
      }

      const bodyWithoutAnalysis = block.replace(
        /<Analysis>[\s\S]*?<\/Analysis>/gi,
        ''
      );
      const lines = bodyWithoutAnalysis
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        // Match _.add('角色.属性', -40); // reason  OR  _.set('角色.属性', 88); // reason
        const fnMatch = line.match(
          /_\.(add|set|assign)\(\s*['"`]([^'"`]+)['"`]\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*;?\s*(?:\/\/\s*(.*))?/i
        );
        if (fnMatch) {
          const op = fnMatch[1].toLowerCase();
          const fullPath = fnMatch[2].trim();
          const numArg = Number(fnMatch[3]);
          const comment = (fnMatch[4] || '').trim();

          const dotParts = fullPath.split('.');
          const shortKey = dotParts[dotParts.length - 1] || fullPath;
          const actorPrefix =
            dotParts.length > 1 ? dotParts.slice(0, -1).join('.') : undefined;

          const existing = stateMap.get(fullPath);
          // Default baseline if first operation is _.add:
          // If adding a negative number (like -40 after climax), assume baseline was 100; otherwise 50
          const prevVal = existing
            ? existing.value
            : op === 'add'
            ? numArg < 0
              ? 100
              : 60
            : numArg;

          const nextVal =
            op === 'add'
              ? Math.max(0, Math.min(100, prevVal + numArg))
              : Math.max(0, Math.min(100, numArg));

          stateMap.set(fullPath, {
            actorPrefix,
            key: shortKey,
            value: nextVal,
            prevValue: isTargetTurn ? prevVal : undefined,
            delta: isTargetTurn ? nextVal - prevVal : undefined,
            reason: isTargetTurn ? comment || undefined : existing?.reason,
          });
          continue;
        }

        // Also support simple "属性: 88 (98->100 (原因))" lines inside <UpdateVariable>
        const simpleMeterMatch = line.match(
          /^([^:：=]+)[:：=]\s*(\d+(?:\.\d+)?)\s*(?:\((.*)\))?$/
        );
        if (simpleMeterMatch) {
          const fullPath = simpleMeterMatch[1].trim();
          const val = Math.max(0, Math.min(100, Number(simpleMeterMatch[2])));
          const note = (simpleMeterMatch[3] || '').trim();
          const dotParts = fullPath.split('.');
          const shortKey = dotParts[dotParts.length - 1] || fullPath;
          const actorPrefix =
            dotParts.length > 1 ? dotParts.slice(0, -1).join('.') : undefined;
          const existing = stateMap.get(fullPath);
          stateMap.set(fullPath, {
            actorPrefix,
            key: shortKey,
            value: val,
            prevValue: isTargetTurn ? existing?.value : undefined,
            delta:
              isTargetTurn && existing !== undefined
                ? val - existing.value
                : undefined,
            reason: isTargetTurn ? note || undefined : existing?.reason,
          });
        }
      }
    }
  }

  const meters: ParsedStatusMeter[] = Array.from(stateMap.values()).map(
    (entry) => {
      let extraParen = `${entry.value}`;
      if (
        entry.prevValue !== undefined &&
        entry.prevValue !== entry.value &&
        entry.reason
      ) {
        extraParen = `${entry.prevValue}->${entry.value} (${entry.reason})`;
      } else if (
        entry.prevValue !== undefined &&
        entry.prevValue !== entry.value
      ) {
        extraParen = `${entry.prevValue}->${entry.value}`;
      } else if (entry.reason) {
        extraParen = `${entry.value} (${entry.reason})`;
      }

      return {
        key: entry.key,
        actorPrefix: entry.actorPrefix,
        value: entry.value,
        max: 100,
        prevValue: entry.prevValue,
        delta: entry.delta,
        reason: entry.reason,
        rawDisplay: `(${extraParen})`,
        colorScheme: pickMeterColor(entry.key),
      };
    }
  );

  return { meters, latestAnalysis, hasUpdateBlockInTarget };
}

/**
 * Parses a message's raw text to extract `<status_bar>...</status_bar>` and `<UpdateVariable>...</UpdateVariable>`
 * blocks, returning clean narrative text and structured status card data.
 */
export function parseMessageStatusBlocks(
  rawText: string,
  allMessages?: ChatMessage[],
  messageIndex?: number
): ParsedStatusBlock {
  let workingText = rawText || '';

  const statusBarRegex = /<status(?:_bar)?>([\s\S]*?)<\/status(?:_bar)?>/gi;
  const updateVarRegex = /<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi;

  const statusMatches = Array.from(workingText.matchAll(statusBarRegex));
  workingText = workingText
    .replace(statusBarRegex, '')
    .replace(updateVarRegex, '')
    .trim();

  let stage: string | undefined;
  const metaFields: { time?: string; location?: string; outfit?: string } = {};
  const conditionFields: ParsedStatusField[] = [];
  let memoryField: ParsedStatusField | undefined;
  const relationshipFields: ParsedStatusField[] = [];
  let thoughtField: ParsedStatusField | undefined;
  const statusMeters: ParsedStatusMeter[] = [];

  for (const match of statusMatches) {
    const inner = match[1] || '';
    // Match all [Key|Value] or [Key：Value] pairs
    const bracketMatches = Array.from(
      inner.matchAll(/\[\s*([^\]|｜:：]+?)\s*[|｜:：]\s*([^\]]+?)\s*\]/g)
    );

    const pairs: ParsedStatusField[] =
      bracketMatches.length > 0
        ? bracketMatches.map((bm) => ({
            key: bm[1].trim(),
            value: bm[2].trim(),
          }))
        : inner
            .split(/\r?\n/)
            .map((l) => l.trim().replace(/^\[|\]$/g, ''))
            .filter(Boolean)
            .map((line) => {
              const idx = line.search(/[|｜:：]/);
              if (idx === -1) return null;
              return {
                key: line.slice(0, idx).trim(),
                value: line.slice(idx + 1).trim(),
              };
            })
            .filter((x): x is ParsedStatusField => Boolean(x && x.key));

    for (const { key, value } of pairs) {
      const kLower = key.toLowerCase();

      // 1. Check if it's a Stage / Phase badge
      if (
        /^(阶段|当前阶段|时期|章节|境界|等级|stage|phase|chapter|rank|tier)$/i.test(
          key
        )
      ) {
        stage = value;
        continue;
      }

      // 2. Check if it's a numeric meter
      const parsedMeter = tryParseStatusMeter(key, value);
      if (parsedMeter) {
        statusMeters.push(parsedMeter);
        continue;
      }

      // 3. Check top metadata fields: Time, Location, Outfit
      if (/^(时间|当前时间|日期|time|date)$/i.test(key)) {
        metaFields.time = value;
        continue;
      }
      if (/^(地点|当前地点|位置|场景|location|place|scene)$/i.test(key)) {
        metaFields.location = value;
        continue;
      }
      if (
        /^(服装|穿着|衣着|穿搭|装扮|装备|outfit|attire|clothing|equipment|gear)$/i.test(
          key
        )
      ) {
        metaFields.outfit = value;
        continue;
      }

      // 4. Check Inner Thought / Psychology
      if (
        /^(心理|内心|内心想法|心声|想法|心理活动|情绪|thought|inner thought|psychology|mind)$/i.test(
          key
        )
      ) {
        thoughtField = { key, value };
        continue;
      }

      // 5. Check Body Memory / Lingering Sensation
      if (/^(身体记忆|记忆|余韵|body memory|memory)$/i.test(key)) {
        memoryField = { key, value };
        continue;
      }

      // 6. Check Relationship / Attitude toward someone (e.g. "对赵杰", "对凯", "对...")
      if (
        (key.startsWith('对') && key.length >= 2 && key.length <= 10) ||
        /^(关系|态度|relationship|attitude)/i.test(kLower)
      ) {
        relationshipFields.push({ key, value });
        continue;
      }

      // 7. Everything else goes into Condition / Body / RPG Status rows
      conditionFields.push({ key, value });
    }
  }

  // Compute turn-over-turn delta (+5 / -10) for statusMeters by comparing with the closest prior message that had a <status_bar>
  if (
    statusMeters.length > 0 &&
    allMessages &&
    messageIndex !== undefined &&
    messageIndex > 0
  ) {
    for (let pIdx = messageIndex - 1; pIdx >= 0; pIdx--) {
      const priorRaw =
        allMessages[pIdx]?.swipes?.[allMessages[pIdx].activeSwipeIndex] || '';
      const priorMatch = priorRaw.match(
        /<status(?:_bar)?>([\s\S]*?)<\/status(?:_bar)?>/i
      );
      if (!priorMatch) continue;
      const priorRows = parseStatusTemplateRows(priorMatch[0]);
      const priorMeterMap = new Map<string, number>();
      for (const pr of priorRows) {
        const pm = tryParseStatusMeter(pr.key, pr.value);
        if (pm) {
          priorMeterMap.set(pm.key.toLowerCase(), pm.value);
        }
      }
      if (priorMeterMap.size > 0) {
        for (const m of statusMeters) {
          const prevVal = priorMeterMap.get(m.key.toLowerCase());
          if (prevVal !== undefined) {
            m.prevValue = prevVal;
            m.delta = Number((m.value - prevVal).toFixed(1));
          }
        }
        break;
      }
    }
  }

  // Also check <UpdateVariable> blocks if present
  const varResult =
    allMessages && messageIndex !== undefined
      ? computeUpdateVariableMeters(allMessages, messageIndex)
      : /<UpdateVariable>/i.test(rawText)
      ? computeUpdateVariableMeters(
          [
            {
              id: 'tmp',
              role: 'assistant',
              speakerName: '',
              swipes: [rawText],
              activeSwipeIndex: 0,
              createdAt: '',
            },
          ],
          0
        )
      : { meters: [], hasUpdateBlockInTarget: false };

  const hasStatus =
    statusMatches.length > 0 || varResult.hasUpdateBlockInTarget;

  return {
    hasStatus,
    cleanNarrativeText: workingText,
    stage,
    metaFields,
    conditionFields,
    memoryField,
    relationshipFields,
    thoughtField,
    statusMeters,
    variableMeters: varResult.hasUpdateBlockInTarget ? varResult.meters : [],
    variableAnalysis: varResult.latestAnalysis,
  };
}

/**
 * Parses a raw `<status_bar>` block or `[Key|Value]` template string into editable `{ key, value }` rows.
 */
export function parseStatusTemplateRows(
  rawTemplateOrBlock: string
): ParsedStatusField[] {
  if (!rawTemplateOrBlock) return [];
  const inner = rawTemplateOrBlock
    .replace(/<\/?status(?:_bar)?>/gi, '')
    .trim();

  const bracketMatches = Array.from(
    inner.matchAll(/\[([^\]|｜:：]+?)[|｜:：]([^\]]*?)\]/g)
  );
  if (bracketMatches.length > 0) {
    return bracketMatches.map((bm) => ({
      key: bm[1].replace(/^\r?\n+|\r?\n+$/g, ''),
      value: bm[2].replace(/^\r?\n+|\r?\n+$/g, ''),
    }));
  }

  return inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[|\]$/g, ''))
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const idx = line.search(/[|｜:：]/);
      if (idx === -1) return null;
      return {
        key: line.slice(0, idx),
        value: line.slice(idx + 1),
      };
    })
    .filter((x): x is ParsedStatusField => Boolean(x && x.key.trim()));
}

/**
 * Serializes `{ key, value }[]` rows into `[Key|Value]` lines (without `<status_bar>` wrapper).
 * Preserves trailing spaces during live typing in controlled inputs.
 */
export function serializeStatusTemplateRows(rows: ParsedStatusField[]): string {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => `[${r.key}|${r.value}]`)
    .join('\n');
}

/**
 * Replaces an existing `<status_bar>...</status_bar>` block inside a message swipe
 * (or appends a new one at the end) using the given `{ key, value }[]` rows.
 */
export function replaceMessageStatusBarBlock(
  rawMessageText: string,
  rows: ParsedStatusField[]
): string {
  const bodyLines = serializeStatusTemplateRows(rows);
  if (!bodyLines) return rawMessageText;
  const newBlock = `<status_bar>\n${bodyLines}\n</status_bar>`;
  const statusRegex = /<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/i;
  if (statusRegex.test(rawMessageText)) {
    return rawMessageText.replace(statusRegex, newBlock);
  }
  return `${rawMessageText.trim()}\n\n${newBlock}`;
}

/**
 * Checks whether a status field key or value represents a numeric meter (0-100 or X/Y).
 */
export function isNumericStatusField(key: string, value: string): {
  isNumeric: boolean;
  current: number;
  max: number;
  hasSlashMax: boolean;
  note: string;
} {
  const trimmedKey = key.trim();
  const trimmedVal = value.trim();

  const frac = trimmedVal.match(
    /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*(.*))?$/
  );
  if (frac) {
    const cur = Number(frac[1]);
    const max = Number(frac[2]) || 100;
    const note = (frac[3] || '').replace(/^\(|\)$/g, '').trim();
    return {
      isNumeric: true,
      current: Math.max(0, Math.min(max, cur)),
      max,
      hasSlashMax: true,
      note,
    };
  }

  const num = trimmedVal.match(
    /^(-?\d+(?:\.\d+)?)\s*(%)?(?:\s*\((.*)\)|\s+(.*))?$/
  );
  if (num) {
    const cur = Number(num[1]);
    const note = (num[3] || num[4] || '').trim();
    if (METER_KEYWORDS.test(trimmedKey) || Boolean(num[2]) || (cur >= 0 && cur <= 200)) {
      return {
        isNumeric: true,
        current: Math.max(0, Math.min(100, cur)),
        max: 100,
        hasSlashMax: false,
        note,
      };
    }
  }

  return {
    isNumeric: false,
    current: 0,
    max: 100,
    hasSlashMax: false,
    note: '',
  };
}

/**
 * Returns the default `[Key|StartingValue]` template for any StatusTrackerMode.
 */
export function getDefaultStatusTemplateForMode(params: {
  mode: StatusTrackerMode;
  charName: string;
  userName: string;
  language?: ConversationLanguage;
}): string {
  const { mode, charName, userName, language } = params;
  const isChinese =
    language === 'zh-CN' ||
    language === 'zh-TW' ||
    /[\u4e00-\u9fa5]/.test(charName);

  if (mode === 'rpg_traveler') {
    return isChinese
      ? `[时间|清晨·晴朗]
[地点|初始之地]
[装备|日常便服与随身行囊]
[身体状态|精力充沛，无伤势]
[背包物品|干粮x2、疗伤药水x1、银币x50]
[当前目标|探索周围环境，确认下一步行动]
[对${userName}|初步结识的同伴，保持观察]
[心理|不知道接下来的旅途会遇到什么……]
[生命值|100/100]
[体力值|100/100]
[好感度|20/100]
[阶段|第一章·旅途伊始]`
      : `[Time|Morning · Clear Sky]
[Location|Starting Point]
[Outfit & Gear|Traveler attire and light pack]
[Condition|Healthy and well-rested]
[Inventory|Rations x2, Healing Potion x1, 50 Gold]
[Objective|Explore the area and decide the next move]
[Attitude toward ${userName}|Cautious but cooperative companion]
[Inner Thought|Let's see how reliable ${userName} really is...]
[HP|100/100]
[Stamina|100/100]
[Affection|20/100]
[Stage|Chapter 1 · Beginning of the Journey]`;
  }

  if (mode === 'romance_affection') {
    return isChinese
      ? `[时间|周六下午]
[地点|当前场景]
[服装|日常整洁穿搭]
[神态动作|神色自然，目光偶尔落在${userName}身上]
[对${userName}|抱有初步好感与好奇]
[心理|他接下来会说什么呢？]
[好感度|25/100]
[心动值|15/100]
[信任度|40/100]
[阶段|阶段一·初识试探]`
      : `[Time|Saturday Afternoon]
[Location|Current Scene]
[Outfit|Everyday neat attire]
[Demeanor|Calm posture, occasionally glancing at ${userName}]
[Attitude toward ${userName}|Curious and mildly intrigued]
[Inner Thought|I wonder what ${userName} is thinking right now...]
[Affection|25/100]
[Heartrate / Romance|15/100]
[Trust|40/100]
[Stage|Stage 1 · First Impressions]`;
  }

  if (mode === 'intimate_detailed') {
    return `[时间|晚上八点]
[地点|室内房间]
[服装|得体日常穿着，衣衫完整]
[乳房|衣物遮掩下起伏平稳]
[性器|正常干燥]
[子宫|平静]
[肛门|正常放松]
[身体记忆|尚无亲密接触记忆]
[对${userName}|保持表面礼貌与矜持]
[心理|得保持距离，不能让他看出端倪。]
[好感度|25]
[欲望值|10]
[堕落度|0]
[阶段|阶段一·初识矜持·未开发]`;
  }

  return isChinese
    ? `[时间|当前时间]
[地点|当前地点]
[服装|当前穿着]
[状态|正常平稳]
[对${userName}|初步接触]
[心理|此刻真实想法]
[好感度|20/100]
[阶段|阶段一·初始阶段]`
    : `[Time|Current Time]
[Location|Current Location]
[Outfit|Current Outfit]
[Condition|Normal]
[Attitude toward ${userName}|Neutral / Initial]
[Inner Thought|Current unspoken thought]
[Affection|20/100]
[Stage|Stage 1 · Beginning]`;
}

/**
 * Returns 1-click starting value presets so the user can initialize meters at 0 (Fresh Start),
 * Mid-Game (Warm/Ambiguous), or High (Deep Intimate / Awakened) without the AI guessing!
 */
export function getStatusStartingPresets(params: {
  mode: StatusTrackerMode;
  charName: string;
  userName: string;
  language?: ConversationLanguage;
}): Array<{ id: string; label: string; description: string; template: string }> {
  const { mode, charName, userName, language } = params;
  const isChinese =
    language === 'zh-CN' ||
    language === 'zh-TW' ||
    /[\u4e00-\u9fa5]/.test(charName);

  if (mode === 'intimate_detailed') {
    return [
      {
        id: 'fresh_zero',
        label: '1. Fresh Start (Unlimited · 0 Corruption)',
        description: 'Corruption 0 · Desire 10 · Affection 25 (Unlimited chat)',
        template: isChinese
          ? `[时间|晚上八点]
[地点|室内房间]
[服装|得体日常穿着，衣衫完整]
[乳房|衣物遮掩下起伏平稳]
[性器|正常干燥]
[子宫|平静]
[肛门|正常放松]
[身体记忆|尚无亲密接触记忆]
[对${userName}|保持表面礼貌与矜持]
[心理|得保持距离，不能让他看出端倪。]
[好感度|25]
[欲望值|10]
[堕落度|0]
[阶段|阶段一·初识矜持·未开发]`
          : `[Time|8:00 PM]
[Location|Indoor Room]
[Outfit|Modest everyday attire, fully dressed]
[Chest|Calm breathing under clothing]
[Intimate State|Normal and composed]
[Body Memory|No intimate contact yet]
[Attitude toward ${userName}|Polite and reserved]
[Inner Thought|I should keep a proper distance for now.]
[Affection|25]
[Desire|10]
[Corruption|0]
[Stage|Stage 1 · Guarded & Pure]`,
      },
      {
        id: 'ambiguous_mid',
        label: '2. Tempted & Wavering (35 Corruption)',
        description: 'Corruption 35 · Desire 45 · Affection 60 (Unlimited chat)',
        template: isChinese
          ? `[时间|深夜十点半]
[地点|私密房间]
[服装|略显凌乱的居家服，领口微敞]
[乳房|呼吸微促，布料下隐约可见轮廓]
[性器|微微湿润]
[子宫|平静]
[肛门|放松]
[身体记忆|还残留着上次被触碰时的酥麻感]
[对${userName}|嘴上抗拒但身体开始顺从的人]
[心理|明明不该这样的，为什么推不开他……]
[好感度|60]
[欲望值|45]
[堕落度|35]
[阶段|阶段二·防线松动·半推半就]`
          : `[Time|10:30 PM]
[Location|Private Room]
[Outfit|Slightly disheveled loungewear, collar loosened]
[Chest|Shallow breathing, soft contours visible under fabric]
[Intimate State|Slightly aroused]
[Body Memory|Lingering warmth from previous touch]
[Attitude toward ${userName}|Verbally hesitant but physically yielding]
[Inner Thought|I know I shouldn't allow this, yet I can't push ${userName} away...]
[Affection|60]
[Desire|45]
[Corruption|35]
[Stage|Stage 2 · Wavering Defenses]`,
      },
      {
        id: 'awakened_high',
        label: '3. Awakened & Devoted (68 Corruption)',
        description: 'Corruption 68 · Desire 70 · Affection 82 (Unlimited chat)',
        template: isChinese
          ? `[时间|周六早上六点五十四]
[地点|卧室床边]
[服装|宽松长袖棉质睡裙，领口刚被扯正，内里未穿内衣，纯棉内裤]
[乳房|睡裙布料皱在胸口，乳头还在棉布下立着]
[性器|晨起微润，内裤完好]
[子宫|平静]
[肛门|放松]
[身体记忆|昨晚亲密接触后留下的温热余韵]
[对${userName}|让她食髓知味、既羞耻又迷恋的人]
[心理|只要不被外人发现，再一下也没关系吧……]
[好感度|82]
[欲望值|70]
[堕落度|68]
[阶段|阶段三·开发觉醒·接受期]`
          : `[Time|Saturday 6:54 AM]
[Location|Bedroom]
[Outfit|Loose cotton nightgown, collar newly straightened]
[Chest|Soft fabric clinging against flushed skin]
[Intimate State|Warm and sensitive]
[Body Memory|Deep lingering sensation from last night's intimacy]
[Attitude toward ${userName}|Secretly addicted and deeply craving ${userName}]
[Inner Thought|As long as no one else finds out, a little more won't hurt...]
[Affection|82]
[Desire|70]
[Corruption|68]
[Stage|Stage 3 · Awakened & Craving]`,
      },
    ];
  }

  if (mode === 'rpg_traveler') {
    return [
      {
        id: 'rpg_fresh',
        label: '1. Fresh Adventurer (Full HP / Level 1)',
        description: 'HP 100/100 · Stamina 100/100 · Affection 20/100',
        template: getDefaultStatusTemplateForMode({
          mode: 'rpg_traveler',
          charName,
          userName,
          language,
        }),
      },
      {
        id: 'rpg_battle_worn',
        label: '2. Battle-Worn Survivor (Mid HP / Bonded)',
        description: 'HP 55/100 · Stamina 40/100 · Affection 65/100',
        template: isChinese
          ? `[时间|黄昏·暴雨将至]
[地点|废弃遗迹避雨处]
[装备|有些破损的护甲与随身武器]
[身体状态|轻伤喘息，体力消耗较大]
[背包物品|绷带x1、最后半壶清水、金币x120]
[当前目标|处理伤口并安全度过今晚]
[对${userName}|共同经历生死、值得托付后背的伙伴]
[心理|幸好有${userName}在身边，先撑过今晚再说。]
[生命值|55/100]
[体力值|40/100]
[好感度|65/100]
[阶段|第二章·患难与共]`
          : `[Time|Dusk · Incoming Storm]
[Location|Ruined Shelter]
[Outfit & Gear|Worn armor and weapon at the ready]
[Condition|Lightly wounded, catching breath]
[Inventory|Bandage x1, Half Canteen of Water, 120 Gold]
[Objective|Tend wounds and survive the night]
[Attitude toward ${userName}|Trusted comrade who survived battle together]
[Inner Thought|Thank goodness ${userName} is here with me tonight.]
[HP|55/100]
[Stamina|40/100]
[Affection|65/100]
[Stage|Chapter 2 · Forged in Battle]`,
      },
    ];
  }

  return [
    {
      id: 'rom_fresh',
      label: '1. First Meeting (15 Affection / Polite)',
      description: 'Affection 15 · Romance 5 · Trust 25 (Unlimited chat)',
      template: isChinese
        ? `[时间|下午三点]
[地点|初次相遇地点]
[服装|整洁日常穿搭]
[神态动作|保持礼貌距离，眼神带着打量]
[对${userName}|刚认识的对象，礼貌客气]
[心理|看起来还算顺眼，先聊聊看吧。]
[好感度|15/100]
[心动值|5/100]
[信任度|25/100]
[阶段|阶段一·初识客套]`
        : `[Time|3:00 PM]
[Location|Meeting Spot]
[Outfit|Neat everyday attire]
[Demeanor|Polite distance, observant gaze]
[Attitude toward ${userName}|New acquaintance, polite and guarded]
[Inner Thought|Seems nice enough so far—let's see how this conversation goes.]
[Affection|15/100]
[Heartrate / Romance|5/100]
[Trust|25/100]
[Stage|Stage 1 · Polite Acquaintance]`,
    },
    {
      id: 'rom_crush',
      label: '2. Growing Crush (60 Affection / Flirty)',
      description: 'Affection 60 · Romance 55 · Trust 70 (Unlimited chat)',
      template: isChinese
        ? `[时间|周五傍晚]
[地点|两人独处空间]
[服装|精心打扮过的约会穿搭]
[神态动作|脸颊微红，眼神闪烁不敢久视]
[对${userName}|越来越在意、靠近就会心跳加速的人]
[心理|他靠得这么近，不会听见我的心跳声吧……]
[好感度|60/100]
[心动值|55/100]
[信任度|70/100]
[阶段|阶段二·暧昧升温]`
        : `[Time|Friday Evening]
[Location|Private Space Together]
[Outfit|Carefully chosen date outfit]
[Demeanor|Warm blush on cheeks, glancing away shyly]
[Attitude toward ${userName}|Someone who makes ${charName}'s heart race whenever close]
[Inner Thought|${userName} is standing so close... can they hear my heartbeat?]
[Affection|60/100]
[Heartrate / Romance|55/100]
[Trust|70/100]
[Stage|Stage 2 · Growing Crush]`,
    },
    {
      id: 'rom_lovers',
      label: '3. Deeply in Love (90 Affection / Devoted)',
      description: 'Affection 90 · Romance 85 · Trust 95 (Unlimited chat)',
      template: isChinese
        ? `[时间|深夜十一点]
[地点|温馨卧室]
[服装|宽松舒适的居家睡衣]
[神态动作|自然地依偎在${userName}身旁，眼神温柔]
[对${userName}|全心依赖与深爱的伴侣]
[心理|只要能像这样待在他身边就很安心。]
[好感度|90/100]
[心动值|85/100]
[信任度|95/100]
[阶段|阶段三·深情热恋]`
        : `[Time|11:00 PM]
[Location|Cozy Bedroom]
[Outfit|Soft comfortable sleepwear]
[Demeanor|Leaning naturally against ${userName} with a tender gaze]
[Attitude toward ${userName}|Deeply loved and trusted partner]
[Inner Thought|Just being right here beside ${userName} makes me feel completely safe.]
[Affection|90/100]
[Heartrate / Romance|85/100]
[Trust|95/100]
[Stage|Stage 3 · Deeply in Love]`,
    },
  ];
}

/**
 * Extracts the latest `<status_bar>` or `<UpdateVariable>` block from recent chat messages
 * so the LLM can maintain continuity of meters (HP, Affection, Corruption, Time, Outfit) turn by turn.
 */
export function extractLatestRawStatusBlock(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const raw = messages[i]?.swipes?.[messages[i].activeSwipeIndex] || '';
    const statusMatch = raw.match(
      /<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/i
    );
    if (statusMatch) return statusMatch[0];
    const updateMatch = raw.match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/i);
    if (updateMatch) return updateMatch[0];
  }
  return '';
}

/**
 * Builds the system prompt instruction for the active Status Tracker mode.
 * Respects user-configured `customTemplate` (starting values & custom fields) in ALL modes!
 * CRITICAL FIX FOR LOCAL LLMs: When `previousStatusBlock` exists (Turn 2+), we merge any newly added
 * custom keys into `previousStatusBlock` and show ONLY the single Current Live State block (never the
 * Turn-1 starting baseline at the bottom, which caused local LLMs to reset Location & Meters back to Turn 1!).
 */
export function buildStatusTrackerSystemInstruction(params: {
  mode: StatusTrackerMode;
  customTemplate?: string;
  charName: string;
  userName: string;
  language?: ConversationLanguage;
  previousStatusBlock?: string;
}): string {
  const {
    mode,
    customTemplate,
    charName,
    userName,
    language,
    previousStatusBlock,
  } = params;

  if (!mode || mode === 'off') return '';

  // In 'auto' mode, only inject continuity instructions if an earlier message (like first_mes) already uses <status_bar> or <UpdateVariable>
  if (mode === 'auto') {
    if (!previousStatusBlock) return '';
    return `### Status Panel Continuity (<status_bar> / <UpdateVariable>)
At the VERY END of ${charName}'s reply, output the updated status block using the exact same format and tags as the previous turn.
CRITICAL CONTINUITY RULES:
1. LOCATION ([地点] / [Location]): Start from the previous turn's location below. If ${userName} and ${charName} walk/move to a new place in this turn, update [地点] to that new place. NEVER reset [地点] back to the opening scene location unless they physically walked back there!
2. OUTFIT & BODY STATE: Keep clothing and physical state consistent with the previous turn, updating only what changed in this turn.
3. NUMERIC METERS (X/Max): Preserve each meter's exact custom denominator/maximum "/Max" from CURRENT LIVE STATE below (whether /100, /10, /5, etc. — NEVER convert a /5 or /10 meter into /100!). Evolve numbers gradually within 0 and that meter's Max (±1 for small scales like /5 or /10; ±1 to ±5 for /100). NEVER exceed a meter's Max and never drop below 0!

CURRENT LIVE STATE (GROUND TRUTH FROM PREVIOUS TURN):
${previousStatusBlock}`;
  }

  // Use user-configured starting values/template if present; otherwise use the mode's default template
  const rawBaseline =
    (customTemplate || '').trim() ||
    getDefaultStatusTemplateForMode({ mode, charName, userName, language });
  const wrappedBaseline = rawBaseline.includes('<status_bar>')
    ? rawBaseline
    : `<status_bar>\n${rawBaseline}\n</status_bar>`;

  if (previousStatusBlock) {
    // Merge any newly added custom fields from wrappedBaseline into previousStatusBlock
    // while strictly preserving every live value (Time, Location, Outfit, Meters) from previousStatusBlock!
    const prevRows = parseStatusTemplateRows(previousStatusBlock);
    const baseRows = parseStatusTemplateRows(wrappedBaseline);
    let mergedBlock = previousStatusBlock;
    let hasHateMeter = prevRows.some((r) => isHateOrHostilityMeterKey(r.key));
    if (prevRows.length > 0) {
      const mergedRows = [...prevRows];
      for (const br of baseRows) {
        const normKey = br.key.trim().toLowerCase();
        if (
          normKey &&
          !mergedRows.some((pr) => pr.key.trim().toLowerCase() === normKey)
        ) {
          mergedRows.push({ key: br.key.trim(), value: br.value.trim() });
        }
      }
      hasHateMeter = mergedRows.some((r) => isHateOrHostilityMeterKey(r.key));
      mergedBlock = `<status_bar>\n${mergedRows
        .map((r) => `[${r.key.trim()}|${r.value.trim()}]`)
        .join('\n')}\n</status_bar>`;
    }

    const hateRuleLines = hasHateMeter
      ? `\n   - HATE / HOSTILITY METER (\`[厌恶值]\` / \`[仇恨度]\` / \`[Hate]\`): Increase this meter whenever ${userName} insults, betrays, attacks, forces, or violates ${charName}'s boundaries against ${charName}'s current willingness. Sincere apologies or kind actions can gradually lower it.\n   - GAME OVER / BAD ENDING AT MAX HATE: If \`[厌恶值]\` / \`[Hate]\` reaches its maximum (\`Max/Max\`, e.g. \`100/100\` or \`5/5\`), you MUST write a decisive **BAD ENDING / GAME OVER** finale in this reply where ${charName} permanently cuts off all ties, leaves forever, or ends the encounter (and set \`[阶段|结局·彻底决裂 (Game Over)]\` or \`[Stage|Bad Ending · Game Over]\`).`
      : '';

    return `### Mandatory End-of-Turn Status HUD (<status_bar>)
At the VERY END of every reply (after all story narration and dialogue), you MUST append an updated \`<status_bar>...</status_bar>\` block.

CURRENT LIVE STATE (GROUND TRUTH FROM PREVIOUS TURN — DO NOT RESET TO TURN 1):
${mergedBlock}

STRICT CONTINUITY & TRACKING RULES:
1. LOCATION ([地点] / [Location]) & TIME ([时间] / [Time]):
   - Take the Location and Time from CURRENT LIVE STATE above as your starting point for this turn.
   - If ${userName} and ${charName} move to a new place in the latest turn (e.g., walking from the cafeteria to the library, hallway, dorm, or bedroom), you MUST update \`[地点|...]\` to the new location and keep that new location in subsequent turns!
   - NEVER revert \`[地点|...]\` back to an earlier or Turn-1 location unless the characters explicitly travel back there in the story!
2. OUTFIT & PHYSICAL CONDITION:
   - Carry forward the current clothing and physical state from CURRENT LIVE STATE above, updating only what changes during this turn.
3. NUMERIC METERS (X/Max — Custom Scales Supported):
   - Preserve each meter's exact denominator/maximum \`/Max\` from CURRENT LIVE STATE above (e.g., if a meter is \`3/5\` or \`2/10\`, keep it out of \`/5\` or \`/10\`—NEVER rewrite its denominator to \`/100\`!).
   - Adjust numeric meters GRADUALLY from their exact numbers in CURRENT LIVE STATE above (for \`/5\` or \`/10\` meters, adjust by \`0\` or \`±1\` only when earned; for \`/100\` meters, adjust by \`±1\` to \`±5\` for normal turns or \`±8\` to \`±15\` for major breakthroughs). NEVER reset meters to baseline!${hateRuleLines}
   - STRICT LIMIT (0 to Max): Each meter must NEVER exceed its own \`Max\` and must NEVER drop below \`0\`! (e.g. a \`5/5\` meter caps strictly at \`5/5\`; a \`100/100\` meter caps strictly at \`100/100\`).`;
  }

  const baseHasHateMeter = parseStatusTemplateRows(wrappedBaseline).some((r) =>
    isHateOrHostilityMeterKey(r.key)
  );
  const turn1HateNote = baseHasHateMeter
    ? `\n- If ${userName} insults, forces, or angers ${charName}, increase \`[厌恶值]\` / \`[Hate]\`; if \`[厌恶值]\` / \`[Hate]\` ever reaches its maximum (\`Max/Max\`), write a permanent Bad Ending / Game Over scene.`
    : '';

  return `### Mandatory End-of-Turn Status HUD (<status_bar>)
At the VERY END of every reply (after all story narration and dialogue), you MUST append a \`<status_bar>...</status_bar>\` block.${turn1HateNote}

INITIAL STARTING BASELINE (TURN 1):
No previous status block exists yet. Initialize your \`<status_bar>\` using the exact fields, custom meter denominators (\`/Max\`), and starting meter numbers below (updating Location, Time, and Outfit to match the current scene):
${wrappedBaseline}`;
}

/**
 * Builds a high-attention 1-paragraph recency anchor placed at the very end of the final User message
 * so local LLMs (7B-38B in Ollama / LM Studio) never forget the previous turn's Location, Time, Outfit, or Meter numbers.
 */
export function buildCompactStatusRecencyAnchor(
  previousStatusBlock: string,
  charName: string,
  userName: string
): string {
  if (!previousStatusBlock) return '';
  const rows = parseStatusTemplateRows(previousStatusBlock);
  if (rows.length === 0) return '';

  const compactPairs = rows
    .map((r) => `[${r.key.trim()}|${r.value.trim()}]`)
    .join(' ');

  return `Previous Turn Live Status of ${charName}: ${compactPairs}. When writing the updated <status_bar>...</status_bar> at the end of ${charName}'s reply, evolve directly from these values: if ${userName} and ${charName} moved to a new location in this turn, update [地点]/[Location] to the new place; if they stayed in the same place, keep the previous turn's [地点]/[Location] (NEVER revert to the Turn-1 starting location!).`;
}

/**
 * Post-generation continuity healer: if a local LLM outputs a generic placeholder location
 * (like "当前地点" / "当前场景") or accidentally reverts `[地点]` back to the Turn-0 character card
 * location when the previous turn was already at a different location and the new narrative doesn't
 * mention the Turn-0 location, automatically preserve the live location!
 */
export function healGeneratedStatusContinuity(
  generatedReply: string,
  priorMessages: ChatMessage[]
): string {
  if (!generatedReply || !/<status(?:_bar)?>/i.test(generatedReply)) {
    return generatedReply;
  }
  const prevBlock = extractLatestRawStatusBlock(priorMessages);
  if (!prevBlock) return generatedReply;

  const prevRows = parseStatusTemplateRows(prevBlock);
  if (prevRows.length === 0) return generatedReply;

  const findLocRow = (rows: ParsedStatusField[]) =>
    rows.find((r) => /^(地点|位置|当前地点|场景|location|place)$/i.test(r.key.trim()));

  const prevLoc = findLocRow(prevRows)?.value.trim();
  if (
    !prevLoc ||
    /^(当前地点|当前场景|初始之地|current location|current scene)$/i.test(prevLoc)
  ) {
    return generatedReply;
  }

  // Also check what the very first message's location was (Turn 0)
  const firstMsgBlock =
    priorMessages.length > 1
      ? extractLatestRawStatusBlock(priorMessages.slice(0, 1))
      : '';
  const firstLoc = firstMsgBlock
    ? findLocRow(parseStatusTemplateRows(firstMsgBlock))?.value.trim()
    : undefined;

  const statusMatch = generatedReply.match(
    /<status(?:_bar)?>([\s\S]*?)<\/status(?:_bar)?>/i
  );
  if (!statusMatch) return generatedReply;

  const genRows = parseStatusTemplateRows(statusMatch[0]);
  if (genRows.length === 0) return generatedReply;

  let hasChanged = false;

  // 1. Enforce strict meter boundary limits & preserve custom meter denominators (e.g. /5, /10, /100) from prevRows
  for (const row of genRows) {
    const numInfo = isNumericStatusField(row.key, row.value);
    if (numInfo.isNumeric) {
      const prevMatchRow = prevRows.find(
        (pr) => pr.key.trim().toLowerCase() === row.key.trim().toLowerCase()
      );
      const prevNumInfo = prevMatchRow
        ? isNumericStatusField(prevMatchRow.key, prevMatchRow.value)
        : null;
      // If previous turn defined a custom slash denominator (e.g. 3/5) and LLM accidentally reverted denominator to /100 or dropped it, preserve previous max
      const effectiveMax =
        prevNumInfo?.isNumeric &&
        prevNumInfo.hasSlashMax &&
        prevNumInfo.max !== 100 &&
        numInfo.max === 100
          ? prevNumInfo.max
          : numInfo.max || 100;
      const useSlash =
        numInfo.hasSlashMax || Boolean(prevNumInfo?.hasSlashMax);
      const rawNumMatch = row.value.match(/^(-?\d+(?:\.\d+)?)/);
      if (rawNumMatch) {
        const rawNum = Number(rawNumMatch[1]);
        const clamped = Math.max(0, Math.min(effectiveMax, rawNum));
        const noteStr = numInfo.note ? ` (${numInfo.note})` : '';
        const desiredVal = useSlash
          ? `${clamped}/${effectiveMax}${noteStr}`
          : `${clamped}${noteStr}`;
        if (row.value !== desiredVal) {
          row.value = desiredVal;
          hasChanged = true;
        }
      }
    }
  }

  // 2. Heal location continuity if location field is present
  const genLocRow = findLocRow(genRows);
  if (genLocRow && prevLoc && !/^(当前地点|当前场景|初始之地|current location|current scene)$/i.test(prevLoc)) {
    const genLocVal = genLocRow.value.trim();
    const cleanNarrative = generatedReply
      .replace(/<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/gi, '')
      .trim();

    const isPlaceholderLoc =
      /^(当前地点|当前场景|室内房间|初始之地|current location|current scene|indoor room)$/i.test(
        genLocVal
      );
    const revertedToFirstLocWithoutMention =
      Boolean(firstLoc) &&
      firstLoc !== prevLoc &&
      genLocVal === firstLoc &&
      !cleanNarrative.includes(firstLoc!);

    if (isPlaceholderLoc || revertedToFirstLocWithoutMention) {
      genLocRow.value = prevLoc;
      hasChanged = true;
    }
  }

  if (hasChanged) {
    return replaceMessageStatusBarBlock(generatedReply, genRows);
  }

  return generatedReply;
}

/**
 * Resolves a character's default Status HUD settings for a new 1-on-1 chat,
 * expanding `{{char}}` / `{{user}}` macros and preparing a Turn-1 `<status_bar>` block.
 */
export function resolveCharacterInitialStatusConfig(params: {
  char: CharacterCardV2;
  userName: string;
  language?: ConversationLanguage;
}): {
  statusTrackerMode: StatusTrackerMode;
  customStatusTemplate?: string;
  initialStatusBarBlock?: string;
} {
  const { char, userName, language } = params;
  const mode: StatusTrackerMode = char.defaultStatusTrackerMode || 'auto';
  if (mode === 'auto' || mode === 'off') {
    return { statusTrackerMode: mode };
  }

  const expandMacros = (text: string) =>
    text
      .replace(/\{\{char\}\}/gi, char.name)
      .replace(/\{\{user\}\}/gi, userName);

  const rawCustom = (char.defaultCustomStatusTemplate || '').trim();
  const body = rawCustom
    ? expandMacros(rawCustom.replace(/<\/?status(?:_bar)?>/gi, '').trim())
    : getDefaultStatusTemplateForMode({
        mode,
        charName: char.name,
        userName,
        language,
      });

  if (!body) {
    return { statusTrackerMode: mode };
  }

  const wrapped = `<status_bar>\n${body}\n</status_bar>`;
  return {
    statusTrackerMode: mode,
    customStatusTemplate: wrapped,
    initialStatusBarBlock: wrapped,
  };
}

/**
 * Appends an initial `<status_bar>` block to an opening greeting when none exists yet.
 */
export function appendStatusBarToGreeting(
  greetingText: string,
  statusBarBlock?: string
): string {
  const trimmedGreeting = greetingText.trim();
  if (!statusBarBlock) return greetingText;
  if (/<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/i.test(trimmedGreeting)) {
    return greetingText;
  }
  return trimmedGreeting
    ? `${trimmedGreeting}\n\n${statusBarBlock}`
    : statusBarBlock;
}
