import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import Groq from "groq-sdk";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const UPLOAD_DIR = path.join(os.tmpdir(), "subflow_uploads");
const WORK_DIR   = path.join(os.tmpdir(), "subflow_work");
[UPLOAD_DIR, WORK_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 500 * 1024 * 1024 } });

function cleanup(...files: string[]) {
  for (const f of files) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
}

const LANG_NAMES: Record<string,string> = {
  en:"English", pt:"Portuguese", es:"Spanish", fr:"French",
  de:"German",  it:"Italian",   ja:"Japanese", ko:"Korean",
  zh:"Chinese", ru:"Russian",   ar:"Arabic",   hi:"Hindi",
};

function hexToAss(hex: string): string {
  const h = hex.replace("#","").padEnd(6,"0");
  return ("&H00" + h.slice(4,6) + h.slice(2,4) + h.slice(0,2)).toUpperCase();
}

function toSrtTime(s: number): string {
  const ms=Math.round((s%1)*1000), ss=Math.floor(s)%60;
  const mm=Math.floor(s/60)%60, hh=Math.floor(s/3600);
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}
function toAssTime(s: number): string {
  const cs=Math.round((s%1)*100), ss=Math.floor(s)%60;
  const mm=Math.floor(s/60)%60, hh=Math.floor(s/3600);
  return `${hh}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
}
function buildSrt(subs:{start:number;end:number;text:string}[]): string {
  return subs.map((s,i)=>`${i+1}\n${toSrtTime(s.start)} --> ${toSrtTime(s.end)}\n${s.text.trim()}`).join("\n\n")+"\n";
}
function extractAudio(input:string, output:string): Promise<void> {
  return new Promise((resolve,reject)=>{
    ffmpeg(input).noVideo().audioCodec("libmp3lame").audioBitrate(128).audioChannels(1).audioFrequency(16000)
      .on("end",resolve).on("error",reject).save(output);
  });
}
function getVideoDimensions(fp:string): Promise<{w:number;h:number}> {
  return new Promise(resolve=>{
    ffmpeg.ffprobe(fp,(err:any,data:any)=>{
      if(err){resolve({w:1080,h:1920});return;}
      const vs=(data.streams??[]).find((s:any)=>s.codec_type==="video");
      resolve({w:vs?.width??1080,h:vs?.height??1920});
    });
  });
}

function buildAss(
  subs:{start:number;end:number;text:string}[],
  opts:{vw:number;vh:number;fontName:string;fontSize:number;primCol:string;outCol:string;bgOp:number;box:{x:number;y:number;w:number;h:number}}
): string {
  const {vw,vh,fontName,fontSize,primCol,outCol,bgOp,box} = opts;

  const boxTopPx    = Math.round(box.y / 100 * vh);
  const boxBottomPx = Math.round((box.y + box.h) / 100 * vh);
  const boxCenterX  = Math.round((box.x + box.w/2) / 100 * vw);
  const mL = Math.max(0, Math.round(box.x / 100 * vw));
  const mR = Math.max(0, Math.round((100 - box.x - box.w) / 100 * vw));
  const mV = Math.max(0, vh - boxBottomPx);

  const bgAlpha = Math.round((1-bgOp)*255).toString(16).padStart(2,"0").toUpperCase();
  const outline = bgOp > 0 ? 0 : Math.max(1, Math.round(fontSize * 0.08));
  const bStyle  = bgOp > 0 ? 4 : 1;

  console.log(`[ass] ${vw}x${vh} font=${fontName}/${fontSize}px boxTop=${boxTopPx}px(${box.y.toFixed(0)}%) boxBottom=${boxBottomPx}px(${(box.y+box.h).toFixed(0)}%) cx=${boxCenterX} mV=${mV} mL=${mL} mR=${mR}`);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${vw}`,
    `PlayResY: ${vh}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 1",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,${fontName},${fontSize},${hexToAss(primCol)},${hexToAss(primCol)},${hexToAss(outCol)},&H${bgAlpha}000000,0,0,0,0,100,100,0,0,${bStyle},${outline},0,2,${mL},${mR},${mV},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  const events = subs.map(s => {
    const txt = s.text.trim().replace(/\n/g, "\\N");
    return `Dialogue: 0,${toAssTime(s.start)},${toAssTime(s.end)},Default,,0,0,0,,{\\an2\\pos(${boxCenterX},${boxBottomPx})}${txt}`;
  });

  return [...header, ...events].join("\n");
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT)||3000;
  app.use(cors());
  app.use(express.json({limit:"10mb"}));

  // TRANSCRIBE
  app.post("/api/transcribe", upload.single("video"), async (req,res)=>{
    const videoPath=req.file?.path??"";
    const audioPath=path.join(WORK_DIR, uuidv4()+".mp3");
    try {
      if(!req.file){res.status(400).json({error:"No video."});return;}
      const targetLang=String(req.body.targetLang??"original").trim();
      const langName=LANG_NAMES[targetLang]??"";
      const apiKey=process.env.GROQ_API_KEY;
      console.log(`[transcribe] lang=${targetLang} (${langName})`);
      if(!apiKey){res.status(500).json({error:"GROQ_API_KEY not set."});return;}
      const groq=new Groq({apiKey});

      await extractAudio(videoPath, audioPath);
      const tr=await groq.audio.transcriptions.create({
        file:fs.createReadStream(audioPath),
        model:"whisper-large-v3-turbo",
        response_format:"verbose_json",
        timestamp_granularities:["segment","word"],
      });

      type Seg={start:number;end:number;text:string;avg_logprob?:number};
      const segments:Seg[]=(tr as any).segments??[];

      function splitSeg(seg:Seg, conf:number) {
        const text=seg.text.trim();
        if(text.length<=55) return [{start:seg.start,end:seg.end,text,confidence:conf}];
        const words=text.split(" "); const chunks:string[]=[]; let cur="";
        for(const w of words){
          if((cur+" "+w).trim().length<=55){cur=(cur+" "+w).trim();}
          else{if(cur)chunks.push(cur);cur=w;}
        }
        if(cur)chunks.push(cur);
        const tpc=(seg.end-seg.start)/chunks.length;
        return chunks.map((t,i)=>({start:seg.start+i*tpc,end:seg.start+(i+1)*tpc,text:t,confidence:conf}));
      }

      let subtitles=segments.flatMap(seg=>{
        const conf=seg.avg_logprob?Math.min(0.99,Math.max(0.5,Math.exp(seg.avg_logprob))):0.85;
        return splitSeg(seg,conf);
      });

      // Translate line by line
      if(targetLang!=="original" && langName && subtitles.length>0){
        console.log(`[translate] ${subtitles.length} lines → ${langName}`);
        const translated:string[]=[];
        for(const sub of subtitles){
          try{
            const r=await groq.chat.completions.create({
              model:"openai/gpt-oss-120b", temperature:0.1, max_tokens:200,
              messages:[
                {role:"system", content:`Translate to ${langName}. Reply with ONLY the translation, nothing else.`},
                {role:"user", content:sub.text},
              ],
            });
            translated.push((r.choices[0].message.content??"").trim()||sub.text);
          } catch { translated.push(sub.text); }
        }
        if(translated.length===subtitles.length){
          subtitles=subtitles.map((s,i)=>({...s,text:translated[i]??s.text}));
          console.log(`[translate] done. sample: "${translated[0]}"`);
        }
      }

      res.json({subtitles});
    } catch(err:any){
      console.error("[transcribe]",err?.message);
      res.status(500).json({error:err?.message??"Transcription failed."});
    } finally { cleanup(videoPath,audioPath); }
  });

  // RENDER
  app.post("/api/render", upload.single("video"), async (req,res)=>{
    const videoPath=req.file?.path??"";
    const id=uuidv4();
    const assPath=path.join(WORK_DIR, id+".ass");
    const outPath=path.join(WORK_DIR, id+"_out.mp4");
    try{
      if(!req.file||!req.body.subtitles){res.status(400).json({error:"Missing data."});return;}
      const subs:{start:number;end:number;text:string}[]=JSON.parse(req.body.subtitles);
      if(!subs.length){res.status(400).json({error:"No subtitles."});return;}

      const style  = req.body.style ? JSON.parse(req.body.style) : {};
      const box    = style.box ?? {x:5,y:78,w:90,h:14};
      const {w:ffW,h:ffH} = await getVideoDimensions(videoPath);
      const bW = Number(style.browserW||0);
      const bH = Number(style.browserH||0);
      const vw = bW>0 ? bW : ffW;
      const vh = bH>0 ? bH : ffH;
      console.log(`[render] ffprobe=${ffW}x${ffH} browser=${bW}x${bH} using=${vw}x${vh} fontSize=${style.fontSize} box=${JSON.stringify(box)}`);

      const assContent = buildAss(subs, {
        vw, vh,
        fontName: String(style.fontName??"Arial"),
        fontSize: Number(style.fontSize??18),
        primCol:  String(style.primaryColor??"#FFFFFF"),
        outCol:   String(style.outlineColor??"#000000"),
        bgOp:     Number(style.bgOpacity??0),
        box,
      });

      fs.writeFileSync(assPath, assContent, "utf8");

      const evtLines = assContent.split("\n").filter(l=>l.startsWith("Dialogue:")).slice(0,2);
      evtLines.forEach(l=>console.log("[ass]",l.slice(0,100)));

      const assEsc = assPath.replace(/\\/g,"/").replace(/^([A-Za-z]):/,"$1\\:");
      console.log("[render] ass="+assEsc);

      await new Promise<void>((resolve,reject)=>{
        ffmpeg(videoPath).videoCodec("libx264")
          .outputOptions(["-vf",`ass='${assEsc}'`,"-preset","ultrafast","-crf","23","-movflags","+faststart"])
          .audioCodec("aac").audioBitrate("128k")
          .on("end",resolve).on("error",reject).save(outPath);
      });

      console.log("[render] done");
      res.download(outPath,"subflow_export.mp4",()=>cleanup(videoPath,assPath,outPath));
    } catch(err:any){
      console.error("[render]",err?.message??err);
      cleanup(videoPath,assPath,outPath);
      if(!res.headersSent) res.status(500).json({error:err?.message??"Render failed."});
    }
  });

  // EXPORT SRT
  app.post("/api/export/srt",(req,res)=>{
    try{
      const{subtitles}=req.body;
      if(!Array.isArray(subtitles)){res.status(400).json({error:"subtitles required."});return;}
      res.setHeader("Content-Type","text/plain; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="subtitles.srt"');
      res.send(buildSrt(subtitles));
    }catch(e:any){res.status(500).json({error:e?.message});}
  });

  // EXPORT VTT
  app.post("/api/export/vtt",(req,res)=>{
    try{
      const{subtitles}=req.body;
      if(!Array.isArray(subtitles)){res.status(400).json({error:"subtitles required."});return;}
      const vtt="WEBVTT\n\n"+subtitles.map((s:any,i:number)=>
        `${i+1}\n${toSrtTime(s.start).replace(",",".")} --> ${toSrtTime(s.end).replace(",",".")}\n${s.text.trim()}`
      ).join("\n\n")+"\n";
      res.setHeader("Content-Type","text/vtt; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="subtitles.vtt"');
      res.send(vtt);
    }catch(e:any){res.status(500).json({error:e?.message});}
  });

  if(process.env.NODE_ENV!=="production"){
    const {createServer:createViteServer}=await import("vite");
    const vite=await createViteServer({server:{middlewareMode:true},appType:"spa"});
    app.use(vite.middlewares);
  }else{
    const dist=path.join(process.cwd(),"dist");
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*$/,(_req,res)=>res.sendFile(path.join(dist,"index.html")));
  }
  
  app.listen(PORT,"0.0.0.0",()=>console.log(`\n🎬 SubFlow → http://localhost:${PORT}\n`));
}

startServer().catch(e=>{console.error("Server failed:",e);process.exit(1);});
