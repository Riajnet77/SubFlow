import express from "express";
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Groq from 'groq-sdk';

const modernFfmpegPath = path.join(process.cwd(), 'ffmpeg-linux');
if (fs.existsSync(modernFfmpegPath)) { fs.chmodSync(modernFfmpegPath, '755'); ffmpeg.setFfmpegPath(modernFfmpegPath); }
else { ffmpeg.setFfmpegPath(ffmpegInstaller.path); }

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const fontsDir = path.join(process.cwd(), '_fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);
const homeFontsDir = path.join(process.env.HOME || '/root', '.fonts');
if (!fs.existsSync(homeFontsDir)) fs.mkdirSync(homeFontsDir, { recursive: true });

const rootFiles = fs.readdirSync(process.cwd()).filter(f => f.toUpperCase().endsWith('.TTF'));
for (const f of rootFiles) {
  const src = path.join(process.cwd(), f);
  const cleanName = f.replace(/^\d+_/, '');
  fs.copyFileSync(src, path.join(fontsDir, cleanName));
  fs.copyFileSync(src, path.join(homeFontsDir, cleanName));
}
try { require('child_process').execSync('fc-cache -f ' + homeFontsDir, { timeout: 10000 }); } catch(e) {}

const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 150 * 1024 * 1024 } });

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60), ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function buildSrt(subtitles: any[]): string {
  return subtitles.map((sub, i) => `${i+1}\n${formatSrtTime(sub.start)} --> ${formatSrtTime(sub.end)}\n${sub.text}\n`).join('\n');
}

async function applyEmphasis(subtitles: any[], groqClient: any): Promise<any[]> {
  try {
    const texts = subtitles.map((s, i) => `${i+1}|||${s.text}`).join('\n');
    const chat = await groqClient.chat.completions.create({
      model: 'gemma2-9b-it',
      messages: [
        { role: 'system', content: 'Wrap 1-2 key words in **asterisks**. Keep format NUMBER|||TEXT.' },
        { role: 'user', content: texts },
      ],
      temperature: 0.1, max_tokens: 2048,
    });
    const raw = chat.choices[0]?.message?.content ?? '';
    const emphasisMap = new Map<number, string>();
    for (const line of raw.split('\n')) {
      const match = line.match(/^(\d+)\|\|\|(.+)$/);
      if (match) emphasisMap.set(parseInt(match[1]), match[2].trim());
    }
    return subtitles.map((s, i) => ({ ...s, text: emphasisMap.get(i+1) ?? s.text }));
  } catch (e) { console.warn('[emphasis] Failed:', e); return subtitles; }
}

