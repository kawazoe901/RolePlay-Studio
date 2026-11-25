import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'roleplay-db.json');
const MAX_ROLLING_BACKUPS = 12;
const BACKUP_MIN_INTERVAL_MS = 30 * 60 * 1000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function listRollingBackups(): Array<{ name: string; sizeBytes: number; mtimeMs: number }> {
  ensureDataDir();
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('roleplay-db-') && f.endsWith('.json'))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUPS_DIR, name));
      return { name, sizeBytes: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function createRollingBackup(force = false): string | null {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) return null;
  const dbStat = fs.statSync(DB_FILE);
  if (dbStat.size < 64) return null;

  const existing = listRollingBackups();
  if (!force && existing.length > 0 && Date.now() - existing[0].mtimeMs < BACKUP_MIN_INTERVAL_MS) {
    return null;
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const backupName = `roleplay-db-${stamp}.json`;
  fs.copyFileSync(DB_FILE, path.join(BACKUPS_DIR, backupName));

  const updated = listRollingBackups();
  for (const old of updated.slice(MAX_ROLLING_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(BACKUPS_DIR, old.name));
    } catch {
      // ignore cleanup error
    }
  }
  return backupName;
}

function writeDbAtomically(rawJsonText: string, forceBackup = false): void {
  ensureDataDir();
  // Validate JSON before overwriting the live database
  JSON.parse(rawJsonText);
  createRollingBackup(forceBackup);
  const tmpFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, rawJsonText, 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

function transcodeWavToMp3(inputWavPath: string, outputMp3Path: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', inputWavPath, '-codec:a', 'libmp3lame', '-q:a', '4', outputMp3Path],
      { timeout: 60_000 },
      (err) => {
        if (err) {
          resolve(false);
          return;
        }
        try {
          const st = fs.statSync(outputMp3Path);
          resolve(st.size > 0);
        } catch {
          resolve(false);
        }
      }
    );
  });
}

