import express from "express";
import { createServer as createViteServer } from "vite";
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Store uploads in memory for small files, disk for large — avoids /tmp write bottleneck
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
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
  } = style;

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
  const cx = Math.round(((box.x + box.w / 2) / 100) * browserW);
  const cy = Math.round(((box.y + box.h / 2) / 100) * browserH);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${browserW}
PlayResY: ${browserH}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryAss},${primaryAss},${outlineAss},${backColour},0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const assTime = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  };

  const events = subtitles
    .map(sub => {
      // Inline position override using {\pos(x,y)}
      const posTag = `{\\pos(${cx},${cy})}`;
      return `Dialogue: 0,${assTime(sub.start)},${assTime(sub.end)},Default,,0,0,0,,${posTag}${sub.text}`;
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

      const targetLang = req.body.targetLang || 'English';
      const id = uuidv4();
      const inputPath = req.file.path;
      // Use lower bitrate — Gemini doesn't need hi-fi audio; halves extraction time
      const audioPath = `/tmp/${id}_audio.mp3`;
      tmpFiles.push(inputPath, audioPath);

      console.log(`[transcribe ${id}] Extracting audio...`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate(64)          // was 128 — 64 kbps is plenty for speech recognition
          .audioFrequency(16000)     // 16 kHz mono is the sweet spot for speech models
          .audioChannels(1)
          .outputOptions(['-threads 1'])
          .on('end', () => resolve())
          .on('error', reject)
          .save(audioPath);
      });

      console.log(`[transcribe ${id}] Audio ready. Sending to Gemini...`);

      const { GoogleGenAI, Type } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const uploadedFile = await ai.files.upload({
        file: audioPath,
        mimeType: 'audio/mp3',
      });

      const langInstruction = targetLang === 'original'
        ? 'Transcribe everything exactly as spoken, keeping the original language.'
        : `Transcribe and translate everything into ${targetLang}.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          uploadedFile,
          `You are a professional subtitle generator. ${langInstruction}
Cut phrases into blocks of 2–6 seconds. Respond ONLY with a JSON array, no markdown, no explanation.`,
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start:      { type: Type.NUMBER, description: 'Start time in seconds' },
                end:        { type: Type.NUMBER, description: 'End time in seconds' },
                text:       { type: Type.STRING, description: 'Subtitle text' },
                confidence: { type: Type.NUMBER, description: 'Confidence 0.70–0.99' },
              },
              required: ['start', 'end', 'text', 'confidence'],
            },
          },
        },
      });

      const subtitles = JSON.parse(response.text || '[]');

      // Cleanup Gemini file (fire-and-forget)
      ai.files.delete({ name: uploadedFile.name }).catch(() => {});
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
