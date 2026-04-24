import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

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

const UPLOAD_DIR = "/tmp/subflow_uploads";
const WORK_DIR = "/tmp/subflow_work";
[UPLOAD_DIR, WORK_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 500 * 1024 * 1024 } });

function cleanupFiles(...paths: string[]) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} }
}

function toSrtTime(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}

function buildSrt(subtitles: {start:number;end:number;text:string}[]): string {
  return subtitles.map((s,i) => `${i+1}\n${toSrtTime(s.start)} --> ${toSrtTime(s.end)}\n${s.text.trim()}`).join("\n\n") + "\n";
}

function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath).noVideo().audioCodec("libmp3lame").audioBitrate(128).audioChannels(1).audioFrequency(16000)
      .on("end", resolve).on("error", reject).save(outputPath);
  });
}

function hexToAss(hex: string): string {
  const h = hex.replace("#","").padEnd(6,"0");
  return `&H00${h.slice(4,6)}${h.slice(2,4)}${h.slice(0,2)}`.toUpperCase();
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // ─── /api/transcribe ──────────────────────────────────────────────────────
  app.post("/api/transcribe", upload.single("video"), async (req, res) => {
    const videoPath = req.file?.path ?? "";
    const audioPath = path.join(WORK_DIR, `${uuidv4()}_audio.mp3`);
    try {
      if (!req.file) { res.status(400).json({ error: "Video file is required." }); return; }

      const targetLang: string = (req.body.targetLang ?? "").trim();
      const groqApiKey = process.env.GROQ_API_KEY;
      if (!groqApiKey) { res.status(500).json({ error: "GROQ_API_KEY is not configured on the server." }); return; }

      const groq = new Groq({ apiKey: groqApiKey });

      console.log(`[transcribe] Extracting audio…`);
      await extractAudio(videoPath, audioPath);

      console.log(`[transcribe] Sending to Groq Whisper…`);
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });

      type Seg = { start:number; end:number; text:string; avg_logprob?:number };
      const segments: Seg[] = (transcription as any).segments ?? [];

      // Split long segments into ≤60 char blocks
      const splitSeg = (seg: Seg, conf: number) => {
        const text = seg.text.trim();
        if (text.length <= 60) return [{ start: seg.start, end: seg.end, text, confidence: conf }];
        const words = text.split(" ");
        const chunks: string[] = [];
        let cur = "";
        for (const w of words) {
          if ((cur + " " + w).trim().length <= 60) { cur = (cur + " " + w).trim(); }
          else { if (cur) chunks.push(cur); cur = w; }
        }
        if (cur) chunks.push(cur);
        const tpc = (seg.end - seg.start) / chunks.length;
        return chunks.map((t, i) => ({ start: seg.start + i*tpc, end: seg.start + (i+1)*tpc, text: t, confidence: conf }));
      };

      let subtitles = segments.flatMap(seg => {
        const conf = seg.avg_logprob ? Math.min(0.99, Math.max(0.5, Math.exp(seg.avg_logprob))) : 0.85;
        return splitSeg(seg, conf);
      });

      // Translate if requested
      const LANG_NAMES: Record<string,string> = {
        en:"English", pt:"Portuguese", es:"Spanish", fr:"French",
        de:"German", it:"Italian", ja:"Japanese", ko:"Korean",
        zh:"Chinese (Simplified)", ru:"Russian", ar:"Arabic", hi:"Hindi",
      };
      const langName = LANG_NAMES[targetLang] ?? targetLang;
      const needsTranslation = targetLang && targetLang.toLowerCase() !== "original";
      if (needsTranslation && subtitles.length > 0) {
        console.log(`[transcribe] Translating ${subtitles.length} lines to "${langName}" (code: ${targetLang})…`);
        const BATCH = 30;
        const allTexts = subtitles.map(s => s.text);
        const translated: string[] = [];

        for (let i = 0; i < allTexts.length; i += BATCH) {
          const batch = allTexts.slice(i, i + BATCH);
          try {
            const resp = await groq.chat.completions.create({
              model: "llama-3.3-70b-versatile",
              temperature: 0.1,
              max_tokens: 2048,
              messages: [
                {
                  role: "system",
                  content: `You are a subtitle translator. Translate each item to ${langName}. ` +
                    `Reply with ONLY a JSON array of strings. Same count as input. No extra text.`
                },
                { role: "user", content: JSON.stringify(batch) }
              ],
            });
            const raw = (resp.choices[0].message.content ?? "[]").replace(/```json|```/g,"").trim();
            const result: string[] = JSON.parse(raw);
            if (Array.isArray(result) && result.length === batch.length) {
              translated.push(...result);
              console.log(`[translate] batch ${Math.floor(i/BATCH)+1} OK`);
            } else {
              console.warn(`[translate] batch mismatch, keeping originals`);
              translated.push(...batch);
            }
          } catch(e) {
            console.error(`[translate] batch error:`, e);
            translated.push(...batch);
          }
        }

        if (translated.length === subtitles.length) {
          subtitles = subtitles.map((s, i) => ({ ...s, text: translated[i] ?? s.text }));
          console.log(`[transcribe] Translation complete`);
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

  // ─── /api/render ──────────────────────────────────────────────────────────
  app.post("/api/render", upload.single("video"), async (req, res) => {
    const videoPath = req.file?.path ?? "";
    const id = uuidv4();
    const assPath  = path.join(WORK_DIR, `${id}.ass`);
    const outputPath = path.join(WORK_DIR, `${id}_output.mp4`);
    try {
      if (!req.file || !req.body.subtitles) { res.status(400).json({ error: "Video and subtitles required." }); return; }

      const subtitles = JSON.parse(req.body.subtitles);
      if (!Array.isArray(subtitles) || subtitles.length === 0) { res.status(400).json({ error: "Empty subtitles." }); return; }

      const style = req.body.style ? JSON.parse(req.body.style) : {};
      const fontSize     = Number(style.fontSize ?? 18);
      const fontName     = String(style.fontName ?? "Arial");
      const primaryColor = String(style.primaryColor ?? "#FFFFFF");
      const outlineColor = String(style.outlineColor ?? "#000000");
      const bgOpacity    = Number(style.bgOpacity ?? 0);
      const box          = style.box ?? { x: 5, y: 78, w: 90, h: 14 };

      // 1. Get actual video dimensions via ffprobe
      const probeData: {width:number;height:number} = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err: any, data: any) => {
          if (err) return reject(err);
          const vs = data.streams?.find((s:any) => s.codec_type === "video");
          resolve({ width: vs?.width ?? 1080, height: vs?.height ?? 1920 });
        });
      });
      const VW = probeData.width;
      const VH = probeData.height;
      console.log(`[render] Video: ${VW}x${VH}, fontSize: ${fontSize}`);

      // 2. Convert hex to ASS color (&H00BBGGRR)
      const hexToAss = (hex: string) => {
        const h = hex.replace("#","").padEnd(6,"0");
        return `&H00${h.slice(4,6)}${h.slice(2,4)}${h.slice(0,2)}`.toUpperCase();
      };

      // 3. Calculate pixel positions from box % of video dimensions
      const boxX = Math.round((box.x / 100) * VW);
      const boxY = Math.round((box.y / 100) * VH);
      const boxW = Math.round((box.w / 100) * VW);
      const boxH = Math.round((box.h / 100) * VH);
      const boxCenterY = box.y + box.h / 2;

      // ASS alignment: 2=bottom-center, 5=middle-center, 8=top-center
      let alignment = 2, marginV = 0, marginL = 0, marginR = 0;
      if (boxCenterY < 38) {
        alignment = 8;
        marginV = boxY;
      } else if (boxCenterY > 62) {
        alignment = 2;
        marginV = VH - boxY - boxH;
      } else {
        alignment = 5;
        marginV = 0;
      }
      marginL = boxX;
      marginR = VW - boxX - boxW;

      // 4. Background color with opacity
      const bgAlpha = Math.round((1 - bgOpacity) * 255).toString(16).padStart(2,"0").toUpperCase();
      const backColour = `&H${bgAlpha}000000`;
      const borderStyle = bgOpacity > 0 ? 4 : 1;
      const outline     = bgOpacity > 0 ? 0 : Math.round(fontSize * 0.08);

      // 5. Build proper ASS file with PlayRes = actual video dimensions (1:1 pixel mapping)
      const assToTime = (sec: number) => {
        const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60),
              s = Math.floor(sec%60),   cs = Math.round((sec%1)*100);
        return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
      };

      const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${VW}
PlayResY: ${VH}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,${fontName},${fontSize},${hexToAss(primaryColor)},${hexToAss(primaryColor)},${hexToAss(outlineColor)},${backColour},0,0,0,0,100,100,0,0,${borderStyle},${outline},0,${alignment},${Math.max(0,marginL)},${Math.max(0,marginR)},${Math.max(0,marginV)},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
      const assEvents = subtitles.map((s:any) =>
        `Dialogue: 0,${assToTime(s.start)},${assToTime(s.end)},Default,,0,0,0,,${String(s.text).replace(/\n/g,"\N").trim()}`
      ).join("\n");

      fs.writeFileSync(assPath, assHeader + assEvents, "utf8");

      // 6. Burn with ffmpeg using ASS filter (pixel-accurate)
      const escapedAss = assPath.replace(/\\/g,"/").replace(/:/g,"\:");
      console.log(`[render] Burning subtitles: align=${alignment} marginV=${marginV} marginL=${marginL} marginR=${marginR}`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(videoPath).videoCodec("libx264")
          .outputOptions([
            `-vf ass='${escapedAss}'`,
            "-preset veryfast", "-crf 23", "-movflags +faststart",
          ])
          .audioCodec("aac").audioBitrate("128k")
          .on("end", resolve)
          .on("error", reject)
          .save(outputPath);
      });

      console.log(`[render] Done.`);
      res.download(outputPath, "subflow_export.mp4", () => { cleanupFiles(videoPath, assPath, outputPath); });
    } catch (err: any) {
      console.error("[render] Error:", err?.message ?? err);
      cleanupFiles(videoPath, assPath, outputPath);
      if (!res.headersSent) res.status(500).json({ error: err?.message ?? "Render failed." });
    }
  });

    // ─── /api/export/srt ──────────────────────────────────────────────────────
  app.post("/api/export/srt", (req, res) => {
    try {
      const { subtitles } = req.body;
      if (!Array.isArray(subtitles)) { res.status(400).json({ error: "subtitles required." }); return; }
      res.setHeader("Content-Type","text/plain; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="subtitles.srt"');
      res.send(buildSrt(subtitles));
    } catch(e:any) { res.status(500).json({ error: e?.message }); }
  });

  // ─── /api/export/vtt ──────────────────────────────────────────────────────
  app.post("/api/export/vtt", (req, res) => {
    try {
      const { subtitles } = req.body;
      if (!Array.isArray(subtitles)) { res.status(400).json({ error: "subtitles required." }); return; }
      const vtt = "WEBVTT\n\n" + subtitles.map((s:any,i:number) =>
        `${i+1}\n${toSrtTime(s.start).replace(",",".")} --> ${toSrtTime(s.end).replace(",",".")}\n${s.text.trim()}`
      ).join("\n\n") + "\n";
      res.setHeader("Content-Type","text/vtt; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="subtitles.vtt"');
      res.send(vtt);
    } catch(e:any) { res.status(500).json({ error: e?.message }); }
  });

  // ─── Vite / static ────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get(/^(?!\/api\/).*$/, (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`\n🎬 SubFlow → http://localhost:${PORT}\n`));
}

startServer().catch(err => { console.error("Failed to start:", err); process.exit(1); });