function collectReferencedMedia(dbText: string): { audio: Set<string>; images: Set<string> } {
  const audio = new Set<string>();
  const images = new Set<string>();
  const audioMatches = dbText.match(/\/api\/audio\/([^"'\\\s?]+)/g) || [];
  for (const m of audioMatches) {
    audio.add(decodeURIComponent(m.replace('/api/audio/', '')));
  }
  const imageMatches = dbText.match(/\/api\/images\/([^"'\\\s?]+)/g) || [];
  for (const m of imageMatches) {
    images.add(decodeURIComponent(m.replace('/api/images/', '')));
  }
  return { audio, images };
}

const EDGE_TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_SEC_MS_GEC_VERSION = '1-131.0.2903.86';
let edgeClockOffsetMs = 0;

function generateEdgeSecMsGec(nowMs = Date.now() + edgeClockOffsetMs): string {
  const WIN_EPOCH = 11644473600;
  let ticks = Math.floor(nowMs / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  const strToHash = `${ticks}0000000${EDGE_TRUSTED_CLIENT_TOKEN}`;
  return crypto
    .createHash('sha256')
    .update(strToHash, 'ascii')
    .digest('hex')
    .toUpperCase();
}

function encodeWsMaskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf-8');
  const maskKey = crypto.randomBytes(4);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81; // FIN + text frame
    header[1] = 0x80 | len;
    maskKey.copy(header, 2);
  } else if (len < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    maskKey.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    maskKey.copy(header, 10);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    masked[i] = payload[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, masked]);
}

function escapeSsmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function synthesizeEdgeTtsChunkOnce(params: {
  text: string;
  voice: string;
  rate: string;
  pitch: string;
  volume?: string;
}): Promise<{ mp3Buffer: Buffer; serverDateHeader?: string }> {
  return new Promise((resolve, reject) => {
    const host = 'speech.platform.bing.com';
    const connectionId = crypto.randomUUID().replace(/-/g, '');
    const secMsGec = generateEdgeSecMsGec();
    const wsKey = crypto.randomBytes(16).toString('base64');
    const wsPath =
      `/consumer/speech/synthesize/readaloud/edge/v1` +
      `?TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec}` +
      `&Sec-MS-GEC-Version=${EDGE_SEC_MS_GEC_VERSION}` +
      `&ConnectionId=${connectionId}`;

    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
      },
      () => {
        const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
        const handshake = [
          `GET ${wsPath} HTTP/1.1`,
          `Host: ${host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${wsKey}`,
          'Sec-WebSocket-Version: 13',
          'Pragma: no-cache',
          'Cache-Control: no-cache',
          'Accept-Encoding: gzip, deflate, br, zstd',
          'Accept-Language: en-US,en;q=0.9',
          `Cookie: muid=${muid};`,
          'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
          '',
          '',
        ].join('\r\n');
        socket.write(handshake);
      }
    );

    let upgraded = false;
    let streamBuf: Buffer = Buffer.alloc(0);
    const audioChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('Edge TTS request timed out'));
      }
    }, 20000);

    const finishOk = (mp3Buffer: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve({ mp3Buffer });
    };

    const finishErr = (err: Error, serverDateHeader?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const enhanced: any = err;
      enhanced.serverDateHeader = serverDateHeader;
      reject(enhanced);
    };

    socket.on('data', (chunk: Buffer) => {
      streamBuf = Buffer.concat([streamBuf, chunk]);

      if (!upgraded) {
        const headerEnd = streamBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerText = streamBuf.subarray(0, headerEnd).toString('utf-8');
        streamBuf = streamBuf.subarray(headerEnd + 4);
        const statusLine = headerText.split('\r\n')[0] || '';
        const dateMatch = headerText.match(/^Date:\s*(.+)$/im);
        const serverDate = dateMatch ? dateMatch[1].trim() : undefined;

        if (!statusLine.includes('101')) {
          finishErr(
            new Error(`Edge TTS handshake failed (${statusLine})`),
            serverDate
          );
          return;
        }

        upgraded = true;
        const timestamp = new Date(Date.now() + edgeClockOffsetMs).toISOString();
        const configMsg =
          `X-Timestamp:${timestamp}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: 'false',
                    wordBoundaryEnabled: 'false',
                  },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          });

        const langMatch = params.voice.match(/^([a-z]{2}-[A-Z]{2})/i);
        const xmlLang = langMatch ? langMatch[1] : 'en-US';
        const reqId = crypto.randomUUID().replace(/-/g, '');
        const ssml =
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${xmlLang}'>` +
          `<voice name='${params.voice}'>` +
          `<prosody pitch='${params.pitch}' rate='${params.rate}' volume='${params.volume || '+0%'}'>` +
          `${escapeSsmlText(params.text)}` +
          `</prosody></voice></speak>`;

        const ssmlMsg =
          `X-RequestId:${reqId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${timestamp}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml;

        socket.write(encodeWsMaskedTextFrame(configMsg));
        socket.write(encodeWsMaskedTextFrame(ssmlMsg));
      }

      // Parse incoming WebSocket frames
      while (streamBuf.length >= 2) {
        const byte0 = streamBuf[0];
        const byte1 = streamBuf[1];
        const opcode = byte0 & 0x0f;
        const isMasked = (byte1 & 0x80) !== 0;
        let payloadLen = byte1 & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (streamBuf.length < 4) return;
          payloadLen = streamBuf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (streamBuf.length < 10) return;
          payloadLen = Number(streamBuf.readBigUInt64BE(2));
          offset = 10;
        }

        if (isMasked) offset += 4;
        if (streamBuf.length < offset + payloadLen) return;

        const framePayload = streamBuf.subarray(offset, offset + payloadLen);
        streamBuf = streamBuf.subarray(offset + payloadLen);

        if (opcode === 0x02) {
          // Binary frame: 2-byte big-endian header length + header + audio payload
          if (framePayload.length >= 2) {
            const hdrLen = framePayload.readUInt16BE(0);
            if (framePayload.length >= 2 + hdrLen) {
              const hdrText = framePayload
                .subarray(2, 2 + hdrLen)
                .toString('utf-8');
              if (hdrText.includes('Path:audio')) {
                const audioData = framePayload.subarray(2 + hdrLen);
                if (audioData.length > 0) {
                  audioChunks.push(Buffer.from(audioData));
                }
              }
            }
          }
        } else if (opcode === 0x01) {
          // Text frame
          const txt = framePayload.toString('utf-8');
          if (txt.includes('Path:turn.end')) {
            finishOk(Buffer.concat(audioChunks));
            return;
          }
        } else if (opcode === 0x08) {
          // Close frame
          if (audioChunks.length > 0) {
            finishOk(Buffer.concat(audioChunks));
          } else {
            finishErr(new Error('Edge TTS closed connection before sending audio'));
          }
          return;
        }
      }
    });

    socket.on('error', (err) => finishErr(err));
    socket.on('close', () => {
      if (!settled) {
        if (audioChunks.length > 0) {
          finishOk(Buffer.concat(audioChunks));
        } else {
          finishErr(new Error('Edge TTS socket closed unexpectedly'));
        }
      }
    });
  });
}

async function synthesizeEdgeTtsMp3(params: {
  text: string;
  voice: string;
  rate: string;
  pitch: string;
}): Promise<Buffer> {
  try {
    const { mp3Buffer } = await synthesizeEdgeTtsChunkOnce(params);
    return mp3Buffer;
  } catch (err: any) {
    // If local system clock is skewed (e.g. sandbox/custom PC date), sync offset from HTTP Date header and retry once
    if (err?.serverDateHeader) {
      const serverMs = Date.parse(err.serverDateHeader);
      if (!Number.isNaN(serverMs)) {
        edgeClockOffsetMs = serverMs - Date.now();
        const { mp3Buffer } = await synthesizeEdgeTtsChunkOnce(params);
        return mp3Buffer;
      }
    }
    throw err;
  }
}

function splitTextForTtsChunks(text: string, maxLen = 160): string[] {
  const sentences = text
    .split(/(?<=[。！？.!?\n；;]+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const sent of sentences) {
    if ((current + ' ' + sent).trim().length <= maxLen) {
      current = (current + ' ' + sent).trim();
    } else {
      if (current) chunks.push(current);
      if (sent.length <= maxLen) {
        current = sent;
      } else {
        for (let i = 0; i < sent.length; i += maxLen) {
          chunks.push(sent.slice(i, i + maxLen));
        }
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

function detectTtsLangCode(text: string, voiceHint: string): string {
  if (/[\u3040-\u30ff]/.test(text) || /^ja/i.test(voiceHint)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text) || /^ko/i.test(voiceHint)) return 'ko';
  if (/^zh-(tw|hk)/i.test(voiceHint)) return 'zh-TW';
  if (/[\u4e00-\u9fff]/.test(text) || /^zh/i.test(voiceHint)) return 'zh-CN';
  return 'en';
}

async function synthesizeGoogleTtsMp3(params: {
  text: string;
  voice: string;
  speed: number;
}): Promise<Buffer> {
  const tl = detectTtsLangCode(params.text, params.voice);
  const chunks = splitTextForTtsChunks(params.text, 160);
  const buffers: Buffer[] = [];
  const ttsSpeed = params.speed < 0.85 ? '0.24' : '1';

  for (const chunk of chunks) {
    const url =
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob` +
      `&tl=${encodeURIComponent(tl)}&ttsspeed=${ttsSpeed}&q=${encodeURIComponent(chunk)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) {
      throw new Error(`Google TTS stream returned HTTP ${res.status}`);
    }
    const arr = await res.arrayBuffer();
    if (arr.byteLength > 0) {
      buffers.push(Buffer.from(arr));
    }
  }

  if (buffers.length === 0) {
    throw new Error('Google TTS returned empty audio');
  }
  return Buffer.concat(buffers);
}

interface TtsSegmentPayload {
  text: string;
  voice: string;
  speed?: number;
  pitch?: number;
  isNpc?: boolean;
}

function synthesizeWindowsSapiWav(params: {
  segments: TtsSegmentPayload[];
  outWavPath: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const normalizedSegments = params.segments.map((seg) => {
      const spd = Number(seg.speed ?? 1.0);
      const rateInt = Math.max(
        -5,
        Math.min(5, Math.round(((Number.isFinite(spd) ? spd : 1.0) - 1.0) * 6))
      );
      const langCode = detectTtsLangCode(seg.text, seg.voice);
      const isMale = /Yunxi|Yunjian|Yunxia|YunJhe|Andrew|Guy|Ryan|Keita|InJoon|am_|zm_|onyx|male/i.test(
        seg.voice
      );
      return {
        text: seg.text,
        rate: rateInt,
        lang: langCode.slice(0, 2),
        male: isMale,
      };
    });

    const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
$synth.SetOutputToWaveFile($env:RP_TTS_OUT)
$segments = $env:RP_TTS_SEGMENTS_JSON | ConvertFrom-Json
foreach ($seg in $segments) {
  $synth.Rate = [int]$seg.rate
  $targetLang = [string]$seg.lang
  $preferMale = [bool]$seg.male
  $matched = $null
  foreach ($v in $voices) {
    $culture = $v.VoiceInfo.Culture.Name
    if ($culture -like "$targetLang*") {
      if (($preferMale -and $v.VoiceInfo.Gender -eq 'Male') -or (-not $preferMale -and $v.VoiceInfo.Gender -eq 'Female')) {
        $matched = $v.VoiceInfo.Name
        break
      }
      if (-not $matched) { $matched = $v.VoiceInfo.Name }
    }
  }
  if ($matched) {
    try { $synth.SelectVoice($matched) } catch {}
  }
  $synth.Speak([string]$seg.text)
}
$synth.Dispose()
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        env: {
          ...process.env,
          RP_TTS_SEGMENTS_JSON: JSON.stringify(normalizedSegments),
          RP_TTS_OUT: params.outWavPath,
        },
        timeout: 25000,
      },
      (err) => {
        if (err) {
          reject(new Error(`Windows SAPI TTS failed: ${err.message}`));
          return;
        }
        try {
          const buf = fs.readFileSync(params.outWavPath);
          resolve(buf);
        } catch (readErr: any) {
          reject(new Error(`Failed to read SAPI WAV: ${readErr?.message}`));
        }
      }
    );
  });
}

function readBufferBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-backend-bridge',
      configureServer(server) {
        ensureDataDir();

        // 0. Host Network Interfaces for Phone & Tailscale Access (/api/host-info)
        server.middlewares.use('/api/host-info', (_req: IncomingMessage, res: ServerResponse) => {
          try {
            const ifaces = os.networkInterfaces();
            const interfaces: Array<{ name: string; ip: string; isTailscale: boolean }> = [];
            for (const [name, list] of Object.entries(ifaces)) {
              for (const iface of list || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                  const isTailscale =
                    name.toLowerCase().includes('tailscale') ||
                    iface.address.startsWith('100.');
                  interfaces.push({
                    name,
                    ip: iface.address,
                    isTailscale,
                  });
                }
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                port: 5173,
                interfaces,
              })
            );
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err?.message || 'Host info error' }));
          }
        });

        // 1. Local persistent database endpoint (/api/db)
        server.middlewares.use('/api/db', async (req: IncomingMessage, res: ServerResponse) => {
          try {
            if (req.method === 'GET') {
              if (!fs.existsSync(DB_FILE)) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ empty: true }));
                return;
              }
              const raw = fs.readFileSync(DB_FILE, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(raw);
              return;
            }
            if (req.method === 'POST') {
              const bodyBuf = await readBufferBody(req);
              writeDbAtomically(bodyBuf.toString('utf-8'));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
              return;
            }
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err?.message || 'Storage error' }));
          }
        });

        // 1a. Storage stats & cleanup endpoints (/api/storage/stats, /api/storage/cleanup)
        server.middlewares.use('/api/storage', async (req: IncomingMessage, res: ServerResponse) => {
          try {
            ensureDataDir();
            const reqUrl = new URL(req.url || '/', 'http://localhost');
            const pathname = reqUrl.pathname.replace(/^\/+|\/+$/g, '');

            if (req.method === 'GET' && pathname === 'stats') {
              const dbText = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE, 'utf-8') : '';
              const dbSizeBytes = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0;
              const refs = collectReferencedMedia(dbText);
              const backups = listRollingBackups();

              let audioCount = 0;
              let audioBytes = 0;
              let wavCount = 0;
              let wavBytes = 0;
              let orphanAudioCount = 0;
              let orphanAudioBytes = 0;
              for (const name of fs.readdirSync(AUDIO_DIR)) {
                const full = path.join(AUDIO_DIR, name);
                const st = fs.statSync(full);
                if (!st.isFile()) continue;
                audioCount++;
                audioBytes += st.size;
                if (name.toLowerCase().endsWith('.wav')) {
                  wavCount++;
                  wavBytes += st.size;
                }
                if (!refs.audio.has(name)) {
                  orphanAudioCount++;
                  orphanAudioBytes += st.size;
                }
              }

              let imageCount = 0;
              let imageBytes = 0;
              let orphanImageCount = 0;
              let orphanImageBytes = 0;
              for (const name of fs.readdirSync(IMAGES_DIR)) {
                const full = path.join(IMAGES_DIR, name);
                const st = fs.statSync(full);
                if (!st.isFile()) continue;
                imageCount++;
                imageBytes += st.size;
                if (!refs.images.has(name)) {
                  orphanImageCount++;
                  orphanImageBytes += st.size;
                }
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  dbSizeBytes,
                  backups,
                  audio: {
                    count: audioCount,
                    bytes: audioBytes,
                    wavCount,
                    wavBytes,
                    orphanCount: orphanAudioCount,
                    orphanBytes: orphanAudioBytes,
                  },
                  images: {
                    count: imageCount,
                    bytes: imageBytes,
                    orphanCount: orphanImageCount,
                    orphanBytes: orphanImageBytes,
                  },
                })
              );
              return;
            }

            if (req.method === 'POST' && pathname === 'cleanup') {
              const bodyBuf = await readBufferBody(req);
              const payload = JSON.parse(bodyBuf.toString('utf-8') || '{}');
              const action = String(payload.action || '');

              if (action === 'backup_now') {
                const backupName = createRollingBackup(true);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true, backupName }));
                return;
              }

              if (action === 'restore_backup') {
                const safeName = path.basename(String(payload.filename || ''));
                const backupPath = path.join(BACKUPS_DIR, safeName);
                if (!safeName || !fs.existsSync(backupPath)) {
                  res.statusCode = 404;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Backup file not found' }));
                  return;
                }
                const restoredRaw = fs.readFileSync(backupPath, 'utf-8');
                const parsedDb = JSON.parse(restoredRaw);
                writeDbAtomically(restoredRaw, true);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true, filename: safeName, db: parsedDb }));
                return;
              }

              if (action === 'prune_orphans') {
                const dbText = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE, 'utf-8') : '';
                const refs = collectReferencedMedia(dbText);
                let deletedAudioCount = 0;
                let deletedImageCount = 0;
                let freedBytes = 0;

                for (const name of fs.readdirSync(AUDIO_DIR)) {
                  if (refs.audio.has(name)) continue;
                  const full = path.join(AUDIO_DIR, name);
                  try {
                    const st = fs.statSync(full);
                    if (st.isFile()) {
                      fs.unlinkSync(full);
                      deletedAudioCount++;
                      freedBytes += st.size;
                    }
                  } catch {
                    // ignore
                  }
                }

                if (payload.includeImages) {
                  for (const name of fs.readdirSync(IMAGES_DIR)) {
                    if (refs.images.has(name)) continue;
                    const full = path.join(IMAGES_DIR, name);
                    try {
                      const st = fs.statSync(full);
                      if (st.isFile()) {
                        fs.unlinkSync(full);
                        deletedImageCount++;
                        freedBytes += st.size;
                      }
                    } catch {
                      // ignore
                    }
                  }
                }

                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    ok: true,
                    deletedAudioCount,
                    deletedImageCount,
                    freedBytes,
                  })
                );
                return;
              }

              if (action === 'compress_wavs') {
                const maxFiles = Math.max(1, Math.min(500, Number(payload.batchSize) || 120));
                const wavFiles = fs
                  .readdirSync(AUDIO_DIR)
                  .filter((n) => n.toLowerCase().endsWith('.wav'));
                const targetBatch = wavFiles.slice(0, maxFiles);

                let convertedCount = 0;
                let failedCount = 0;
                let freedBytes = 0;
                const urlReplacements: Array<[string, string]> = [];

                for (const wavName of targetBatch) {
                  const wavPath = path.join(AUDIO_DIR, wavName);
                  const mp3Name = wavName.replace(/\.wav$/i, '.mp3');
                  const mp3Path = path.join(AUDIO_DIR, mp3Name);
                  let wavSize = 0;
                  try {
                    wavSize = fs.statSync(wavPath).size;
                  } catch {
                    continue;
                  }

                  const ok = await transcodeWavToMp3(wavPath, mp3Path);
                  if (ok && fs.existsSync(mp3Path)) {
                    const mp3Size = fs.statSync(mp3Path).size;
                    try {
                      fs.unlinkSync(wavPath);
                    } catch {
                      // ignore
                    }
                    convertedCount++;
                    freedBytes += Math.max(0, wavSize - mp3Size);
                    urlReplacements.push([`/api/audio/${wavName}`, `/api/audio/${mp3Name}`]);
                  } else {
                    failedCount++;
                    try {
                      if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
                    } catch {
                      // ignore
                    }
                  }
                }

                let updatedDb: unknown = null;
                if (urlReplacements.length > 0 && fs.existsSync(DB_FILE)) {
                  let dbText = fs.readFileSync(DB_FILE, 'utf-8');
                  let changed = false;
                  for (const [oldUrl, newUrl] of urlReplacements) {
                    if (dbText.includes(oldUrl)) {
                      dbText = dbText.split(oldUrl).join(newUrl);
                      changed = true;
                    }
                  }
                  if (changed) {
                    writeDbAtomically(dbText, true);
                    updatedDb = JSON.parse(dbText);
                  }
                }

                const remainingWavs = fs
                  .readdirSync(AUDIO_DIR)
                  .filter((n) => n.toLowerCase().endsWith('.wav')).length;

                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    ok: true,
                    convertedCount,
                    failedCount,
                    freedBytes,
                    remainingWavs,
                    db: updatedDb,
                  })
                );
                return;
              }

              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Unknown cleanup action: ${action}` }));
              return;
            }

            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Not found' }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message || 'Storage management error' }));
          }
        });

        // 1b. Local image file storage endpoint (/api/images) -> saves/serves/deletes PNGs in data/images/
        server.middlewares.use('/api/images', async (req: IncomingMessage, res: ServerResponse) => {
          try {
            ensureDataDir();
            const reqUrl = new URL(req.url || '/', 'http://localhost');
            const pathname = decodeURIComponent(reqUrl.pathname.replace(/^\/+/, ''));

            if (req.method === 'GET' && pathname) {
              const safeName = path.basename(pathname);
              const filePath = path.join(IMAGES_DIR, safeName);
              if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.end('Image not found');
                return;
              }
              const ext = path.extname(safeName).toLowerCase();
              const mime =
                ext === '.jpg' || ext === '.jpeg'
                  ? 'image/jpeg'
                  : ext === '.webp'
                  ? 'image/webp'
                  : 'image/png';
              res.setHeader('Content-Type', mime);
              res.setHeader('Cache-Control', 'public, max-age=31536000');
              res.end(fs.readFileSync(filePath));
              return;
            }

            if (req.method === 'POST') {
              const bodyBuf = await readBufferBody(req);
              const payload = JSON.parse(bodyBuf.toString('utf-8'));
              const rawName = String(payload.filename || `rp_${Date.now()}.png`);
              const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
              const dataUrl: string = String(payload.dataUrl || '');
              const base64Match = dataUrl.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
              const imgBuffer = base64Match
                ? Buffer.from(base64Match[1], 'base64')
                : Buffer.from(dataUrl, 'base64');

              const filePath = path.join(IMAGES_DIR, safeName);
              fs.writeFileSync(filePath, imgBuffer);

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  filename: safeName,
                  url: `/api/images/${safeName}`,
                  localPath: filePath,
                })
              );
              return;
            }

            if (req.method === 'DELETE') {
              const targetName = pathname || reqUrl.searchParams.get('filename') || '';
              const safeName = path.basename(targetName);
              if (safeName) {
                const filePath = path.join(IMAGES_DIR, safeName);
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                }
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Unsupported /api/images request' }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message || 'Image storage error' }));
          }
        });

        // 1c. Local TTS audio cache endpoint (/api/audio) -> saves/serves/deletes audio in data/audio/
        server.middlewares.use('/api/audio', async (req: IncomingMessage, res: ServerResponse) => {
          try {
            ensureDataDir();
            const reqUrl = new URL(req.url || '/', 'http://localhost');
            const pathname = decodeURIComponent(reqUrl.pathname.replace(/^\/+/, ''));

            if (req.method === 'GET' && pathname) {
              const safeName = path.basename(pathname);
              const filePath = path.join(AUDIO_DIR, safeName);
              if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.end('Audio not found');
                return;
              }
              const ext = path.extname(safeName).toLowerCase();
              const mime =
                ext === '.wav'
                  ? 'audio/wav'
                  : ext === '.ogg' || ext === '.opus'
                  ? 'audio/ogg'
                  : ext === '.aac'
                  ? 'audio/aac'
                  : 'audio/mpeg';
              const buf = fs.readFileSync(filePath);
              res.setHeader('Content-Type', mime);
              res.setHeader('Content-Length', buf.length);
              res.setHeader('Accept-Ranges', 'bytes');
              res.setHeader('Cache-Control', 'public, max-age=31536000');
              res.end(buf);
              return;
            }

            if (req.method === 'POST') {
              const bodyBuf = await readBufferBody(req);
              const payload = JSON.parse(bodyBuf.toString('utf-8'));
              const rawName = String(payload.filename || `tts_${Date.now()}.mp3`);
              const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
              const dataUrl: string = String(payload.dataUrl || payload.base64 || '');
              const base64Match = dataUrl.match(/^data:audio\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
              const audioBuffer = base64Match
                ? Buffer.from(base64Match[1], 'base64')
                : Buffer.from(dataUrl, 'base64');

              let finalName = safeName;
              let finalPath = path.join(AUDIO_DIR, finalName);
              let compressed = false;

              if (safeName.toLowerCase().endsWith('.wav')) {
                const tmpWavPath = path.join(AUDIO_DIR, `.tmp_${Date.now()}_${safeName}`);
                const mp3Name = safeName.replace(/\.wav$/i, '.mp3');
                const mp3Path = path.join(AUDIO_DIR, mp3Name);
                fs.writeFileSync(tmpWavPath, audioBuffer);
                const ok = await transcodeWavToMp3(tmpWavPath, mp3Path);
                if (ok) {
                  try {
                    fs.unlinkSync(tmpWavPath);
                  } catch {
                    // ignore
                  }
                  finalName = mp3Name;
                  finalPath = mp3Path;
                  compressed = true;
                } else {
                  try {
                    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
                  } catch {
                    // ignore
                  }
                  fs.renameSync(tmpWavPath, finalPath);
                }
              } else {
                fs.writeFileSync(finalPath, audioBuffer);
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  filename: finalName,
                  url: `/api/audio/${finalName}`,
                  localPath: finalPath,
                  compressed,
                })
              );
              return;
            }

            if (req.method === 'DELETE') {
              const targetName = pathname || reqUrl.searchParams.get('filename') || '';
              const safeName = path.basename(targetName);
              if (safeName) {
                const filePath = path.join(AUDIO_DIR, safeName);
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                }
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Unsupported /api/audio request' }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message || 'Audio storage error' }));
          }
        });

        // 1d. Built-in 0-VRAM Microsoft Edge Neural TTS endpoint (/api/edge-tts)
        server.middlewares.use('/api/edge-tts', async (req: IncomingMessage, res: ServerResponse) => {
          try {
            ensureDataDir();
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Method not allowed' }));
              return;
            }

            const bodyBuf = await readBufferBody(req);
            const payload = JSON.parse(bodyBuf.toString('utf-8'));
            const text = String(payload.text || '').trim();
            const rawSegments: TtsSegmentPayload[] = Array.isArray(payload.segments)
              ? payload.segments
                  .map((s: any) => ({
                    text: String(s?.text || '').trim(),
                    voice: String(s?.voice || payload.voice || 'zh-CN-XiaoxiaoNeural').trim(),
                    speed: Number(s?.speed ?? payload.speed ?? 1.0),
                    pitch: Number(s?.pitch ?? payload.pitch ?? 0),
                    isNpc: Boolean(s?.isNpc),
                  }))
                  .filter((s: TtsSegmentPayload) => s.text.length > 0)
              : text
              ? [
                  {
                    text,
                    voice: String(payload.voice || 'zh-CN-XiaoxiaoNeural').trim(),
                    speed: Number(payload.speed ?? 1.0),
                    pitch: Number(payload.pitch ?? 0),
                    isNpc: false,
                  },
                ]
              : [];

            if (rawSegments.length === 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing text to synthesize' }));
              return;
            }

            const cacheAudio = payload.cacheAudio !== false;
            const preferredEngine = String(payload.engine || 'auto');
            const hashInput =
              preferredEngine +
              '|' +
              rawSegments
                .map((s) => `${s.voice}:${s.speed ?? 1}:${s.pitch ?? 0}:${s.text}`)
                .join('||');
            const hashKey = crypto
              .createHash('sha1')
              .update(hashInput)
              .digest('hex')
              .slice(0, 16);
            const rawFilename = payload.filename
              ? String(payload.filename)
              : `tts_${hashKey}.mp3`;
            const safeName = path
              .basename(rawFilename.endsWith('.mp3') ? rawFilename : `${rawFilename}.mp3`)
              .replace(/[^a-zA-Z0-9._-]/g, '_');
            const cachedFilePath = path.join(AUDIO_DIR, safeName);

            if (cacheAudio && fs.existsSync(cachedFilePath)) {
              const stat = fs.statSync(cachedFilePath);
              if (stat.size > 128) {
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    ok: true,
                    cached: true,
                    filename: safeName,
                    url: `/api/audio/${safeName}`,
                  })
                );
                return;
              }
            }

            let audioBuffer: Buffer | null = null;
            let engineUsed = 'edge-tts';
            let audioExt: 'mp3' | 'wav' = 'mp3';

            // 1. Try Edge Neural TTS unless user explicitly chose google-tts or windows-sapi
            if (preferredEngine === 'auto' || preferredEngine === 'edge-tts') {
              try {
                const segBuffers: Buffer[] = [];
                for (const seg of rawSegments) {
                  const spd = Number.isFinite(seg.speed)
                    ? Math.max(0.5, Math.min(2.0, Number(seg.speed)))
                    : 1.0;
                  const ratePct = Math.round((spd - 1.0) * 100);
                  const segRate = `${ratePct >= 0 ? '+' : ''}${ratePct}%`;
                  const ptc = Number.isFinite(seg.pitch)
                    ? Math.max(-25, Math.min(25, Math.round(Number(seg.pitch))))
                    : 0;
                  const segPitch = `${ptc >= 0 ? '+' : ''}${ptc}Hz`;
                  const buf = await synthesizeEdgeTtsMp3({
                    text: seg.text,
                    voice: seg.voice,
                    rate: segRate,
                    pitch: segPitch,
                  });
                  if (buf && buf.length > 0) {
                    segBuffers.push(buf);
                  }
                }
                if (segBuffers.length > 0) {
                  audioBuffer = Buffer.concat(segBuffers);
                  engineUsed = 'edge-tts';
                }
              } catch (_edgeErr) {
                // Edge Read Aloud WebSocket often returns 403 Forbidden due to Microsoft DRM/regional block;
                // automatically fall back to Google TTS stream -> Windows SAPI so 0-VRAM TTS always works!
                audioBuffer = null;
              }
            }

            // 2. Fallback or explicit Google Cloud TTS stream (0 VRAM, no 403 block, multilingual MP3)
            if (
              (!audioBuffer || audioBuffer.length === 0) &&
              preferredEngine !== 'windows-sapi'
            ) {
              try {
                const segBuffers: Buffer[] = [];
                for (const seg of rawSegments) {
                  const spd = Number.isFinite(seg.speed)
                    ? Math.max(0.5, Math.min(2.0, Number(seg.speed)))
                    : 1.0;
                  // For NPC segments in Google TTS, slightly vary locale/speed so NPC lines contrast with {{char}}
                  let voiceHint = seg.voice;
                  if (seg.isNpc) {
                    if (/^zh-CN/i.test(voiceHint)) voiceHint = 'zh-TW';
                    else if (/^zh-TW/i.test(voiceHint)) voiceHint = 'zh-CN';
                  }
                  const buf = await synthesizeGoogleTtsMp3({
                    text: seg.text,
                    voice: voiceHint,
                    speed: seg.isNpc ? Math.max(0.6, spd - 0.15) : spd,
                  });
                  if (buf && buf.length > 0) {
                    segBuffers.push(buf);
                  }
                }
                if (segBuffers.length > 0) {
                  audioBuffer = Buffer.concat(segBuffers);
                  engineUsed = 'google-tts';
                  audioExt = 'mp3';
                }
              } catch (_googleErr) {
                audioBuffer = null;
              }
            }

            // 3. Offline Windows Native SAPI fallback (0 VRAM, 100% offline on Windows PC)
            if (!audioBuffer || audioBuffer.length === 0) {
              const wavSafeName = safeName.replace(/\.mp3$/i, '.wav');
              const wavFilePath = path.join(AUDIO_DIR, wavSafeName);
              audioBuffer = await synthesizeWindowsSapiWav({
                segments: rawSegments,
                outWavPath: wavFilePath,
              });
              engineUsed = 'windows-sapi';
              audioExt = 'wav';

              if (cacheAudio) {
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    ok: true,
                    cached: false,
                    engineUsed,
                    filename: wavSafeName,
                    url: `/api/audio/${wavSafeName}`,
                  })
                );
                return;
              }
            }

            if (!audioBuffer || audioBuffer.length === 0) {
              throw new Error('Zero-VRAM TTS synthesis returned empty audio');
            }

            if (cacheAudio) {
              fs.writeFileSync(cachedFilePath, audioBuffer);
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  cached: false,
                  engineUsed,
                  filename: safeName,
                  url: `/api/audio/${safeName}`,
                })
              );
              return;
            }

            const mime = audioExt === 'wav' ? 'audio/wav' : 'audio/mpeg';
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: true,
                cached: false,
                engineUsed,
                dataUrl: `data:${mime};base64,${audioBuffer.toString('base64')}`,
              })
            );
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: err?.message || 'Edge TTS synthesis error',
              })
            );
          }
        });

        // 2. Universal CORS-free proxy for Ollama, LM Studio, OpenAI-compatible APIs, and ComfyUI (/api/proxy)
        // Uses fresh non-pooled sockets (agent: false) with a 10-minute timeout and 1-time transient retry
        // to avoid Node undici stale keep-alive socket "fetch failed" (502) errors after VRAM unloads or long renders.
        server.middlewares.use('/api/proxy', async (req: IncomingMessage, res: ServerResponse) => {
          const targetUrl = (req.headers['x-target-url'] as string) || '';
          try {
            if (!targetUrl) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing x-target-url header' }));
              return;
            }

            const method = req.method || 'GET';
            const headers: Record<string, string | number> = {
              Connection: 'close',
            };
            if (req.headers['content-type']) {
              headers['Content-Type'] = req.headers['content-type'] as string;
            }
            if (req.headers['authorization']) {
              headers['Authorization'] = req.headers['authorization'] as string;
            }

            const bodyBuf = ['POST', 'PUT', 'PATCH'].includes(method)
              ? await readBufferBody(req)
              : undefined;
            if (bodyBuf) {
              headers['Content-Length'] = bodyBuf.byteLength;
            }

            const forwardOnce = (attempt: number): Promise<void> =>
              new Promise((resolve, reject) => {
                const parsedUrl = new URL(targetUrl);
                const isHttps = parsedUrl.protocol === 'https:';
                const requestFn = isHttps ? https.request : http.request;
                let responseStarted = false;

                const upstreamReq = requestFn(
                  parsedUrl,
                  {
                    method,
                    headers,
                    agent: false,
                    timeout: 600_000,
                  },
                  (upstreamRes) => {
                    responseStarted = true;
                    res.statusCode = upstreamRes.statusCode || 200;
                    const contentType = upstreamRes.headers['content-type'];
                    if (contentType) {
                      res.setHeader('Content-Type', contentType);
                    }
                    upstreamRes.on('data', (chunk: Buffer) => {
                      if (!res.writableEnded) {
                        res.write(chunk);
                      }
                    });
                    upstreamRes.on('end', () => {
                      if (!res.writableEnded) {
                        res.end();
                      }
                      resolve();
                    });
                    upstreamRes.on('error', (streamErr) => {
                      if (!res.writableEnded) {
                        res.end();
                      }
                      resolve();
                      void streamErr;
                    });
                  }
                );

                upstreamReq.on('timeout', () => {
                  upstreamReq.destroy(
                    new Error(`Upstream timeout after 600s connecting to ${targetUrl}`)
                  );
                });

                upstreamReq.on('error', (err: any) => {
                  const code = err?.code || '';
                  if (
                    !responseStarted &&
                    attempt === 0 &&
                    (code === 'ECONNRESET' ||
                      code === 'EPIPE' ||
                      code === 'ECONNABORTED')
                  ) {
                    setTimeout(() => {
                      forwardOnce(1).then(resolve).catch(reject);
                    }, 200);
                    return;
                  }
                  reject(err);
                });

                if (bodyBuf && bodyBuf.byteLength > 0) {
                  upstreamReq.write(bodyBuf);
                }
                upstreamReq.end();
              });

            await forwardOnce(0);
          } catch (err: any) {
            const code = err?.code || err?.cause?.code || '';
            const detail =
              code === 'ECONNREFUSED'
                ? `Cannot connect to ${targetUrl} (ECONNREFUSED — check that Ollama / local server is running)`
                : code
                ? `${err?.message || 'Proxy error'} (${code}) on ${targetUrl}`
                : err?.cause?.message
                ? `${err.message}: ${err.cause.message}`
                : err?.message || 'Failed to connect to local service';
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
            }
            if (!res.writableEnded) {
              res.end(JSON.stringify({ error: detail }));
            }
          }
        });

        // 5. Reference Voice WAV Upload Helper (/api/ref-voice)
        server.middlewares.use('/api/ref-voice', async (req: IncomingMessage, res: ServerResponse) => {
          try {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }
            const bodyBuf = await readBufferBody(req);
            const payload = JSON.parse(bodyBuf.toString('utf-8') || '{}');
            const rawName = String(payload.filename || 'custom_ref.wav');
            const base64Data = String(payload.base64 || '').replace(
              /^data:audio\/[a-z0-9.+-]+;base64,/i,
              ''
            );
            if (!base64Data) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing audio base64 data' }));
              return;
            }
            const safeBase = path
              .basename(rawName)
              .replace(/[^a-zA-Z0-9._-]/g, '_')
              .replace(/\.(wav|mp3|ogg|flac)$/i, '');
            const finalName = `${safeBase || 'ref_voice'}.wav`;
            const gptSovitsVoicesDir = 'I:\\GPT-SoVITS\\voices';
            const targetDir = fs.existsSync('I:\\GPT-SoVITS')
              ? gptSovitsVoicesDir
              : path.join(DATA_DIR, 'voices');
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            const fullPath = path.join(targetDir, finalName);
            fs.writeFileSync(fullPath, Buffer.from(base64Data, 'base64'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: fullPath }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: false,
                error: err?.message || 'Failed to save reference voice WAV',
              })
            );
          }
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces (LAN Wi-Fi & Tailscale)
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
});
