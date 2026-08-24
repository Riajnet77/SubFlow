import express from "express";
import { createServer as createViteServer } from "vite";
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Groq from 'groq-sdk';

// Use modern FFmpeg binary committed to repo if available.
const modernFfmpegPath = path.join(process.cwd(), 'ffmpeg-linux');
console.log('[ffmpeg] cwd:', process.cwd());
console.log('[ffmpeg] ffmpeg-linux exists:', fs.existsSync(modernFfmpegPath));
console.log('[ffmpeg] path:', modernFfmpegPath);
if (fs.existsSync(modernFfmpegPath)) {
  fs.chmodSync(modernFfmpegPath, '755');
  ffmpeg.setFfmpegPath(modernFfmpegPath);
  console.log('[ffmpeg] Using modern ffmpeg-linux binary');
} else {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  console.log('[ffmpeg] Using npm ffmpeg (2018 fallback)');
}

// Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Copy fonts to ~/.fonts
const fontsDir = path.join(process.cwd(), '_fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);
const homeFontsDir = path.join(process.env.HOME || '/root', '.fonts');
if (!fs.existsSync(homeFontsDir)) fs.mkdirSync(homeFontsDir, { recursive: true });

// CORREÇÃO 1: Busca fontes dinamicamente e remove números do nome
const rootFiles = fs.readdirSync(process.cwd()).filter(f => f.toUpperCase().endsWith('.TTF'));
for (const f of rootFiles) {
  const src = path.join(process.cwd(), f);
  const cleanName = f.replace(/^\d+_/, '');
  fs.copyFileSync(src, path.join(fontsDir, cleanName));
  fs.copyFileSync(src, path.join(homeFontsDir, cleanName));
}
try { require('child_process').execSync('fc-cache -f ' + homeFontsDir, { timeout: 10000 }); } catch(e) {}
console.log('[fonts] Ready in', homeFontsDir);

const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 150 * 1024 * 1024 },
});

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function buildSrt(subtitles: any[]): string {
  return subtitles
    .map((sub, i) => `${i + 1}\n${formatSrtTime(sub.start)} --> ${formatSrtTime(sub.end)}\n${sub.text}\n`)
    .join('\n');
}

