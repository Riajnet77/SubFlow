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

// Use modern FFmpeg binary committed to repo if available
const modernFfmpegPath = path.join(__dirname, 'ffmpeg-linux');
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

// Groq client — shared across routes
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });


// Copy fonts to ~/.fonts where fontconfig finds them (required for static ffmpeg)
const fontsDir = path.join(process.cwd(), '_fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);
const homeFontsDir = path.join(process.env.HOME || '/root', '.fonts');
if (!fs.existsSync(homeFontsDir)) fs.mkdirSync(homeFontsDir, { recursive: true });
const TTF_FILES = ['ARIAL.TTF','ARIALBD.TTF','ARIALI.TTF','ARIALBI.TTF','IMPACT.TTF','GEORGIA.TTF','VERDANA.TTF','VERDANAB.TTF',
  'TREBUC.TTF','TREBUCBD.TTF','TAHOMA.TTF','TAHOMABD.TTF','COUR.TTF','COURBD.TTF'];
for (const f of TTF_FILES) {
  const src = path.join(process.cwd(), f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(fontsDir, f));
    fs.copyFileSync(src, path.join(homeFontsDir, f));
  }
}
try { require('child_process').execSync('fc-cache -f ' + homeFontsDir, { timeout: 10000 }); } catch(e) {}
console.log('[fonts] Ready in', homeFontsDir);

// Store uploads in memory for small files, disk for large — avoids /tmp write bottleneck
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB — ~10min video at typical bitrates
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Build an ASS subtitle file from SubFlow style data.
 * ASS lets us control font, size, color, outline, background, and box position
 * precisely — and libass renders it correctly even on Render's stripped env.
 *
 * Position: ASS uses absolute pixel coords. We convert the % box (x,y,w,h)
 * to pixels using the style.browserW / browserH sent from the frontend.
 */
