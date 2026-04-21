import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import Groq from "groq-sdk";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Ensure temp upload dir exists
const UPLOAD_DIR = "/tmp/subflow_uploads";
const WORK_DIR = "/tmp/subflow_work";
[UPLOAD_DIR, WORK_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB max

// Helper: safely delete a list of files
function cleanupFiles(...paths: string[]) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
  }
}

// Helper: format seconds → SRT timestamp
function toSrtTime(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// Helper: generate SRT content from subtitle array
function buildSrt(subtitles: { start: number; end: number; text: string }[]): string {
  return subtitles
    .map((sub, i) => `${i + 1}\n${toSrtTime(sub.start)} --> ${toSrtTime(sub.end)}\n${sub.text.trim()}`)
    .join("\n\n") + "\n";
}

// Helper: extract audio from video with ffmpeg
function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate(128)
      .audioChannels(1) // mono saves space
      .audioFrequency(16000) // Whisper works best at 16kHz
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // ─── /api/transcribe ──────────────────────────────────────────────────────────
  // Accepts: multipart/form-data with `video` file + `targetLang` (optional, default: original language)
  // Returns: { subtitles: [{ start, end, text, confidence }] }
  app.post("/api/transcribe", upload.single("video"), async (req, res) => {
    const videoPath = req.file?.path ?? "";
    const audioPath = path.join(WORK_DIR, `${uuidv4()}_audio.mp3`);

    try {
      if (!req.file) {
        res.status(400).json({ error: "Video file is required." });
        return;
      }

      const targetLang: string = req.body.targetLang ?? "";
      const groqApiKey = process.env.GROQ_API_KEY;

      if (!groqApiKey) {
        res.status(500).json({ error: "GROQ_API_KEY is not configured on the server." });
        return;
      }

      const groq = new Groq({ apiKey: groqApiKey });

      // 1. Extract audio
      console.log(`[transcribe] Extracting audio from ${req.file.originalname}…`);
      await extractAudio(videoPath, audioPath);

      // 2. Transcribe with Groq Whisper (with word-level timestamps)
      console.log(`[transcribe] Sending to Groq Whisper…`);

      const whisperParams: Parameters<typeof groq.audio.transcriptions.create>[0] = {
        file: fs.createReadStream(audioPath),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
        ...(targetLang && targetLang.toLowerCase() !== "original"
          ? { language: undefined } // let whisper auto-detect, translate separately
          : {}),
      };

      const transcription = await groq.audio.transcriptions.create(whisperParams);

      // 3. Map Whisper segments → subtitle objects
      type Segment = { start: number; end: number; text: string; avg_logprob?: number };
      const segments: Segment[] = (transcription as any).segments ?? [];

      let subtitles = segments.map((seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
        confidence: seg.avg_logprob ? Math.min(0.99, Math.max(0.50, Math.exp(seg.avg_logprob))) : 0.85,
      }));

      // 4. Optional: translate to target language using Groq LLM (free)
      if (targetLang && targetLang.toLowerCase() !== "original" && subtitles.length > 0) {
        console.log(`[transcribe] Translating to ${targetLang}…`);
        const texts = subtitles.map((s) => s.text);

        const chatResponse = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: `You are a professional subtitle translator. Translate each subtitle line to ${targetLang}. Preserve line breaks. Return ONLY a JSON array of translated strings, same order and count as input. No explanation.`,
            },
            {
              role: "user",
              content: JSON.stringify(texts),
            },
          ],
          temperature: 0.2,
          max_tokens: 4096,
        });

        try {
          const raw = chatResponse.choices[0].message.content ?? "[]";
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const translated: string[] = JSON.parse(cleaned);
          if (Array.isArray(translated) && translated.length === subtitles.length) {
            subtitles = subtitles.map((s, i) => ({ ...s, text: translated[i] ?? s.text }));
          }
        } catch (e) {
          console.warn("[transcribe] Translation parse failed, keeping original text.");
        }
      }

      res.json({ subtitles });
    } catch (err: any) {
      console.error("[transcribe] Error:", err?.message ?? err);
      res.status(500).json({ error: err?.message ?? "Transcription failed." });
    } finally {
      cleanupFiles(videoPath, audioPath);
    }
  });

  // ─── /api/render ──────────────────────────────────────────────────────────────
  // Accepts: multipart/form-data with `video` file + `subtitles` JSON string
  // Returns: .mp4 with burned-in subtitles
  app.post("/api/render", upload.single("video"), async (req, res) => {
    const videoPath = req.file?.path ?? "";
    const id = uuidv4();
    const srtPath = path.join(WORK_DIR, `${id}.srt`);
    const outputPath = path.join(WORK_DIR, `${id}_output.mp4`);

    try {
      if (!req.file || !req.body.subtitles) {
        res.status(400).json({ error: "Video file and subtitles are required." });
        return;
      }

      const subtitles = JSON.parse(req.body.subtitles);
      if (!Array.isArray(subtitles) || subtitles.length === 0) {
        res.status(400).json({ error: "Subtitles must be a non-empty array." });
        return;
      }

      // Write SRT file
      fs.writeFileSync(srtPath, buildSrt(subtitles));

      // Burn subtitles with ffmpeg
      // Escape the srt path for the subtitles filter (handles spaces & special chars)
      const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");

      console.log(`[render] Encoding ${req.file.originalname}…`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(videoPath)
          .videoCodec("libx264")
          .outputOptions([
            `-vf subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=3,Outline=1,Shadow=1'`,
            "-preset veryfast",
            "-crf 23",
            "-movflags +faststart",
          ])
          .audioCodec("aac")
          .audioBitrate("128k")
          .on("end", resolve)
          .on("error", reject)
          .save(outputPath);
      });

      console.log(`[render] Done. Sending file…`);

      res.download(outputPath, "subflow_export.mp4", () => {
        cleanupFiles(videoPath, srtPath, outputPath);
      });
    } catch (err: any) {
      console.error("[render] Error:", err?.message ?? err);
      cleanupFiles(videoPath, srtPath, outputPath);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message ?? "Render failed." });
      }
    }
  });

  // ─── /api/export/srt ─────────────────────────────────────────────────────────
  // Quick SRT download without re-rendering the video
  app.post("/api/export/srt", (req, res) => {
    try {
      const { subtitles } = req.body;
      if (!Array.isArray(subtitles)) {
        res.status(400).json({ error: "subtitles array required." });
        return;
      }
      const srt = buildSrt(subtitles);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="subtitles.srt"');
      res.send(srt);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ─── /api/export/vtt ─────────────────────────────────────────────────────────
  app.post("/api/export/vtt", (req, res) => {
    try {
      const { subtitles } = req.body;
      if (!Array.isArray(subtitles)) {
        res.status(400).json({ error: "subtitles array required." });
        return;
      }
      const vtt =
        "WEBVTT\n\n" +
        subtitles
          .map((s, i) => {
            const toVttTime = (sec: number) => toSrtTime(sec).replace(",", ".");
            return `${i + 1}\n${toVttTime(s.start)} --> ${toVttTime(s.end)}\n${s.text.trim()}`;
          })
          .join("\n\n") +
        "\n";

      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="subtitles.vtt"');
      res.send(vtt);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ─── Vite / static serving ────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Only catch non-API routes for SPA fallback
    app.get(/^(?!\/api\/).*$/, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🎬 SubFlow running → http://localhost:${PORT}\n`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
