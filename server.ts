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

const upload = multer({ dest: '/tmp/uploads/' });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Route for Video Rendering
  app.post('/api/render', upload.single('video'), async (req, res) => {
    try {
      const subtitlesJson = req.body.subtitles;
      if (!req.file || !subtitlesJson) {
        return res.status(400).json({ error: 'Video file and subtitles are required' });
      }

      const subtitles = JSON.parse(subtitlesJson);
      if (!Array.isArray(subtitles)) {
        return res.status(400).json({ error: 'Subtitles must be an array' });
      }

      const inputVideoPath = req.file.path;
      const id = uuidv4();
      const srtPath = `/tmp/${id}.srt`;
      const outputVideoPath = `/tmp/${id}_output.mp4`;

      // Generate SRT content
      let srtContent = '';
      subtitles.forEach((sub, i) => {
        const formatTime = (seconds: number) => {
          const date = new Date(seconds * 1000);
          const hh = String(date.getUTCHours()).padStart(2, '0');
          const mm = String(date.getUTCMinutes()).padStart(2, '0');
          const ss = String(date.getUTCSeconds()).padStart(2, '0');
          const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
          return `${hh}:${mm}:${ss},${ms}`;
        };
        srtContent += `${i + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${sub.text}\n\n`;
      });

      fs.writeFileSync(srtPath, srtContent);

      // We need to use a filter syntax for subtitles. 
      // fluent-ffmpeg handles complex filters.
      // Easiest is using vf subtitles filter but it must be an absolute path and needs escaping for windows/linux.
      // Since container is linux:
      
      console.log(`Starting encode for ${id}...`);

      ffmpeg(inputVideoPath)
        .videoCodec('libx264')
        // burn subtitles using subtitles filter
        .outputOptions([
           `-vf subtitles=${srtPath}`,
           // hardware accel if available or just veryfast to save time
           `-preset veryfast` 
        ])
        .on('end', () => {
          console.log(`Encode finished for ${id}`);
          
          res.download(outputVideoPath, 'rendered_video.mp4', (err) => {
            // cleanup temp files
            if (fs.existsSync(inputVideoPath)) fs.unlinkSync(inputVideoPath);
            if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
            if (fs.existsSync(outputVideoPath)) fs.unlinkSync(outputVideoPath);
          });
        })
        .on('error', (err) => {
          console.error(`Error encoding ${id}:`, err);
          if (fs.existsSync(inputVideoPath)) fs.unlinkSync(inputVideoPath);
          if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
          return res.status(500).json({ error: 'Rendering failed' });
        })
        .save(outputVideoPath);

    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Internal server error processing video' });
    }
  });

  // API Route for Real Video Transcription using Gemini
  app.post('/api/transcribe', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Video file is required' });
      }

      const targetLang = req.body.targetLang || 'English';
      const inputVideoPath = req.file.path;
      const id = uuidv4();
      const audioPath = `/tmp/${id}_audio.mp3`;

      console.log(`Extracting audio for ${id}...`);

      // 1. Extract audio from video
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputVideoPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate(128)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(audioPath);
      });

      console.log(`Audio extracted. Sending to Gemini...`);

      // 2. Upload audio to Gemini and process
      const { GoogleGenAI, Type } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const uploadedFile = await ai.files.upload({
        file: audioPath,
        mimeType: 'audio/mp3'
      });

      const prompt = `You are a professional video translator and subtitle generator. 
      Listen to the provided audio. Transcribe and translate EVERYTHING spoken in the audio into ${targetLang}.
      Cut the phrases into small subtitle blocks (usually 2 to 6 seconds).
      Provide the response strictly as a JSON array.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          uploadedFile,
          prompt
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER, description: "Start time in seconds" },
                end: { type: Type.NUMBER, description: "End time in seconds" },
                text: { type: Type.STRING, description: "Spoken text" },
                confidence: { type: Type.NUMBER, description: "Confidence score between 0.70 and 0.99" }
              },
              required: ["start", "end", "text", "confidence"]
            }
          }
        }
      });

      const generatedData = JSON.parse(response.text || '[]');

      // Cleanup
      if (fs.existsSync(inputVideoPath)) fs.unlinkSync(inputVideoPath);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

      // We should also delete from gemini files to not clutter, but SDK supports it
      try {
        await ai.files.delete({ name: uploadedFile.name });
      } catch (e) {
        console.log('Failed to delete gemini file', e);
      }

      res.json({ subtitles: generatedData });

    } catch (e) {
      console.error('Transcription error:', e);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Internal server error processing transcription' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
