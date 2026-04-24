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

const LANG_NAMES: Record<string, string> = {
  en:"English", pt:"Portuguese", es:"Spanish", fr:"French",
  de:"German",  it:"Italian",   ja:"Japanese", ko:"Korean",
  zh:"Chinese", ru:"Russian",   ar:"Arabic",   hi:"Hindi",
};

function hexToAss(hex: string): string {
  const h = hex.replace("#","").padEnd(6,"0");
  return ("&H00" + h.slice(4,6) + h.slice(2,4) + h.slice(0,2)).toUpperCase();
}

function toSrtTime(s: number): string {
  const ms = Math.round((s%1)*1000), ss = Math.floor(s)%60;
  const mm = Math.floor(s/60)%60,   hh = Math.floor(s/3600);
  return String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0")+":"+String(ss).padStart(2,"0")+","+String(ms).padStart(3,"0");
}

function toAssTime(s: number): string {
  const cs = Math.round((s%1)*100), ss = Math.floor(s)%60;
  const mm = Math.floor(s/60)%60,   hh = Math.floor(s/3600);
  return hh+":"+String(mm).padStart(2,"0")+":"+String(ss).padStart(2,"0")+"."+String(cs).padStart(2,"0");
}

function buildSrt(subs: {start:number;end:number;text:string}[]): string {
  return subs.map((s,i)=>i+1+"\n"+toSrtTime(s.start)+" --> "+toSrtTime(s.end)+"\n"+s.text.trim()).join("\n\n")+"\n";
}

function extractAudio(input: string, output: string): Promise<void> {
  return new Promise((resolve,reject)=>{
    ffmpeg(input).noVideo().audioCodec("libmp3lame").audioBitrate(128).audioChannels(1).audioFrequency(16000)
      .on("end",resolve).on("error",reject).save(output);
  });
}