function buildAss(subtitles: any[], style: any): string {
  const {
    fontName: rawFontName = 'Arial', fontSize = 26, primaryColor = '#FFFFFF',
    outlineColor = '#000000', bgOpacity = 0, box = { x: 5, y: 78, w: 90, h: 14 },
    browserH = 720, nativeW = 0, nativeH = 0,
  } = style;

  const playW = nativeW || 1280;
  const playH = nativeH || 720;
  const REF_H = 1080;
  const scaledFontSize = Math.max(8, Math.round(fontSize * (playH / REF_H)));

  const hexToAss = (hex: string, alpha = 0): string => {
    const c = hex.replace('#', '').padEnd(6, '0');
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
    return `&H${a}${c.slice(4,6)}${c.slice(2,4)}${c.slice(0,2)}`.toUpperCase();
  };

  const FONT_MAP: Record<string, string> = {
    'Impact': 'IMPACT', 'Arial': 'ARIAL', 'Georgia': 'GEORGIA',
    'Verdana': 'VERDANA', 'Trebuchet MS': 'TREBUC', 'Tahoma': 'TAHOMA', 'Courier New': 'COUR',
  };
  const fontName = FONT_MAP[rawFontName] || rawFontName;
  const primaryAss = hexToAss(primaryColor, 0);
  const outlineAss = hexToAss(outlineColor, 0);
  const backColourFinal = hexToAss('#000000', bgOpacity > 0 ? bgOpacity : 0.6);
  const impactPresets = ['impact','bold','fire','shadow','karaoke','retro','purple','reels','viral','podcast'];
  const isBold = impactPresets.includes(style.preset) || fontName === 'Impact' ? '-1' : '0';
  const shadowDepth = bgOpacity > 0 ? 3 : style.preset === 'shadow' ? 3 : style.preset === 'clean' ? 4 : style.preset === 'matrix' ? 2 : style.preset === 'neon' ? 0 : 0;
  const outlineWidth = bgOpacity > 0 ? 10 : style.preset === 'minimal' ? 1 : style.preset === 'clean' ? 0.5 : style.preset === 'viral' ? 4 : style.preset === 'neon' ? 3 : style.preset === 'bold' ? 3 : 2;
  const borderStyle = bgOpacity > 0 ? 3 : 1;
  const marginL = Math.round((box.x / 100) * playW);
  const marginR = Math.round(((100 - box.x - box.w) / 100) * playW);
  const marginV = Math.round(((100 - box.y - box.h) / 100) * playH);

  const assTime = (s: number): string => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
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
Style: Default,${fontName},${scaledFontSize},${primaryAss},&H00FFFFFF,${outlineAss},${backColourFinal},${isBold},0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowDepth},2,${marginL},${marginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const emphasisBigSize = Math.round(scaledFontSize * 2.4);
  const emphasisSmallSize = Math.max(6, Math.round(scaledFontSize * 0.8));
  // FIX: as tags do .ass precisam de UMA barra invertida literal no arquivo final
  // (\b, \fs, \k, \an, \pos, \p1, \p0). Dentro de uma template string do JS, uma
  // barra invertida simples é interpretada como caractere de controle ou é
  // silenciosamente descartada (\b = backspace, \f = form feed, \a e \p não são
  // escapes válidos em JS e perdem a barra). Por isso agora usamos \\ (barra dupla
  // no código-fonte) em toda tag — assim o JS produz uma barra simples de verdade
  // na string final, que é o que o libass/ffmpeg espera.
  const formatEmphasis = (text: string): string => {
    if (!text.includes('**')) return text;
    return text.split(/(\*\*[^*]+\*\*)/).map(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return `{\\b1\\fs${emphasisBigSize}}${part.slice(2,-2)}{\\b0\\fs${scaledFontSize}}`;
      }
      return part ? `{\\fs${emphasisSmallSize}}${part}` : part;
    }).join('');
  };

  const approximateWords = (sub: any): Array<{word:string,start:number,end:number}> => {
    const wordList = String(sub.text).replace(/\*\*/g,'').trim().split(/\s+/).filter(Boolean);
    if (wordList.length === 0) return [];
    const totalChars = wordList.reduce((a:number,w:string)=>a+w.length,0)||1;
    const duration = sub.end - sub.start;
    let t = sub.start;
    return wordList.map((w:string)=>{const dur=duration*(w.length/totalChars);const entry={word:w,start:t,end:t+dur};t+=dur;return entry;});
  };

  const buildKaraokeLines = (sub: any): string[] => {
    const wordsData = (sub.words && sub.words.length > 0) ? sub.words : approximateWords(sub);
    if (wordsData.length === 0) return [];
    const lines: string[] = [];
    for (let i = 0; i < wordsData.length; i += 2) {
      const chunk = wordsData.slice(i, i + 2);
      const nextChunkStart = wordsData[i + 2]?.start;
      const chunkStart = chunk[0].start;
      const chunkEnd = nextChunkStart ?? chunk[chunk.length - 1].end;
      let prevEnd = chunkStart, text = '';
      for (const w of chunk) {
        const durCs = Math.max(1, Math.round((w.end - prevEnd) * 100));
        text += `{\\k${durCs}}${String(w.word).trim().toUpperCase()} `;
        prevEnd = w.end;
      }
      lines.push(`Dialogue: 1,${assTime(chunkStart)},${assTime(chunkEnd)},Default,,0,0,0,,${text.trim()}`);
    }
    return lines;
  };

  const events = subtitles.flatMap(rawSub => {
    // FIX: o formato .ass exige que cada legenda seja UMA linha física no arquivo.
    // Se o texto tiver uma quebra de linha (\n) — vinda da tradução da IA ou de
    // edição manual no editor — ela corta o Dialogue no meio e o ffmpeg/libass só
    // renderiza a parte antes da quebra, cortando o resto da legenda. Sanitizamos
    // aqui trocando qualquer quebra de linha por espaço, garantindo uma linha só.
    const sub = { ...rawSub, text: String(rawSub.text).replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim() };
    if (style.preset === 'viral') return buildKaraokeLines(sub);
    return [`Dialogue: 1,${assTime(sub.start)},${assTime(sub.end)},Default,,,,,,${formatEmphasis(sub.text)}`];
  }).join('\n');

  return header + events + '\n';

}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const frontendUrl = process.env.FRONTEND_URL;
  app.use(cors(frontendUrl ? { origin: frontendUrl } : {}));
  app.use(express.json());

  type JobStatus = 'processing' | 'done' | 'error';
  const jobs = new Map<string, { status: JobStatus; error?: string; outputPath?: string }>();

  app.post('/api/emphasis', express.json(), async (req, res) => {
    try {
      const { subtitles } = req.body;
      if (!Array.isArray(subtitles)) return res.status(400).json({ error: 'subtitles required' });
      const result = await applyEmphasis(subtitles, groq);
      res.json({ subtitles: result });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/render', upload.single('video'), async (req, res) => {
    if (!req.file || !req.body.subtitles) return res.status(400).json({ error: 'Video file and subtitles are required' });
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
        // Detecta as dimensões REAIS do vídeo (como o ffmpeg vai decodificar, antes
        // de qualquer rotação) via ffprobe, em vez de confiar cegamente no
        // videoWidth/videoHeight que o navegador reportou. Vídeos gravados em
        // celular no modo retrato costumam ser codificados como "paisagem" com uma
        // tag de rotação de 90°/270° que o player aplica na exibição — se o filtro
        // \`ass\` do ffmpeg desenhar usando as dimensões pós-rotação (as que o
        // navegador vê) mas operar sobre o frame bruto pré-rotação, a legenda é
        // posicionada fora da área visível e simplesmente não aparece.
        // Detecta as dimensões REAIS do vídeo (como o ffmpeg vai decodificar, antes
        // de qualquer rotação) via ffprobe, em vez de confiar cegamente no
        // videoWidth/videoHeight que o navegador reportou. Vídeos gravados em
        // celular no modo retrato costumam ser codificados como "paisagem" com uma
        // tag de rotação de 90°/270° que o player aplica na exibição — se o filtro
        // `ass` do ffmpeg desenhar usando as dimensões pós-rotação (as que o
        // navegador vê) mas operar sobre o frame bruto pré-rotação, a legenda é
        // posicionada fora da área visível e simplesmente não aparece.
        //
        // FIX: além disso, vídeos exportados de apps de legendagem (CapCut e afins)
        // frequentemente têm MAIS DE UMA stream de vídeo no MP4 — normalmente uma
        // imagem de capa/thumbnail (disposition "attached_pic") além do vídeo real.
        // A seleção antiga (`-select_streams v:0`) sempre pegava a PRIMEIRA stream
        // de vídeo, que pode muito bem ser essa thumbnail — o filtro `ass` seria
        // aplicado nela (um frame único) e a legenda nunca apareceria no vídeo de
        // verdade. Agora inspecionamos TODAS as streams de vídeo e escolhemos
        // explicitamente a real (attached_pic=0, maior duração).
        const probeVideoStreams = (videoPath: string): Promise<{ index: number; width: number; height: number; rotation: number }> =>
          new Promise((resolve) => {
            const { execFile } = require('child_process');
            execFile('ffprobe', [
              '-v', 'error',
              '-select_streams', 'v',
              '-show_entries', 'stream=index,width,height,duration:stream_tags=rotate:stream_disposition=attached_pic:side_data_list',
              '-of', 'json',
              videoPath,
            ], (err: any, stdout: string) => {
              if (err) { console.warn(`[render ${id}] ffprobe failed:`, err.message); return resolve({ index: 0, width: 0, height: 0, rotation: 0 }); }
              try {
                const info = JSON.parse(stdout);
                const streams: any[] = info.streams ?? [];
                console.log(`[render ${id}] ffprobe encontrou ${streams.length} stream(s) de vídeo:`, streams.map(s => ({ index: s.index, w: s.width, h: s.height, duration: s.duration, attached_pic: s.disposition?.attached_pic })));
                // Prioriza streams que NÃO são thumbnail (attached_pic=0); entre essas,
                // pega a de maior duração informada (a "real"). Se nenhuma tiver
                // duration, cai pra primeira não-attached_pic; se todas forem
                // attached_pic (caso raro), usa a primeira mesmo.
                const real = streams.filter(s => !s.disposition?.attached_pic);
                const candidates = real.length > 0 ? real : streams;
                const chosen = candidates.reduce((best, s) => {
                  const bestDur = parseFloat(best?.duration ?? '0') || 0;
                  const curDur = parseFloat(s.duration ?? '0') || 0;
                  return curDur > bestDur ? s : (best ?? s);
                }, candidates[0]);
                const width = chosen?.width ?? 0;
                const height = chosen?.height ?? 0;
                let rotation = parseInt(chosen?.tags?.rotate ?? '0', 10) || 0;
                const rotateSideData = (chosen?.side_data_list ?? []).find((sd: any) => typeof sd.rotation === 'number');
                if (rotateSideData) rotation = Math.abs(rotateSideData.rotation) % 360;
                // O "index" do stream escolhido é a posição dele DENTRO das streams de
                // vídeo (0ª, 1ª, ...), que é o que o seletor -map 0:v:N do ffmpeg espera
                // — não o índice global do container.
                const videoOnlyIndex = streams.indexOf(chosen);
                resolve({ index: videoOnlyIndex >= 0 ? videoOnlyIndex : 0, width, height, rotation });
              } catch (e) {
                console.warn(`[render ${id}] ffprobe parse failed:`, e);
                resolve({ index: 0, width: 0, height: 0, rotation: 0 });
              }
            });
          });

        const probed = await probeVideoStreams(inputPath);
        console.log(`[render ${id}] Stream de vídeo real escolhida: index 0:v:${probed.index}, ${probed.width}x${probed.height}, rotation=${probed.rotation}`);
        console.log(`[render ${id}] style enviado pelo navegador: nativeW=${style.nativeW} nativeH=${style.nativeH}`);

        // Se a rotação for de 90 ou 270 graus, o frame bruto que o filtro \`ass\`
        // enxerga tem largura/altura TROCADAS em relação ao que aparece na tela
        // depois de rotacionado. Ajustamos playW/playH pra bater com o frame bruto.
        const isSideways = probed.rotation === 90 || probed.rotation === 270 || probed.rotation === -90 || probed.rotation === -270;
        const effectiveStyle = { ...style };
        if (probed.width > 0 && probed.height > 0) {
          effectiveStyle.nativeW = isSideways ? probed.height : probed.width;
          effectiveStyle.nativeH = isSideways ? probed.width : probed.height;
          console.log(`[render ${id}] PlayRes ajustado pra: ${effectiveStyle.nativeW}x${effectiveStyle.nativeH} (isSideways=${isSideways})`);
        }

        const assContent = buildAss(subtitles, effectiveStyle);
        console.log(`[render ${id}] Subtitles count: ${subtitles.length}`);
        subtitles.forEach((s: any, i: number) => console.log(`[render ${id}] sub[${i}] text=${JSON.stringify(s.text)}`));
        console.log(`[render ${id}] ---- ASS CONTENT START ----`);
        console.log(assContent);
        console.log(`[render ${id}] ---- ASS CONTENT END ----`);
        fs.writeFileSync(assPath, assContent, 'utf8');
        const { spawn } = require('child_process');
        const ffmpegBinary = fs.existsSync(modernFfmpegPath) ? modernFfmpegPath : 'ffmpeg';
        console.log(`[render ${id}] ffmpeg binary: ${ffmpegBinary}`);
        console.log(`[render ${id}] fontsDir (${fontsDir}) contents:`, fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir) : 'NAO EXISTE');
        console.log(`[render ${id}] homeFontsDir (${homeFontsDir}) contents:`, fs.existsSync(homeFontsDir) ? fs.readdirSync(homeFontsDir) : 'NAO EXISTE');
        // FIX: em vez de confiar em -map 0:v:0 (que pode pegar uma thumbnail/capa
        // embutida no lugar do vídeo real) e -vf ass=... sozinho (que assume, sem
        // garantir, que o frame já bate exatamente com o PlayResX/PlayResY do
        // .ass), agora usamos -filter_complex explicitamente:
        //   1. Seleciona a stream de vídeo REAL identificada pelo ffprobe acima
        //      ([0:v:${probed.index}], não mais fixo em 0).
        //   2. scale+pad força o frame pro exato tamanho que o .ass foi gerado
        //      pra usar (effectiveStyle.nativeW/H) — elimina qualquer mismatch de
        //      resolução/SAR entre o que o navegador viu e o que o ffmpeg decodifica.
        //   3. setsar=1 normaliza pixels não-quadrados (comum em vídeo de rede
        //      social), que pode fazer o libass calcular posição errada.
        //   4. ass=... roda por último, já sobre um frame com dimensões garantidas.
        // Áudio via aac (reencode) em vez de copy: copy pode falhar silenciosamente
        // se o codec de áudio original não for compatível com o container mp4 de
        // saída sem re-encode.
        const targetW = effectiveStyle.nativeW || 1280;
        const targetH = effectiveStyle.nativeH || 720;
        const assPathEscaped = assPath.replace(/:/g, '\\:');
        const filterComplex = `[0:v:${probed.index}]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,ass=${assPathEscaped}[v]`;
        console.log(`[render ${id}] filter_complex: ${filterComplex}`);
        const ffmpegArgs = [
          '-y', '-i', inputPath,
          '-filter_complex', filterComplex,
          '-map', '[v]', '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-threads', '1', '-tune', 'fastdecode',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k',
          '-sn', '-movflags', '+faststart', '-f', 'mp4', outputPath,
        ];
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ffmpegBinary, ffmpegArgs, { stdio: ['ignore','pipe','pipe'] });
          let stderr = '';
          proc.stderr.on('data', (data: Buffer) => {
            const line = data.toString();
            stderr += line;
            console.log(`[render ${id}] ffmpeg:`, line.trim());
          });
          proc.on('close', (code: number) => {
            console.log(`[render ${id}] ffmpeg process closed with code ${code}`);
            if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}. stderr tail: ${stderr.slice(-800)}`));
          });
          proc.on('error', reject);
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
    if (!job || job.status !== 'done' || !job.outputPath) return res.status(404).json({ error: 'File not ready' });
    res.setHeader('Cache-Control', 'no-store');
    res.download(job.outputPath, `video-legendado-${Date.now()}.mp4`, err => {
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
        ffmpeg(inputPath).noVideo().audioCodec('libmp3lame').audioBitrate(128).audioChannels(1)
          .outputOptions(['-af','aresample=async=1','-threads','1']).on('end',resolve).on('error',reject).save(audioPath);
      });

      const audioSize = fs.statSync(audioPath).size;
      console.log(`[transcribe ${id}] Audio ready: ${(audioSize/1024/1024).toFixed(1)}MB`);
      if (audioSize > 24*1024*1024) { cleanup(); return res.status(400).json({ error: 'Audio too large (max ~10 min).' }); }

      let transcription: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath), model: 'whisper-large-v3-turbo',
            response_format: 'verbose_json', timestamp_granularities: ['segment','word'],
          });
          break;
        } catch (e: any) {
          console.warn(`[transcribe ${id}] Whisper attempt ${attempt} failed:`, e.message);
          if (attempt === 3) throw e;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      const rawSegments: Array<{start:number;end:number;text:string}> = (transcription as any).segments ?? [];
      const words: Array<{start:number;end:number;word:string}> = (transcription as any).words ?? [];

      const MAX_SEG_DURATION = 5;
      const splitSegments: Array<{start:number;end:number;text:string}> = [];
      for (const seg of rawSegments) {
        const dur = seg.end - seg.start;
        if (dur <= MAX_SEG_DURATION) { splitSegments.push(seg); continue; }
        const segWords = words.filter(w => w.start >= seg.start && w.end <= seg.end + 0.1);
        if (segWords.length === 0) {
          const allWords = seg.text.trim().split(' ').filter(Boolean);
          const numChunks = Math.max(1, Math.ceil(dur / MAX_SEG_DURATION));
          const wordsPerChunk = Math.ceil(allWords.length / numChunks);
          const chunkDur = dur / numChunks;
          for (let i = 0; i < numChunks; i++) {
            const chunkWords = allWords.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk);
            if (chunkWords.length > 0) splitSegments.push({ start: seg.start + i*chunkDur, end: Math.min(seg.start + (i+1)*chunkDur, seg.end), text: chunkWords.join(' ').trim() });
          }
          continue;
        }
        let chunk: typeof segWords = [], chunkStart = segWords[0].start;
        for (const w of segWords) {
          chunk.push(w);
          if (w.end - chunkStart >= MAX_SEG_DURATION) {
            splitSegments.push({ start: chunkStart, end: w.end, text: chunk.map(x=>x.word).join(' ').trim() });
            chunk = []; chunkStart = w.end;
          }
        }
        if (chunk.length > 0) splitSegments.push({ start: chunkStart, end: chunk[chunk.length-1].end, text: chunk.map(x=>x.word).join(' ').trim() });
      }

      let segments = splitSegments;
      const LANG_MAP: Record<string,string> = { es:'Spanish', pt:'Portuguese', fr:'French', de:'German', it:'Italian', ja:'Japanese', ko:'Korean', zh:'Chinese', ru:'Russian', ar:'Arabic', hi:'Hindi', en:'English' };
      const fullLangName = LANG_MAP[targetLang.toLowerCase()] || targetLang;

      if (targetLang !== 'original' && segments.length > 0) {
        console.log(`[transcribe ${id}] Translating ${segments.length} segments to ${fullLangName}...`);
        const BATCH_SIZE = 1;
        const translationMap = new Map<number,string>();

        const parseTranslationResponse = (raw: string): Map<number,string> => {
          const map = new Map<number,string>();
          let cleaned = raw.replace(/```[\s\S]*?```/g,'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<thinking>[\s\S]*?<\/thinking>/gi,'').replace(/<[^>]+>/g,'');
          for (const line of cleaned.split('\n')) {
            const match = line.match(/^\s*(\d+)[\.\s]*\|\|\|\s*(.+?)\s*$/);
            if (match) { const idx=parseInt(match[1],10); const text=match[2].trim(); if(text&&!isNaN(idx))map.set(idx,text); }
            const fallbackMatch = line.match(/^\s*(\d+)[\.)]\s+(.+?)\s*$/);
            if (fallbackMatch && !match) { const idx=parseInt(fallbackMatch[1],10); const text=fallbackMatch[2].trim(); if(text&&!isNaN(idx))map.set(idx,text); }
          }
          return map;
        };

        const translateBatch = async (batchSegments: typeof segments, offset: number, modelName: string) => {
          const numbered = batchSegments.map((s,i)=>`${offset+i+1}|||${s.text}`).join('\n');
          console.log(`[transcribe ${id}] Batch ${offset} → ${modelName}`);
          const chat = await groq.chat.completions.create({
            model: modelName,
            messages: [
              { role: 'system', content: `Translate to ${fullLangName}. Format: NUMBER|||TRANSLATION. Concise. No explanations.` },
              { role: 'user', content: numbered },
            ],
            temperature: 0.1, max_tokens: 2048,
          });
          const raw = chat.choices[0]?.message?.content ?? '';
          console.log(`[transcribe ${id}] Raw: ${raw.length} chars`);
          if (raw.length < 50) console.log(`[transcribe ${id}] Raw content: ${raw}`);
          return parseTranslationResponse(raw);
        };

        const primaryModel = 'openai/gpt-oss-120b';
        const fallbackModel = 'openai/gpt-oss-20b';

        for (let i = 0; i < segments.length; i += BATCH_SIZE) {
          const batch = segments.slice(i, i + BATCH_SIZE);
          let batchMap: Map<number,string> | null = null;
          try { batchMap = await translateBatch(batch, i, primaryModel); }
          catch (e: any) { console.warn(`[transcribe ${id}] Primary failed:`, e.message); }
          if (!batchMap || batchMap.size === 0) {
            try { batchMap = await translateBatch(batch, i, fallbackModel); }
            catch (e: any) { console.warn(`[transcribe ${id}] Fallback failed:`, e.message); }
          }
          if (batchMap) { for (const [key,value] of batchMap) translationMap.set(key,value); }
          else { console.warn(`[transcribe ${id}] Batch ${i} failed, keeping original`); }
          if (i + BATCH_SIZE < segments.length) await new Promise(r => setTimeout(r, 2000));
        }

        const beforeCount = translationMap.size;
        segments = segments.map((s,i) => ({ ...s, text: translationMap.get(i+1) ?? s.text }));
        console.log(`[transcribe ${id}] Translation done: ${beforeCount}/${segments.length} lines translated`);
      }

      const MAX_CHARS = 42;
      const finalSegments: typeof segments = [];
      for (const seg of segments) {
        const text = seg.text.trim();
        if (text.length <= MAX_CHARS * 2) { finalSegments.push(seg); continue; }
        const w = text.split(' ');
        const chunks: string[] = []; let current = '';
        for (const word of w) {
          if ((current+' '+word).trim().length > MAX_CHARS && current) { chunks.push(current.trim()); current = word; }
          else { current = current ? current+' '+word : word; }
        }
        if (current) chunks.push(current.trim());
        const dur = seg.end - seg.start;
        const timePerChunk = dur / chunks.length;
        for (let i = 0; i < chunks.length; i += 2) {
          const pair = chunks.slice(i, i+2).join(' ');
          finalSegments.push({ start: seg.start + i*timePerChunk, end: Math.min(seg.start + (i+2)*timePerChunk, seg.end), text: pair });
        }
      }

      let subtitles = finalSegments.filter(s=>s.text.trim().length>0).map(s=>({start:s.start,end:s.end,text:s.text.trim(),confidence:0.9})) as Array<{start:number;end:number;text:string;confidence:number;words?:Array<{word:string;start:number;end:number}>}>;

      // FIX: o Whisper às vezes transcreve um fragmento sozinho no finalzinho do
      // áudio (uma palavra solta tipo "você"/"you", de um som cortado ou respiração
      // captada como fala) — isso aparecia como uma legenda órfã depois da última
      // frase de verdade. Remove o ÚLTIMO item da lista se ele for só UMA palavra
      // (uma legenda real de verdade raramente termina o vídeo assim, isolada).
      if (subtitles.length > 1) {
        const last = subtitles[subtitles.length - 1];
        const wordCount = last.text.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount <= 1) {
          console.log(`[transcribe] Removendo fragmento orfao no final: "${last.text}"`);
          subtitles = subtitles.slice(0, -1);
        }
      }
      if (targetLang === 'original' && words.length > 0) {
        for (const sub of subtitles) sub.words = words.filter(w => w.start >= sub.start - 0.05 && w.end <= sub.end + 0.15);
      }

      // FIX: o Whisper às vezes capta um resquício de fala/eco bem no final do áudio
      // (comum quando o vídeo termina com uma tela de "inscreva-se"/créditos por cima
      // de música ou fala baixa) e gera uma última legenda de UMA palavra só, sem
      // sentido nenhum no contexto. Removemos legendas finais assim automaticamente —
      // só a(s) do final, e só quando são uma única palavra curta; qualquer legenda
      // real do meio do vídeo (mesmo curta) não é afetada.
      while (subtitles.length > 1) {
        const last = subtitles[subtitles.length - 1].text.trim();
        const hasNoPunctuation = !/[.,!?…]$/.test(last);
        const isSingleShortWord = !last.includes(' ') && last.length <= 8;
        if (isSingleShortWord && hasNoPunctuation) subtitles.pop();
        else break;
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
    const vtt = 'WEBVTT\n\n' + subtitles.map((sub:any,i:number)=>{const fmt=(s:number)=>formatSrtTime(s).replace(',','.');return `${i+1}\n${fmt(sub.start)} --> ${fmt(sub.end)}\n${sub.text}`;}).join('\n\n')+'\n';
    res.setHeader('Content-Disposition', 'attachment; filename="subtitles.vtt"');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(vtt);
  });

  app.use((req, res, next) => { if (req.path === '/api/render') { req.socket.setTimeout(300000); res.setTimeout(300000); } next(); });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SubFlow server running on http://localhost:${PORT}`);
  });
}

startServer();
