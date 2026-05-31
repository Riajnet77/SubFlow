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

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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
function buildAss(subtitles: any[], style: any): string {
  const {
    fontName = 'Arial',
    fontSize = 26,
    primaryColor = '#FFFFFF',
    outlineColor = '#000000',
    bgOpacity = 0,
    box = { x: 5, y: 78, w: 90, h: 14 },
    browserW = 1280,
    browserH = 720,
    nativeW = 0,
    nativeH = 0,
  } = style;

  // Use native video resolution for ASS PlayRes so FFmpeg renders correctly.
  const playW = nativeW || browserW;
  const playH = nativeH || browserH;

  // fontSize is in preview screen px (e.g. 38px on a 605px tall preview).
  // ASS PlayRes = nativeW x nativeH, so we scale fontSize to native px:
  // scaledFontSize = fontSize * (nativeH / dispH)
  // browserH is sent as dispH from the frontend, so:
  const scaledFontSize = Math.round(fontSize * (playH / (browserH || playH)));

  // Convert CSS hex color to ASS &HAABBGGRR format
  const hexToAss = (hex: string, alpha = 0): string => {
    const c = hex.replace('#', '');
    const r = c.slice(0, 2);
    const g = c.slice(2, 4);
    const b = c.slice(4, 6);
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
    return `&H${a}${b}${g}${r}`.toUpperCase();
  };

  const primaryAss = hexToAss(primaryColor, 0);
  const outlineAss = hexToAss(outlineColor, 0);
  const backColour = hexToAss('#000000', bgOpacity > 0 ? bgOpacity : 1); // fully transparent if no bg

  // Box center in pixels
  const cx = Math.round(((box.x + box.w / 2) / 100) * playW);
  const cy = Math.round(((box.y + box.h / 2) / 100) * playH);

  // Shadow: 1 = drop shadow, 0 = no shadow
  const shadowDepth = style.preset === 'shadow' ? 3 : style.preset === 'neon' ? 0 : 1;
  // Outline width: 0 = no outline, higher = thicker
  const outlineWidth = bgOpacity > 0 ? 0 : 2;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playW}