function getVideoDimensions(fp: string): Promise<{w:number;h:number}> {
  return new Promise(resolve=>{
    ffmpeg.ffprobe(fp,(err:any,data:any)=>{
      if(err){resolve({w:1080,h:1920});return;}
      const vs=(data.streams??[]).find((s:any)=>s.codec_type==="video");
      resolve({w:vs?.width??1080,h:vs?.height??1920});
    });
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT)||3000;
  app.use(cors());
  app.use(express.json({limit:"10mb"}));

  // TRANSCRIBE
  app.post("/api/transcribe", upload.single("video"), async (req,res)=>{
    const videoPath = req.file?.path??"";
    const audioPath = path.join(WORK_DIR, uuidv4()+".mp3");
    try {
      if(!req.file){res.status(400).json({error:"No video."});return;}
      const targetLang = String(req.body.targetLang??"original").trim();
      const langName   = LANG_NAMES[targetLang]??"";
      const apiKey     = process.env.GROQ_API_KEY;
      console.log("[transcribe] lang="+targetLang+" ("+langName+") key="+(apiKey?"OK":"MISSING"));
      if(!apiKey){res.status(500).json({error:"GROQ_API_KEY not set."});return;}

      const groq = new Groq({apiKey});
      await extractAudio(videoPath, audioPath);

      const tr = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });

      type Seg={start:number;end:number;text:string;avg_logprob?:number};
      const segments: Seg[] = (tr as any).segments??[];

      function splitSeg(seg:Seg, conf:number) {
        const text=seg.text.trim();
        if(text.length<=55)return[{start:seg.start,end:seg.end,text,confidence:conf}];
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

      if(targetLang!=="original"&&langName&&subtitles.length>0){
        console.log("[translate] "+subtitles.length+" lines → "+langName);

        // Robust JSON extraction — handles markdown fences and extra text
        function extractJsonArray(raw:string): string[]|null {
          const clean = raw.replace(/```json|```/g,"").trim();
          // Try direct parse first
          try { const r=JSON.parse(clean); if(Array.isArray(r))return r; } catch{}
          // Try extracting [...] from anywhere in the text
          const m = clean.match(/\[[\s\S]*\]/);
          if(m){ try { const r=JSON.parse(m[0]); if(Array.isArray(r))return r; } catch{} }
          return null;
        }

        // Translate a single line as fallback
        async function translateOne(text:string): Promise<string> {
          try {
            const r = await groq.chat.completions.create({
              model:"llama-3.3-70b-versatile", temperature:0.1, max_tokens:256,
              messages:[
                {role:"system", content:"Translate this subtitle to "+langName+". Reply with only the translation, nothing else."},
                {role:"user", content:text},
              ],
            });
            return (r.choices[0].message.content??"").trim() || text;
          } catch { return text; }
        }

        const BATCH=20; const allTexts=subtitles.map(s=>s.text); const translated:string[]=[];
        for(let i=0;i<allTexts.length;i+=BATCH){
          const batch=allTexts.slice(i,i+BATCH);
          let success=false;
          try{
            const resp=await groq.chat.completions.create({
              model:"llama-3.3-70b-versatile",temperature:0.1,max_tokens:2048,
              messages:[
                {role:"system",content:"You are a subtitle translator. Translate each of the following lines to "+langName+". Return ONLY a valid JSON array of translated strings. Same number of items as input. No explanations, no markdown fences."},
                {role:"user",content:JSON.stringify(batch)},
              ],
            });
            const raw=resp.choices[0].message.content??"";
            console.log("[translate] raw response (first 200): "+raw.slice(0,200));
            const result=extractJsonArray(raw);
            if(result&&result.length===batch.length){
              translated.push(...result);
              console.log("[translate] batch "+(Math.floor(i/BATCH)+1)+" OK ("+result.length+" lines)");
              success=true;
            }else{
              console.warn("[translate] batch parse failed, result="+JSON.stringify(result?.slice(0,3))+" batchLen="+batch.length);
            }
          }catch(e:any){
            console.error("[translate] batch error: "+e?.message);
          }
          // Fallback: translate line by line
          if(!success){
            console.log("[translate] falling back to line-by-line for batch "+(Math.floor(i/BATCH)+1));
            for(const text of batch){
              translated.push(await translateOne(text));
            }
          }
        }
        if(translated.length===subtitles.length){
          subtitles=subtitles.map((s,i)=>({...s,text:translated[i]??s.text}));
          console.log("[translate] Done. Sample: "+translated[0]);
        }
      }

      res.json({subtitles});
    }catch(err:any){
      console.error("[transcribe] "+err?.message);
      res.status(500).json({error:err?.message??"Transcription failed."});
    }finally{cleanup(videoPath,audioPath);}
  });

  // RENDER
  app.post("/api/render", upload.single("video"), async (req,res)=>{
    const videoPath  = req.file?.path??"";
    const id         = uuidv4();
    const assPath    = path.join(WORK_DIR, id+".ass");
    const outputPath = path.join(WORK_DIR, id+"_out.mp4");
    try{
      if(!req.file||!req.body.subtitles){res.status(400).json({error:"Missing data."});return;}
      const subs:{start:number;end:number;text:string}[]=JSON.parse(req.body.subtitles);
      if(!subs.length){res.status(400).json({error:"No subtitles."});return;}

      const style    = req.body.style?JSON.parse(req.body.style):{};
      const fontSize = Number(style.fontSize??18);
      const fontName = String(style.fontName??"Arial");
      const primCol  = String(style.primaryColor??"#FFFFFF");
      const outCol   = String(style.outlineColor??"#000000");
      const bgOp     = Number(style.bgOpacity??0);
      const box      = style.box??{x:5,y:78,w:90,h:14};

      const {w:VW,h:VH} = await getVideoDimensions(videoPath);
      console.log("[render] "+VW+"x"+VH+" font="+fontSize+" box="+JSON.stringify(box));

      const bx=Math.round(box.x/100*VW);
      const by=Math.round(box.y/100*VH);
      const bw=Math.round(box.w/100*VW);
      const bh=Math.round(box.h/100*VH);
      const cY=box.y+box.h/2;

      let alignment=2, marginV=Math.max(0,VH-by-bh);
      if(cY<38){alignment=8;marginV=Math.max(0,by);}
      else if(cY<=62){alignment=5;marginV=0;}
      const marginL=Math.max(0,bx);
      const marginR=Math.max(0,VW-bx-bw);

      const bgAlpha=Math.round((1-bgOp)*255).toString(16).padStart(2,"0").toUpperCase();
      const borderStyle=bgOp>0?4:1;
      const outline=bgOp>0?0:Math.max(1,Math.round(fontSize*0.08));

      const assContent=[
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: "+VW,
        "PlayResY: "+VH,
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        "Style: Default,"+fontName+","+fontSize+","+hexToAss(primCol)+","+hexToAss(primCol)+","+hexToAss(outCol)+",&H"+bgAlpha+"000000,0,0,0,0,100,100,0,0,"+borderStyle+","+outline+",0,"+alignment+","+marginL+","+marginR+","+marginV+",1",
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
        ...subs.map(s=>"Dialogue: 0,"+toAssTime(s.start)+","+toAssTime(s.end)+",Default,,0,0,0,,"+s.text.trim().replace(/\n/g,"\\N")),
      ].join("\n");

      fs.writeFileSync(assPath, assContent, "utf8");

      // Windows-safe path for ffmpeg ass filter
      const assEsc = assPath.replace(/\\/g,"/").replace(/^([A-Za-z]):/,"$1\\:");
      console.log("[render] ass="+assEsc+" align="+alignment+" mV="+marginV+" mL="+marginL+" mR="+marginR);

      await new Promise<void>((resolve,reject)=>{
        ffmpeg(videoPath).videoCodec("libx264")
          .outputOptions(["-vf","ass='"+assEsc+"'","-preset","veryfast","-crf","23","-movflags","+faststart"])
          .audioCodec("aac").audioBitrate("128k")
          .on("end",resolve).on("error",reject).save(outputPath);
      });

      console.log("[render] done → "+outputPath);
      res.download(outputPath,"subflow_export.mp4",()=>cleanup(videoPath,assPath,outputPath));
    }catch(err:any){
      console.error("[render] "+err?.message??err);
      cleanup(videoPath,assPath,outputPath);
      if(!res.headersSent)res.status(500).json({error:err?.message??"Render failed."});
    }
  });

  // EXPORT SRT
  app.post("/api/export/srt",(req,res)=>{
    try{
      const {subtitles}=req.body;
      if(!Array.isArray(subtitles)){res.status(400).json({error:"subtitles required."});return;}
      res.setHeader("Content-Type","text/plain; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="subtitles.srt"');
      res.send(buildSrt(subtitles));
    }catch(e:any){res.status(500).json({error:e?.message});}
  });

  // EXPORT VTT
  app.post("/api/export/vtt",(req,res)=>{
    try{
      const {subtitles}=req.body;
      if(!Array.isArray(subtitles)){res.status(400).json({error:"subtitles required."});return;}
      const vtt="WEBVTT\n\n"+subtitles.map((s:any,i:number)=>
        i+1+"\n"+toSrtTime(s.start).replace(",",".")+" --> "+toSrtTime(s.end).replace(",",".")+"\n"+s.text.trim()
      ).join("\n\n")+"\n";
      res.setHeader("Content-Type","text/vtt; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="subtitles.vtt"');
      res.send(vtt);
    }catch(e:any){res.status(500).json({error:e?.message});}
  });

  if(process.env.NODE_ENV!=="production"){
    const vite=await createViteServer({server:{middlewareMode:true},appType:"spa"});
    app.use(vite.middlewares);
  }else{
    const dist=path.join(process.cwd(),"dist");
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*$/,(_req,res)=>res.sendFile(path.join(dist,"index.html")));
  }

  app.listen(PORT,"0.0.0.0",()=>console.log("\n🎬 SubFlow → http://localhost:"+PORT+"\n"));
}

startServer().catch(e=>{console.error("Server failed:",e);process.exit(1);});