async function applyEmphasis(subtitles: any[], groq: any): Promise<any[]> {
  try {
    const texts = subtitles.map((s, i) => `${i + 1}|||${s.text}`).join('\n');
    const chat = await groq.chat.completions.create({
      // CORREÇÃO 2: Modelo correto da Groq
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content: `You are a subtitle emphasis editor. For each subtitle line, identify the 1-2 most important words (nouns, verbs, key adjectives) and wrap them in **double asterisks**.
Keep ALL other words exactly as-is. Return the same numbered format.
Example:
Input:  1|||you need to find the demand
Output: 1|||you need to find the **demand**
Input:  2|||where people are looking for answers
Output: 2|||where people are looking for **answers**
Return ONLY the numbered lines, nothing else.`,
        },
        { role: 'user', content: texts },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const raw = chat.choices[0]?.message?.content ?? '';
    const emphasisMap = new Map<number, string>();
    for (const line of raw.split('\n')) {
      const match = line.match(/^(\d+)\|\|\|(.+)$/);
      if (match) emphasisMap.set(parseInt(match[1]), match[2].trim());
    }

    return subtitles.map((s, i) => ({
      ...s,
      text: emphasisMap.get(i + 1) ?? s.text,
    }));
  } catch (e) {
    console.warn('[emphasis] Failed, keeping original:', e);
    return subtitles;
  }
}

function buildAss(subtitles: any[], style: any): string {
  const {
    fontName: rawFontName = 'Arial',
    fontSize = 26,
    primaryColor = '#FFFFFF',
    outlineColor = '#000000',
    bgOpacity = 0,
    box = { x: 5, y: 78, w: 90, h: 14 },
    browserH = 720,
    nativeW = 0,
    nativeH = 0,
  } = style;

  const playW = nativeW || 1280;
  const playH = nativeH || 720;

  const REF_H = 1080;
  const scaledFontSize = Math.max(8, Math.round(fontSize * (playH / REF_H)));

  const hexToAss = (hex: string, alpha = 0): string => {
    const c = hex.replace('#', '').padEnd(6, '0');
    const r = c.slice(0, 2);
    const g = c.slice(2, 4);
    const b = c.slice(4, 6);
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
    return `&H${a}${b}${g}${r}`.toUpperCase();
  };

  const FONT_MAP: Record<string, string> = {
    'Impact': 'IMPACT',
    'Arial': 'ARIAL',
    'Georgia': 'GEORGIA',
    'Verdana': 'VERDANA',
    'Trebuchet MS': 'TREBUC',
    'Tahoma': 'TAHOMA',
    'Courier New': 'COUR',
  };
  const fontName = FONT_MAP[rawFontName] || rawFontName;

  // Se houver caracteres acentuados e a fonte for Impact, usa Arial como fallback
  // porque algumas versões do Impact no Linux não têm glifos para Latin Extended
  const hasAccentedChars = subtitles.some((s: any) => /[^\x00-\x7F]/.test(s.text));
  const finalFontName = (hasAccentedChars && fontName === 'IMPACT') ? 'ARIAL' : fontName;
  if (hasAccentedChars && fontName === 'IMPACT') {
    console.warn(`[buildAss] Detected accented chars, switching font from IMPACT to ARIAL for better rendering`);
  }

  const primaryAss = hexToAss(primaryColor, 0);
  const outlineAss = hexToAss(outlineColor, 0);
  const secondaryAss = hexToAss('#FFFFFF', 0);
  const backColour = hexToAss('#000000', 0.5);

  const impactPresets = ['impact','bold','fire','shadow','karaoke','retro','purple','reels','whitebox','viral','podcast'];
  const isBold = impactPresets.includes(style.preset) || rawFontName === 'Impact' ? '-1' : '0';

  const shadowDepth = bgOpacity > 0 ? 3
    : style.preset === 'shadow' ? 3
    : style.preset === 'clean' ? 4
    : style.preset === 'matrix' ? 2
    : style.preset === 'neon' ? 0
    : 0;

  const outlineWidth = bgOpacity > 0 ? 10  
    : style.preset === 'minimal' ? 1
    : style.preset === 'clean' ? 0.5   
    : style.preset === 'viral' ? 4     
    : style.preset === 'neon' ? 3
    : style.preset === 'bold' ? 3
    : 2;

  const borderStyle = bgOpacity > 0 ? 3 : 1;

  const marginL = Math.round((box.x / 100) * playW);
  const marginR = Math.round(((100 - box.x - box.w) / 100) * playW);
  const marginV = Math.round(((100 - box.y - box.h) / 100) * playH);
  const alignment = 2;

  const assTime = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  };

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playW}
PlayResY: ${playH}
ScaledBorderAndShadow: yes
WrapStyle: ${bgOpacity > 0 ? 0 : 1}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${finalFontName},${scaledFontSize},${primaryAss},${secondaryAss},${outlineAss},${backColour},${isBold},0,0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowDepth},${alignment},${marginL},${marginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const emphasisBigSize = Math.round(scaledFontSize * 2.4);
  const emphasisSmallSize = Math.max(6, Math.round(scaledFontSize * 0.8));
  const formatEmphasis = (text: string): string => {
    if (!text.includes('**')) return text;
    const result = text
      .split(/(\*\*[^*]+\*\*)/)
      .map(part => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const word = part.slice(2, -2);
          return `{\\b1\\fs${emphasisBigSize}}${word}{\\b0\\fs${scaledFontSize}}`;
        }
        return part ? `{\\fs${emphasisSmallSize}}${part}` : part;
      })
      .join('');
    return result;
  };

  const VIRAL_MAX_WORDS = 2;

  const approximateWords = (sub: any): Array<{ word: string; start: number; end: number }> => {
    const wordList = String(sub.text).replace(/\*\*/g, '').trim().split(/\s+/).filter(Boolean);
    if (wordList.length === 0) return [];
    const totalChars = wordList.reduce((a: number, w: string) => a + w.length, 0) || 1;
    const duration = sub.end - sub.start;
    let t = sub.start;
    return wordList.map((w: string) => {
      const dur = duration * (w.length / totalChars);
      const entry = { word: w, start: t, end: t + dur };
      t += dur;
      return entry;
    });
  };

  const buildKaraokeLines = (sub: any): string[] => {
    const wordsData = (sub.words && sub.words.length > 0) ? sub.words : approximateWords(sub);
    if (wordsData.length === 0) return [];
    const lines: string[] = [];
    for (let i = 0; i < wordsData.length; i += VIRAL_MAX_WORDS) {
      const chunk = wordsData.slice(i, i + VIRAL_MAX_WORDS);
      const nextChunkStart = wordsData[i + VIRAL_MAX_WORDS]?.start;
      const chunkStart = chunk[0].start;
      const chunkEnd = nextChunkStart ?? chunk[chunk.length - 1].end;
      let prevEnd = chunkStart;
      let text = '';
      for (const w of chunk) {
        const durCs = Math.max(1, Math.round((w.end - prevEnd) * 100));
        const word = String(w.word).trim().toUpperCase();
        text += `{\\k${durCs}}${word} `;
        prevEnd = w.end;
      }
      // CORREÇÃO 3: Margem correta no Karaoke
      lines.push(`Dialogue: 0,${assTime(chunkStart)},${assTime(chunkEnd)},Default,,,,,${text.trim()}`);
    }
    return lines;
  };

  const events = subtitles
    .flatMap(sub => {
      if (style.preset === 'viral') return buildKaraokeLines(sub);
      const text = formatEmphasis(sub.text);
      // CORREÇÃO 4: Margem correta na legenda normal
      return [`Dialogue: 0,${assTime(sub.start)},${assTime(sub.end)},Default,,,,,${text}`];
    })
    .join('\n');

  return header + events + '\n';
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  type JobStatus = 'processing' | 'done' | 'error';
  const jobs = new Map<string, { status: JobStatus; error?: string; outputPath?: string }>();

  app.post('/api/emphasis', express.json(), async (req, res) => {
    try {
      const { subtitles } = req.body;
      if (!Array.isArray(subtitles)) return res.status(400).json({ error: 'subtitles required' });
      const result = await applyEmphasis(subtitles, groq);
      res.json({ subtitles: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/render', upload.single('video'), async (req, res) => {
    if (!req.file || !req.body.subtitles) {
      return res.status(400).json({ error: 'Video file and subtitles are required' });
    }

    const subtitles: any[] = JSON.parse(req.body.subtitles);
    const style = req.body.style ? JSON.parse(req.body.style) : {};
    const id = uuidv4();
    const inputPath = req.file.path;
    const assPath = `/tmp/${id}.ass`;
    const outputPath = `/tmp/${id}_output.mp4`;

    jobs.set(id, { status: 'processing' });
    res.json({ jobId: id });

    (async () => {
      try {
        const hasEmphasis = subtitles.some((s: any) => s.text && s.text.includes('**'));
        console.log(`[render ${id}] Starting encode... hasEmphasis=${hasEmphasis} preset=${style.preset}`);
        
        const assContent = buildAss(subtitles, style);
        // Escreve .ass com BOM UTF-8 para libass reconhecer acentos corretamente
    fs.writeFileSync(assPath, '﻿' + assContent, 'utf8');
    console.log(`[render ${id}] ASS file written. First 200 chars:`, assContent.slice(0, 200));
        const assEsc = assPath.replace(/\\/g,"/").replace(/^([A-Za-z]):/,"$1\\:");
        
        // CORREÇÃO 5: Sem aspas no caminho para não crashar o FFmpeg
        const vfFilter = "ass=" + assEsc + "";

        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions([
              '-c:v libx264',
              '-preset ultrafast',
              '-crf 23',
              '-threads 1',
              '-tune fastdecode',
              `-vf ${vfFilter}`,
              '-c:a copy',
              '-movflags +faststart',
              '-f mp4',
            ])
            .on('start', cmd => console.log(`[render ${id}] ffmpeg cmd:`, cmd))
            .on('progress', p => console.log(`[render ${id}] progress: ${p.percent?.toFixed(1)}%`))
            .on('end', () => { console.log(`[render ${id}] Done`); resolve(); })
            .on('stderr', line => { if (line.includes('font') || line.includes('bold') || line.includes('warn')) console.log(`[render stderr]`, line); })
            .on('error', reject)
            .save(outputPath);
        });

        jobs.set(id, { status: 'done', outputPath });
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(assPath); } catch {}
      } catch (e: any) {
        console.error(`[render ${id}] Error:`, e);
        jobs.set(id, { status: 'error', error: e.message });
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(assPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
      }
    })();
  });

  app.get('/api/render/:id/status', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ status: job.status, error: job.error });
  });

  app.get('/api/render/:id/download', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.status !== 'done' || !job.outputPath) {
      return res.status(404).json({ error: 'File not ready' });
    }
    res.download(job.outputPath, 'subflow_export.mp4', err => {
      if (err) console.error(`[render ${req.params.id}] download error:`, err);
      try { fs.unlinkSync(job.outputPath!); } catch {}
      jobs.delete(req.params.id);
    });
  });

  app.post('/api/transcribe', upload.single('video'), async (req, res) => {
    const tmpFiles: string[] = [];
    const cleanup = () => tmpFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });

    try {
      if (!req.file) return res.status(400).json({ error: 'Video file is required' });

      const targetLang = req.body.targetLang || 'original';
      const id = uuidv4();
      const inputPath = req.file.path;
      const audioPath = `/tmp/${id}_audio.mp3`;
      tmpFiles.push(inputPath, audioPath);

      console.log(`[transcribe ${id}] Extracting audio...`);

      process.env.FONTCONFIG_PATH = path.join(process.cwd(), '_fonts');
      process.env.FC_FONT_PATH = path.join(process.cwd(), '_fonts');

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate(128)
          .audioChannels(1)
          .outputOptions(['-af', 'aresample=async=1', '-threads', '1'])
          .on('end', () => resolve())
          .on('error', reject)
          .save(audioPath);
      });

      const audioSize = fs.statSync(audioPath).size;
      console.log(`[transcribe ${id}] Audio ready. Size: ${(audioSize / 1024 / 1024).toFixed(1)}MB. Sending to Groq Whisper...`);

      if (audioSize > 24 * 1024 * 1024) {
        cleanup();
        return res.status(400).json({ error: 'Audio too large for transcription (max ~10 min).' });
      }

      let transcription: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: 'whisper-large-v3-turbo',
            response_format: 'verbose_json',
            timestamp_granularities: ['segment', 'word'],
          });
          break;
        } catch (e: any) {
          console.warn(`[transcribe ${id}] Whisper attempt ${attempt} failed:`, e.message);
          if (attempt === 3) throw e;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      const rawSegments: Array<{ start: number; end: number; text: string }> =
        (transcription as any).segments ?? [];
      const words: Array<{ start: number; end: number; word: string }> =
        (transcription as any).words ?? [];

      const MAX_SEG_DURATION = 5;
      const splitSegments: Array<{ start: number; end: number; text: string }> = [];

      for (const seg of rawSegments) {
        const dur = seg.end - seg.start;
        if (dur <= MAX_SEG_DURATION) {
          splitSegments.push(seg);
          continue;
        }
        const segWords = words.filter(w => w.start >= seg.start && w.end <= seg.end + 0.1);

        if (segWords.length === 0) {
          const allWords = seg.text.trim().split(' ').filter(Boolean);
          const numChunks = Math.max(1, Math.ceil(dur / MAX_SEG_DURATION));
          const wordsPerChunk = Math.ceil(allWords.length / numChunks);
          const chunkDur = dur / numChunks;
          for (let i = 0; i < numChunks; i++) {
            const chunkWords = allWords.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk);
            if (chunkWords.length > 0) {
              splitSegments.push({
                start: seg.start + i * chunkDur,
                end: Math.min(seg.start + (i + 1) * chunkDur, seg.end),
                text: chunkWords.join(' ').trim(),
              });
            }
          }
          continue;
        }

        let chunk: typeof segWords = [];
        let chunkStart = segWords[0].start;
        for (const w of segWords) {
          chunk.push(w);
          if (w.end - chunkStart >= MAX_SEG_DURATION) {
            splitSegments.push({
              start: chunkStart,
              end: w.end,
              text: chunk.map(x => x.word).join(' ').trim(),
            });
            chunk = [];
            chunkStart = w.end;
          }
        }
        if (chunk.length > 0) {
          splitSegments.push({
            start: chunkStart,
            end: chunk[chunk.length - 1].end,
            text: chunk.map(x => x.word).join(' ').trim(),
          });
        }
      }

      let segments = splitSegments;

      const LANG_MAP: Record<string, string> = {
        'es': 'Spanish', 'pt': 'Portuguese', 'fr': 'French', 'de': 'German',
        'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
        'ru': 'Russian', 'ar': 'Arabic', 'hi': 'Hindi', 'en': 'English'
      };
      const fullLangName = LANG_MAP[targetLang.toLowerCase()] || targetLang;

      if (targetLang !== 'original' && segments.length > 0) {
        console.log(`[transcribe ${id}] Translating ${segments.length} segments to ${fullLangName}...`);

        const BATCH_SIZE = 15;
        const translationMap = new Map<number, string>();

        const translateBatch = async (batchSegments: typeof segments, offset: number) => {
          const numbered = batchSegments.map((s, i) => `${offset + i + 1}|||${s.text}`).join('\n');
          const chat = await groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: [
              {
                role: 'system',
                content: `You are an expert translator. Translate each subtitle line to ${fullLangName}.
CRITICAL RULE: The final output MUST be in ${fullLangName}. Do NOT output in English unless ${fullLangName} is English.
Rules:
- Each line starts with a number and ||| separator. Keep the exact same format.
- Keep translations CONCISE — same length or shorter than the original. Use natural contractions.
- Never add words not in the original. Prioritize brevity over literal accuracy.
- Return ONLY the translated lines with their numbers, nothing else.
Example:
Input:  1|||Hello world
        2|||How are you doing today
Output: 1|||Olá mundo
        2|||Como vai você`,
              },
              { role: 'user', content: numbered },
            ],
            temperature: 0.1,
            max_tokens: 4096,
          });
          const raw = chat.choices[0]?.message?.content ?? '';
          for (const line of raw.split('\n')) {
            const match = line.match(/^(\d+)\|\|\|(.+)$/);
            if (match) translationMap.set(parseInt(match[1]), match[2].trim());
          }
        };

        for (let i = 0; i < segments.length; i += BATCH_SIZE) {
          const batch = segments.slice(i, i + BATCH_SIZE);
          let success = false;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              await translateBatch(batch, i);
              success = true;
              break;
            } catch (e) {
              console.warn(`[transcribe ${id}] Batch ${i} attempt ${attempt} failed:`, e);
              if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
            }
          }
          if (!success) console.warn(`[transcribe ${id}] Batch ${i} failed after retries, keeping original`);
        }

        segments = segments.map((s, i) => ({
          ...s,
          text: translationMap.get(i + 1) ?? s.text,
        }));
        console.log(`[transcribe ${id}] Translation OK: got ${translationMap.size} of ${segments.length}`);
      }

      const MAX_CHARS = 42;
      const finalSegments: typeof segments = [];
      for (const seg of segments) {
        const text = seg.text.trim();
        if (text.length <= MAX_CHARS * 2) {
          finalSegments.push(seg);
          continue;
        }
        const words = text.split(' ');
        const chunks: string[] = [];
        let current = '';
        for (const word of words) {
          if ((current + ' ' + word).trim().length > MAX_CHARS && current) {
            chunks.push(current.trim());
            current = word;
          } else {
            current = current ? current + ' ' + word : word;
          }
        }
        if (current) chunks.push(current.trim());
        const dur = seg.end - seg.start;
        const timePerChunk = dur / chunks.length;
        for (let i = 0; i < chunks.length; i += 2) {
          const pair = chunks.slice(i, i + 2).join(' ');
          finalSegments.push({
            start: seg.start + i * timePerChunk,
            end: Math.min(seg.start + (i + 2) * timePerChunk, seg.end),
            text: pair,
          });
        }
      }

      let subtitles = finalSegments
        .filter(s => s.text.trim().length > 0)
        .map(s => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
          confidence: 0.9,
        })) as Array<{ start: number; end: number; text: string; confidence: number; words?: Array<{ word: string; start: number; end: number }> }>;

      if (targetLang === 'original' && words.length > 0) {
        for (const sub of subtitles) {
          sub.words = words.filter(w => w.start >= sub.start - 0.05 && w.end <= sub.end + 0.15);
        }
      }

      if (req.body.emphasis === 'true' && subtitles.length > 0) {
        console.log(`[transcribe ${id}] Applying emphasis...`);
        try {
          const emphTexts = subtitles.map((s, i) => `${i + 1}|||${s.text}`).join('\n');
          const emphChat = await groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: [
              {
                role: 'system',
                content: `You are a subtitle emphasis editor. For each subtitle line, identify the 1-2 most important words (key nouns or verbs) and wrap ONLY those words in **double asterisks**. Keep all other words exactly as-is. Return the same numbered format with ||| separator. Nothing else.
Example:
Input:  1|||you need to find the demand
Output: 1|||you need to find the **demand**`,
              },
              { role: 'user', content: emphTexts },
            ],
            temperature: 0.1,
            max_tokens: 4096,
          });
          const emphRaw = emphChat.choices[0]?.message?.content ?? '';
          const emphMap = new Map<number, string>();
          for (const line of emphRaw.split('\n')) {
            const match = line.match(/^(\d+)\|\|\|(.+)$/);
            if (match) emphMap.set(parseInt(match[1]), match[2].trim());
          }
          subtitles = subtitles.map((s, i) => ({
            ...s,
            text: emphMap.get(i + 1) ?? s.text,
          }));
          console.log(`[transcribe ${id}] Emphasis OK`);
        } catch (e) {
          console.warn(`[transcribe ${id}] Emphasis failed, keeping original`);
        }
      }

      cleanup();
      res.json({ subtitles });

    } catch (e: any) {
      console.error('[transcribe] Error:', e);
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: e.message || 'Transcription failed' });
    }
  });

  app.post('/api/export/srt', (req, res) => {
    const { subtitles } = req.body;
    if (!Array.isArray(subtitles)) return res.status(400).json({ error: 'subtitles required' });
    res.setHeader('Content-Disposition', 'attachment; filename="subtitles.srt"');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(buildSrt(subtitles));
  });

  app.post('/api/export/vtt', (req, res) => {
    const { subtitles } = req.body;
    if (!Array.isArray(subtitles)) return res.status(400).json({ error: 'subtitles required' });
    const vtt = 'WEBVTT\n\n' + subtitles
      .map((sub: any, i: number) => {
        const fmt = (s: number) => formatSrtTime(s).replace(',', '.');
        return `${i + 1}\n${fmt(sub.start)} --> ${fmt(sub.end)}\n${sub.text}`;
      })
      .join('\n\n') + '\n';
    res.setHeader('Content-Disposition', 'attachment; filename="subtitles.vtt"');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(vtt);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.use((req, res, next) => {
    if (req.path === '/api/render') {
      req.socket.setTimeout(300000);
      res.setTimeout(300000);
    }
    next();
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SubFlow server running on http://localhost:${PORT}`);
  });
}

startServer();