PlayResY: ${playH}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${scaledFontSize},${primaryAss},${primaryAss},${outlineAss},${backColour},0,0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const assTime = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  };

  // Max chars per line based on box width and font size
  const charsPerLine = Math.floor((box.w / 100) * playW / (scaledFontSize * 0.55));

  const wrapText = (text: string): string => {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length > charsPerLine && line) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    if (line) lines.push(line);
    return lines.join('\N'); // \N is ASS hard line break
  };

  const events = subtitles
    .map(sub => {
      const posTag = `{\\pos(${cx},${cy})}`;
      return `Dialogue: 0,${assTime(sub.start)},${assTime(sub.end)},Default,,0,0,0,,${posTag}${wrapText(sub.text)}`;
    })
    .join('\n');

  return header + events + '\n';
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // ── /api/render ────────────────────────────────────────────────────────────
  app.post('/api/render', upload.single('video'), async (req, res) => {
    const tmpFiles: string[] = [];
    const cleanup = () => tmpFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });

    try {
      if (!req.file || !req.body.subtitles) {
        return res.status(400).json({ error: 'Video file and subtitles are required' });
      }

      const subtitles: any[] = JSON.parse(req.body.subtitles);
      const style = req.body.style ? JSON.parse(req.body.style) : {};

      const id = uuidv4();
      const inputPath = req.file.path;
      const assPath = `/tmp/${id}.ass`;
      const outputPath = `/tmp/${id}_output.mp4`;
      tmpFiles.push(inputPath, assPath, outputPath);

      // Write ASS subtitle file (better than SRT for styled subtitles)
      fs.writeFileSync(assPath, buildAss(subtitles, style));

      console.log(`[render ${id}] Starting encode...`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            // ── Speed optimisations for low-CPU environments ──────────────
            '-c:v libx264',
            '-preset ultrafast',   // fastest encode, bigger file — acceptable for exports
            '-crf 23',             // quality unchanged from source
            '-threads 1',          // single thread is faster than context-switching on 0.1 CPU
            '-tune fastdecode',    // skip b-frames analysis

            // ── Subtitle burn-in ──────────────────────────────────────────
            // ass filter with fontsdir fallback — avoids libass font scan stall
            `-vf ass=${assPath}`,

            // ── Audio: copy stream, never re-encode ───────────────────────
            '-c:a copy',

            // ── Container ─────────────────────────────────────────────────
            '-movflags +faststart', // moov atom at front — browser can stream before full download
            '-f mp4',
          ])
          .on('start', cmd => console.log(`[render ${id}] ffmpeg:`, cmd))
          .on('progress', p => console.log(`[render ${id}] progress: ${p.percent?.toFixed(1)}%`))
          .on('end', () => { console.log(`[render ${id}] Done`); resolve(); })
          .on('error', reject)
          .save(outputPath);
      });

      res.download(outputPath, 'subflow_export.mp4', err => {
        if (err) console.error(`[render ${id}] download error:`, err);
        cleanup();
      });

    } catch (e: any) {
      console.error('[render] Error:', e);
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: e.message || 'Rendering failed' });
    }
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

      console.log(`[transcribe ${id}] Audio ready. Sending to Groq Whisper...`);

      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      // Step 1 — transcribe with word-level timestamps for precise splitting
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-large-v3',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment', 'word'],
      });

      const rawSegments: Array<{ start: number; end: number; text: string }> =
        (transcription as any).segments ?? [];
      const words: Array<{ start: number; end: number; word: string }> =
        (transcription as any).words ?? [];

      // Step 2 — split long segments (>5s) into smaller chunks using word timestamps
      const MAX_SEG_DURATION = 5; // seconds
      const splitSegments: Array<{ start: number; end: number; text: string }> = [];

      for (const seg of rawSegments) {
        const dur = seg.end - seg.start;
        if (dur <= MAX_SEG_DURATION || words.length === 0) {
          splitSegments.push(seg);
          continue;
        }
        // Get words that belong to this segment
        const segWords = words.filter(w => w.start >= seg.start && w.end <= seg.end + 0.1);
        if (segWords.length === 0) { splitSegments.push(seg); continue; }

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
      if (targetLang !== 'original' && segments.length > 0) {
        console.log(`[transcribe ${id}] Translating ${segments.length} segments to ${targetLang}...`);

        const BATCH_SIZE = 20;
        const translationMap = new Map<number, string>();

        const translateBatch = async (batchSegments: typeof segments, offset: number) => {
          const numbered = batchSegments.map((s, i) => `${offset + i + 1}|||${s.text}`).join('\n');
          const chat = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'system',
                content: `Translate each subtitle line to ${targetLang}.
Each line starts with a number and ||| separator. Keep the exact same format.
Return ONLY the translated lines with their numbers, nothing else.
Example:
Input:  1|||Hello world
        2|||How are you
Output: 1|||Olá mundo
        2|||Como vai você`,
              },
              { role: 'user', content: numbered },
            ],
            temperature: 0.1,
            max_tokens: 2048,
          });
          const raw = chat.choices[0]?.message?.content ?? '';
          for (const line of raw.split('\n')) {
            const match = line.match(/^(\d+)\|\|\|(.+)$/);
            if (match) translationMap.set(parseInt(match[1]), match[2].trim());
          }
        };

        // Process batches sequentially
        for (let i = 0; i < segments.length; i += BATCH_SIZE) {
          const batch = segments.slice(i, i + BATCH_SIZE);
          try {
            await translateBatch(batch, i);
          } catch (e) {
            console.warn(`[transcribe ${id}] Batch ${i}-${i + BATCH_SIZE} failed, keeping original:`, e);
          }
        }

        segments = segments.map((s, i) => ({
          ...s,
          text: translationMap.get(i + 1) ?? s.text,
        }));
        console.log(`[transcribe ${id}] Translation OK: got ${translationMap.size} of ${segments.length}`);
      }

      // Build final subtitle objects
      const subtitles = segments
        .filter(s => s.text.trim().length > 0)
        .map(s => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
          confidence: 0.9,
        }));

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SubFlow server running on http://localhost:${PORT}`);
  });
}

startServer();