// ── Emphasis preset: use LLM to identify key words and bold them ──────────────
async function applyEmphasis(subtitles: any[], groq: any): Promise<any[]> {
  try {
    const texts = subtitles.map((s, i) => `${i + 1}|||${s.text}`).join('\n');
    const chat = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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

  // Scale fontSize from preview px to native video px
  // What the user saw on screen: fontSize * fontScale px
  // scaledFontSize must match exactly what user sees in preview.
  // Preview renders: fontSize * fontScale CSS px on screen.
  // ASS with PlayResY=nativeH: fontSize in ASS = CSS px * (nativeH / browserH)
  // = fontSize * fontScale * (nativeH / browserH)
  // When fontScale = browserH/nativeH: = fontSize * (browserH/nativeH) * (nativeH/browserH) = fontSize
  // BUT fontScale is NOT always browserH/nativeH — it depends on how the video fits the container.
  // Use the actual fontScale sent from frontend for pixel-perfect match.
  // fontSize is in preview px. Preview height = browserH, native height = nativeH (= playH).
  // User saw: fontSize * fontScale px on screen (fontScale = browserH / nativeH)
  // ASS with PlayResY=nativeH maps fontSize 1:1 to native px.
  // To match preview: scaledFontSize = fontSize * fontScale * (nativeH / browserH)
  //                                  = fontSize * (browserH/nativeH) * (nativeH/browserH)
  //                                  = fontSize
  // With FFmpeg 7.x (modern): fontSize * fontScale gives pixel-perfect match with preview
  // fontScale = browserH / nativeH — what the user actually saw on screen
  const fontScaleVal = style.fontScale && style.fontScale > 0 ? style.fontScale : 1;
  const scaledFontSize = Math.round(fontSize * fontScaleVal);

  const hexToAss = (hex: string, alpha = 0): string => {
    const c = hex.replace('#', '');
    const r = c.slice(0, 2);
    const g = c.slice(2, 4);
    const b = c.slice(4, 6);
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
    return `&H${a}${b}${g}${r}`.toUpperCase();
  };

  // Map CSS font names to actual TTF filenames uploaded to repo root
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
  const primaryAss = hexToAss(primaryColor, 0);
  const outlineAss = hexToAss(outlineColor, 0);
  // BackColour: when bgOpacity > 0, use actual opacity (0=opaque, 1=transparent in ASS)
  // ASS alpha is inverted: 0x00=fully opaque, 0xFF=fully transparent
  // BackColour used for BorderStyle=4 semi-transparent box
  // OutlineColour = box background color (solid), BackColour = shadow color (unused here)
  const backColour = hexToAss('#000000', 1); // fully transparent — not used in BorderStyle=4

  // Map presets to ASS effects — matching CSS preview as closely as possible
  const impactPresets = ['impact','bold','fire','shadow','karaoke','retro','purple','reels'];
  const isBold = impactPresets.includes(style.preset) || fontName === 'Impact' ? '-1' : '0';

  // shadow preset: thin outline + subtle drop shadow (matches CSS text-shadow)
  // neon preset: thick colored outline, no shadow
  // bold preset: thick outline, no shadow
  // others: standard outline + minimal shadow
  // Shadow depth: ASS shadow is directional drop shadow
  // For BorderStyle=3: shadow must be 0, outline must be 0 for box to render
  const shadowDepth = bgOpacity > 0 ? 0
    : style.preset === 'shadow' ? 3
    : style.preset === 'matrix' ? 2
    : style.preset === 'neon' ? 0
    : 0;

  // BorderStyle=3: Outline = box padding (must be > 0 for box to render!)
  // BorderStyle=1: Outline = outline width
  const outlineWidth = bgOpacity > 0 ? 3  // box padding — required for BorderStyle=3
    : style.preset === 'minimal' ? 1
    : style.preset === 'neon' ? 3
    : style.preset === 'bold' ? 3
    : 2;

  // BorderStyle: 1=outline+shadow, 3=opaque box (BackColour = box bg)
  const borderStyle = bgOpacity > 0 ? 3 : 1;

  // Position using Alignment=5 (middle-center) + MarginV as vertical offset from center
  // This gives us full control over vertical position without fighting ASS alignment logic
  const marginL = Math.round((box.x / 100) * playW);
  const marginR = Math.round(((100 - box.x - box.w) / 100) * playW);
  // alignment=2 (bottom-center): marginV = distance from bottom to bottom of box
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
Style: Default,${fontName},${scaledFontSize},${primaryAss},${primaryAss},${outlineAss},${backColour},${isBold},0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowDepth},${alignment},${marginL},${marginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Box background color override per dialogue line
  // For whitebox: force black text so it stays readable against the white box drawn
  // by ffmpeg's drawbox filter. This must NOT depend on bgOpacity — the render handler
  // always zeroes bgOpacity for box presets (so ASS doesn't draw its own box on top of
  // drawbox's), but the text still needs to contrast the box regardless of that flag.
  // For darkbox/cinema/ice: OutlineColour already correct from style, no override needed.
  const getInlineTag = () => {
    if (style.preset === 'whitebox') {
      // Force white box color + black text: \3c=OutlineColour override + \1c=text color override
      return '{\\1c&H00000000&\\3c&H00FFFFFF&}';
    }
    return '';
  };
  const inlineTag = getInlineTag();

  // Convert **word** markers to ASS bold+size tags for emphasis preset
  const formatEmphasis = (text: string): string => {
    if (!text.includes('**')) return text;
    // Use \x5cb1 = literal backslash + b1 for ASS bold tag
    const BOLD_OPEN = String.fromCharCode(123) + String.fromCharCode(92) + 'b1' + String.fromCharCode(125);
    const BOLD_CLOSE = String.fromCharCode(123) + String.fromCharCode(92) + 'b0' + String.fromCharCode(125);
    const result = text.replace(/\*\*(.+?)\*\*/g, (_, word) => BOLD_OPEN + word + BOLD_CLOSE);
    console.log('[emphasis] sample:', result.slice(0, 80));
    return result;
  };

  const events = subtitles
    .map(sub => `Dialogue: 0,${assTime(sub.start)},${assTime(sub.end)},Default,,0,0,0,,${inlineTag}${formatEmphasis(sub.text)}`)
    .join('\n');

  return header + events + '\n';
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // ── Job store (in-memory) ──────────────────────────────────────────────────
  type JobStatus = 'processing' | 'done' | 'error';
  const jobs = new Map<string, { status: JobStatus; error?: string; outputPath?: string }>();

  // ── /api/emphasis ─────────────────────────────────────────────────────────────
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

  // ── /api/render ────────────────────────────────────────────────────────────
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
    res.json({ jobId: id }); // respond immediately — client will poll

    // Process in background
    (async () => {
      try {
        const hasEmphasis = subtitles.some((s: any) => s.text && s.text.includes('**'));
        console.log(`[render ${id}] Starting encode... hasEmphasis=${hasEmphasis} preset=${style.preset}`);
        // Log first subtitle to verify emphasis tags
        if (hasEmphasis) {
          const firstEmphasis = subtitles.find((s: any) => s.text && s.text.includes('**'));
          console.log(`[render ${id}] Sample subtitle:`, firstEmphasis?.text?.slice(0, 100));
        }

        // Build video filter chain
        const bgOpacity = style.bgOpacity || 0;
        const boxPresets = ['darkbox', 'whitebox', 'cinema', 'classic', 'ice'];
        const hasBox = bgOpacity > 0 || boxPresets.includes(style.preset || '');
        const scaleFilter = '';

        // When drawbox handles the box, tell ASS to NOT draw its own box.
        // NOTE: this only suppresses the ASS-native box (BorderStyle=3) — it must NOT
        // suppress per-preset text-color overrides (like whitebox's black-text tag),
        // which is why buildAss's getInlineTag() no longer keys off bgOpacity.
        const assStyle = hasBox ? { ...style, bgOpacity: 0 } : style;
        const assContent = buildAss(subtitles, assStyle);
        fs.writeFileSync(assPath, assContent);
        
        let vfFilter = '';
        if (hasBox) {
          // Draw background box using FFmpeg drawbox (more reliable than ASS BorderStyle)
          // Use hex colors for FFmpeg 2018 compatibility
          const boxColor = style.preset === 'whitebox' ? '0xFFFFFF' : '0x000000';
          const boxAlpha = bgOpacity > 0 ? bgOpacity : 0.75;
          const boxX = Math.round(((style.box?.x || 5) / 100) * (style.nativeW || 720));
          const boxY = Math.round(((style.box?.y || 78) / 100) * (style.nativeH || 1280));
          const boxW = Math.round(((style.box?.w || 90) / 100) * (style.nativeW || 720));
          const boxH = Math.round(((style.box?.h || 14) / 100) * (style.nativeH || 1280));
          vfFilter = `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${boxColor}@${boxAlpha}:t=fill,ass=${assPath}:fontsdir=${process.cwd()}`;
          console.log(`[render] vfFilter=${vfFilter.slice(0,100)}`);
        } else {
          vfFilter = `ass=${assPath}:fontsdir=${process.cwd()}`;
        }

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
        // Clean up input files
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

  // ── /api/render/:id/status ─────────────────────────────────────────────────
  app.get('/api/render/:id/status', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ status: job.status, error: job.error });
  });

  // ── /api/render/:id/download ───────────────────────────────────────────────
  app.get('/api/render/:id/download', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.status !== 'done' || !job.outputPath) {
      return res.status(404).json({ error: 'File not ready' });
    }
    res.download(job.outputPath, 'subflow_export.mp4', err => {
      if (err) console.error(`[render ${req.params.id}] download error:`, err);
      // cleanup after download
      try { fs.unlinkSync(job.outputPath!); } catch {}
      jobs.delete(req.params.id);
    });
  });

  // ── /api/transcribe ────────────────────────────────────────────────────────
  app.post('/api/transcribe', upload.single('video'), async (req, res) => {
    const tmpFiles: string[] = [];
    const cleanup = () => tmpFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });

    try {
      if (!req.file) return res.status(400).json({ error: 'Video file is required' });

      const targetLang = req.body.targetLang || 'original';
      const id = uuidv4();
      const inputPath = req.file.path;
      // 64 kbps / 16 kHz mono — Whisper sweet spot, half the data vs 128 kbps stereo
      const audioPath = `/tmp/${id}_audio.mp3`;
      tmpFiles.push(inputPath, audioPath);

      console.log(`[transcribe ${id}] Extracting audio...`);

      // Set fontconfig to _fonts directory (only TTF files, no noise)
      process.env.FONTCONFIG_PATH = path.join(process.cwd(), '_fonts');
      process.env.FC_FONT_PATH = path.join(process.cwd(), '_fonts');

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate(128)
          // NO audioFrequency() resampling — it shifts pts and causes progressive drift
          // aresample=async=1 fixes irregular pts from VFR sources (Instagram, TikTok, etc.)
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
        return res.status(400).json({ error: 'Audio too large for transcription (max ~10 min). Please use a shorter video.' });
      }


      // Step 1 — transcribe with retry on premature close
      let transcription: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: 'whisper-large-v3-turbo',
            response_format: 'verbose_json',
            timestamp_granularities: ['segment'],
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

      // Step 2 — split long segments (>5s) into smaller chunks using word timestamps
      const MAX_SEG_DURATION = 5; // seconds
      const splitSegments: Array<{ start: number; end: number; text: string }> = [];

      for (const seg of rawSegments) {
        const dur = seg.end - seg.start;
        if (dur <= MAX_SEG_DURATION) {
          splitSegments.push(seg);
          continue;
        }
        // Get words that belong to this segment
        const segWords = words.filter(w => w.start >= seg.start && w.end <= seg.end + 0.1);

        if (segWords.length === 0) {
          // No word timestamps — split by sentence punctuation or equal time chunks
          // Split by words into chunks of MAX_SEG_DURATION seconds
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

        // Group words into chunks of ~MAX_SEG_DURATION seconds
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

      // Step 3 — translate in batches of 20 to avoid LLM line-skipping on large inputs
      console.log(`[transcribe ${id}] targetLang=${targetLang} segments=${segments.length}`);
      if (targetLang !== 'original' && segments.length > 0) {
        console.log(`[transcribe ${id}] Translating ${segments.length} segments to ${targetLang}...`);

        const BATCH_SIZE = 15;
        const translationMap = new Map<number, string>();

        const translateBatch = async (batchSegments: typeof segments, offset: number) => {
          const numbered = batchSegments.map((s, i) => `${offset + i + 1}|||${s.text}`).join('\n');
          const chat = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'system',
                content: `Translate each subtitle line to ${targetLang}.
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

        // Process batches sequentially with retry
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

      // Enforce max 42 chars per line, 2 lines max — industry standard for subtitles
      const MAX_CHARS = 42;
      const finalSegments: typeof segments = [];
      for (const seg of segments) {
        const text = seg.text.trim();
        if (text.length <= MAX_CHARS * 2) {
          finalSegments.push(seg);
          continue;
        }
        // Split into chunks of MAX_CHARS chars by word boundary
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
        // Group into pairs (2 lines per subtitle)
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

      // Build final subtitle objects
      let subtitles = finalSegments
        .filter(s => s.text.trim().length > 0)
        .map(s => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
          confidence: 0.9,
        }));

      // Apply emphasis marking if requested
      if (req.body.emphasis === 'true' && subtitles.length > 0) {
        console.log(`[transcribe ${id}] Applying emphasis...`);
        try {
          const emphTexts = subtitles.map((s, i) => `${i + 1}|||${s.text}`).join('\n');
          const emphChat = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
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

  // ── /api/export/srt ────────────────────────────────────────────────────────
  app.post('/api/export/srt', (req, res) => {
    const { subtitles } = req.body;
    if (!Array.isArray(subtitles)) return res.status(400).json({ error: 'subtitles required' });
    res.setHeader('Content-Disposition', 'attachment; filename="subtitles.srt"');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(buildSrt(subtitles));
  });

  // ── /api/export/vtt ────────────────────────────────────────────────────────
  app.post('/api/export/vtt', (req, res) => {
    const { subtitles } = req.body;
    if (!Array.isArray(subtitles)) return res.status(400).json({ error: 'subtitles required' });
    const vtt = 'WEBVTT\n\n' + subtitles
      .map((sub: any, i: number) => {
        const fmt = (s: number) => formatSrtTime(s).replace(',', '.');
        return `${i + 1}\n${fmt(sub.start)} --> ${fmt(sub.end)}\n${sub.text}`;
      })
      .join('\n\n');
    res.setHeader('Content-Disposition', 'attachment; filename="subtitles.vtt"');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(vtt);
  });

  // ── Vite / static ──────────────────────────────────────────────────────────
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

  // Increase timeout for render requests (FFmpeg can take >30s)
  app.use((req, res, next) => {
    if (req.path === '/api/render') {
      req.socket.setTimeout(300000); // 5 minutes
      res.setTimeout(300000);
    }
    next();
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SubFlow server running on http://localhost:${PORT}`);
  });
}

startServer();
