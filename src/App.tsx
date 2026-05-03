import { useState, useRef, useCallback, useEffect, DragEvent } from "react";

interface Subtitle { start: number; end: number; text: string; confidence: number; }
interface SubBox { x: number; y: number; w: number; h: number; }
interface SubStyle {
  fontSize: number; fontName: string;
  primaryColor: string; outlineColor: string;
  bgOpacity: number; preset: string; box: SubBox;
}
type Step = "upload"|"processing"|"edit"|"export";

const LANGUAGES = [
  {code:"original",label:"Original (no translation)"},
  {code:"en",label:"English"},{code:"pt",label:"Portuguese"},
  {code:"es",label:"Spanish"},{code:"fr",label:"French"},
  {code:"de",label:"German"},{code:"it",label:"Italian"},
  {code:"ja",label:"Japanese"},{code:"ko",label:"Korean"},
  {code:"zh",label:"Chinese"},{code:"ru",label:"Russian"},
  {code:"ar",label:"Arabic"},{code:"hi",label:"Hindi"},
];
const FONTS = ["Arial","Impact","Georgia","Verdana","Trebuchet MS","Tahoma","Courier New"];
const PRESETS: Record<string,Partial<SubStyle>> = {
  impact:  {fontName:"Impact", fontSize:26,primaryColor:"#FFFFFF",outlineColor:"#000000",bgOpacity:0},
  bold:    {fontName:"Impact", fontSize:30,primaryColor:"#FFFF00",outlineColor:"#000000",bgOpacity:0},
  neon:    {fontName:"Arial",  fontSize:22,primaryColor:"#00FFFF",outlineColor:"#0055FF",bgOpacity:0},
  fire:    {fontName:"Impact", fontSize:24,primaryColor:"#FF4500",outlineColor:"#FFD700",bgOpacity:0},
  cinema:  {fontName:"Georgia",fontSize:18,primaryColor:"#FFFFFF",outlineColor:"#000000",bgOpacity:0.7},
  minimal: {fontName:"Arial",  fontSize:16,primaryColor:"#FFFFFF",outlineColor:"#222222",bgOpacity:0},
  classic: {fontName:"Arial",  fontSize:18,primaryColor:"#FFFFFF",outlineColor:"#000000",bgOpacity:0.5},
};
const PRESET_LIST=[
  {key:"impact",label:"Impact",emoji:"💥"},{key:"bold",label:"Bold",emoji:"⚡"},
  {key:"neon",label:"Neon",emoji:"🌀"},{key:"fire",label:"Fire",emoji:"🔥"},
  {key:"cinema",label:"Cinema",emoji:"🎬"},{key:"minimal",label:"Minimal",emoji:"◻️"},
  {key:"classic",label:"Classic",emoji:"📺"},
];
const DEFAULT_BOX: SubBox = {x:5,y:78,w:90,h:14};
const DEFAULT_STYLE: SubStyle = {fontSize:26,fontName:"Impact",primaryColor:"#FFFFFF",outlineColor:"#000000",bgOpacity:0,preset:"impact",box:DEFAULT_BOX};

function toTimecode(s:number){
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.round((s%1)*1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
}
function formatSize(b:number){return b<1024*1024?`${(b/1024).toFixed(1)} KB`:`${(b/(1024*1024)).toFixed(1)} MB`;}

// ─── SubtitleBox ──────────────────────────────────────────────────────────────
// fontScale = previewHeight / nativeVideoHeight  →  fontSize*fontScale = px on screen
function SubtitleBox({text,style,onChange,fontScale}:{
  text:string; style:SubStyle; onChange:(s:SubStyle)=>void; fontScale:number;
}){
  const [sel,setSel]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  const drag=useRef<{type:string;sx:number;sy:number;sb:SubBox}|null>(null);

  useEffect(()=>{
    const fn=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setSel(false);};
    document.addEventListener("mousedown",fn);
    return()=>document.removeEventListener("mousedown",fn);
  },[]);

  const psize=()=>{const p=ref.current?.parentElement;return p?{w:p.clientWidth,h:p.clientHeight}:{w:1,h:1};};
  const clamp=(b:SubBox):SubBox=>({
    x:Math.max(0,Math.min(100-b.w,b.x)),y:Math.max(0,Math.min(100-b.h,b.y)),
    w:Math.max(8,Math.min(100,b.w)),h:Math.max(4,Math.min(50,b.h)),
  });
  const pd=(e:React.PointerEvent,type:string)=>{
    e.stopPropagation();e.preventDefault();setSel(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current={type,sx:e.clientX,sy:e.clientY,sb:{...style.box}};
  };
  const pm=(e:React.PointerEvent)=>{
    if(!drag.current)return;
    const{type,sx,sy,sb}=drag.current;
    const{w:pw,h:ph}=psize();
    const dx=((e.clientX-sx)/pw)*100,dy=((e.clientY-sy)/ph)*100;
    let nb={...sb};
    if(type==="move"){nb.x=sb.x+dx;nb.y=sb.y+dy;}
    if(type==="se"){nb.w=sb.w+dx;nb.h=sb.h+dy;}
    if(type==="sw"){nb.x=sb.x+dx;nb.w=sb.w-dx;nb.h=sb.h+dy;}
    if(type==="ne"){nb.y=sb.y+dy;nb.w=sb.w+dx;nb.h=sb.h-dy;}
    if(type==="nw"){nb.x=sb.x+dx;nb.y=sb.y+dy;nb.w=sb.w-dx;nb.h=sb.h-dy;}
    if(type==="n"){nb.y=sb.y+dy;nb.h=sb.h-dy;}
    if(type==="s"){nb.h=sb.h+dy;}
    if(type==="e"){nb.w=sb.w+dx;}
    if(type==="w"){nb.x=sb.x+dx;nb.w=sb.w-dx;}
    onChange({...style,box:clamp(nb),preset:"custom"});
  };
  const pu=()=>{drag.current=null;};

  const fs=Math.max(8,Math.round(style.fontSize*fontScale));
  const ts=style.bgOpacity===0
    ?`1px 1px 3px ${style.outlineColor},-1px -1px 3px ${style.outlineColor},1px -1px 3px ${style.outlineColor},-1px 1px 3px ${style.outlineColor}`
    :"none";

  const HANDLES=[
    {k:"nw",s:{top:-5,left:-5,cursor:"nw-resize"}},{k:"ne",s:{top:-5,right:-5,cursor:"ne-resize"}},
    {k:"sw",s:{bottom:-5,left:-5,cursor:"sw-resize"}},{k:"se",s:{bottom:-5,right:-5,cursor:"se-resize"}},
    {k:"n",s:{top:-5,left:"50%",transform:"translateX(-50%)",cursor:"n-resize"}},
    {k:"s",s:{bottom:-5,left:"50%",transform:"translateX(-50%)",cursor:"s-resize"}},
    {k:"e",s:{right:-5,top:"50%",transform:"translateY(-50%)",cursor:"e-resize"}},
    {k:"w",s:{left:-5,top:"50%",transform:"translateY(-50%)",cursor:"w-resize"}},
  ] as const;

  return(
    <div ref={ref}
      style={{
        position:"absolute",left:`${style.box.x}%`,top:`${style.box.y}%`,
        width:`${style.box.w}%`,height:`${style.box.h}%`,
        border:sel?"2px solid #f59e0b":"1.5px dashed rgba(255,255,255,0.5)",
        borderRadius:4,zIndex:20,cursor:"move",
        background:sel?"rgba(245,158,11,0.06)":"transparent",
        display:"flex",alignItems:"center",justifyContent:"center",
        boxSizing:"border-box",overflow:"visible",
      }}
      onPointerDown={e=>pd(e,"move")} onPointerMove={pm} onPointerUp={pu}
    >
      <span style={{
        fontFamily:style.fontName,fontSize:fs+"px",color:style.primaryColor,textShadow:ts,
        background:style.bgOpacity>0?`rgba(0,0,0,${style.bgOpacity})`:"transparent",
        padding:style.bgOpacity>0?"2px 8px":"0",borderRadius:style.bgOpacity>0?"3px":"0",
        textAlign:"center",lineHeight:1.2,maxWidth:"98%",wordBreak:"break-word",
        whiteSpace:"normal",display:"block",pointerEvents:"none",userSelect:"none",
      }}>{text||"Sample text"}</span>
      {sel&&HANDLES.map(h=>(
        <div key={h.k}
          style={{position:"absolute",width:10,height:10,background:"#f59e0b",
            border:"1.5px solid #fff",borderRadius:2,zIndex:30,...h.s as any}}
          onPointerDown={e=>pd(e,h.k)} onPointerMove={pm} onPointerUp={pu}/>
      ))}
      {sel&&<div style={{position:"absolute",top:-20,right:0,fontSize:9,color:"rgba(255,255,255,0.7)",
        background:"rgba(0,0,0,0.65)",padding:"2px 5px",borderRadius:3,
        pointerEvents:"none",whiteSpace:"nowrap"}}>click outside to deselect</div>}
    </div>
  );
}

function UploadZone({onFile}:{onFile:(f:File)=>void}){
  const [drag,setDrag]=useState(false);
  const ref=useRef<HTMLInputElement>(null);
  return(
    <div className={`upload-zone ${drag?"active":""}`}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={(e:DragEvent<HTMLDivElement>)=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)onFile(f);}}
      onClick={()=>ref.current?.click()}>
      <input ref={ref} type="file" accept="video/*" style={{display:"none"}}
        onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);}}/>
      <div className="upload-icon"><svg viewBox="0 0 48 48" fill="none"><rect x="4" y="8" width="40" height="32" rx="3" stroke="currentColor" strokeWidth="2"/><path d="M20 20L28 24L20 28V20Z" fill="currentColor"/><path d="M4 16H44" stroke="currentColor" strokeWidth="2"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="14" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg></div>
      <p className="upload-title">Drop your video here</p>
      <p className="upload-sub">MP4, MOV, MKV, AVI, WebM — up to 500 MB</p>
      <button type="button" className="btn-outline" onClick={e=>{e.stopPropagation();ref.current?.click();}}>Browse files</button>
    </div>
  );
}

function ProcessingView({fileName}:{fileName:string}){
  const [dots,setDots]=useState(".");
  useEffect(()=>{const id=setInterval(()=>setDots(d=>d.length>=3?".":d+"."),600);return()=>clearInterval(id);},[]);
  return(
    <div className="processing-view">
      <div className="spinner-wrap">
        <svg viewBox="0 0 50 50" className="spinner-ring"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="94 32" strokeLinecap="round"/></svg>
        <svg className="spinner-icon" viewBox="0 0 24 24" fill="none"><path d="M9 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-4M9 7V5a2 2 0 014 0v2M9 7h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </div>
      <p className="proc-title">Transcribing{dots}</p>
      <p className="proc-file">{fileName}</p>
      <div className="proc-steps">
        <span className="sbadge active">Extracting audio</span>
        <span className="sbadge">Whisper AI</span>
        <span className="sbadge">Translating</span>
      </div>
    </div>
  );
}

function RightPanel({style,onChange,subtitles,onSubChange,currentTime}:{
  style:SubStyle;onChange:(s:SubStyle)=>void;
  subtitles:Subtitle[];onSubChange:(s:Subtitle[])=>void;currentTime:number;
}){
  const [tab,setTab]=useState<"style"|"subs">("style");
  const set=(p:Partial<SubStyle>)=>onChange({...style,...p,preset:"custom"});
  const applyPreset=(k:string)=>onChange({...style,...PRESETS[k],preset:k});
  const listRef=useRef<HTMLDivElement>(null);
  const activeIdx=subtitles.findIndex(s=>currentTime>=s.start&&currentTime<=s.end);
  useEffect(()=>{
    if(activeIdx>=0&&listRef.current)
      (listRef.current.children[activeIdx] as HTMLElement)?.scrollIntoView({block:"nearest",behavior:"smooth"});
  },[activeIdx]);
  const updT=(i:number,text:string)=>{const n=[...subtitles];n[i]={...n[i],text};onSubChange(n);};
  const updTime=(i:number,f:"start"|"end",v:string)=>{
    const p=v.split(":").map(Number);const s=(p[0]||0)*3600+(p[1]||0)*60+(p[2]||0);
    if(!isNaN(s)){const n=[...subtitles];n[i]={...n[i],[f]:s};onSubChange(n);}
  };
  return(
    <div className="right-panel">
      <div className="tab-bar">
        <button className={`tab-btn ${tab==="style"?"on":""}`} onClick={()=>setTab("style")}>🎨 Style</button>
        <button className={`tab-btn ${tab==="subs"?"on":""}`} onClick={()=>setTab("subs")}>📝 Subtitles <span className="tbadge">{subtitles.length}</span></button>
      </div>
      {tab==="style"&&(
        <div className="tab-body">
          <div className="sec-label">Preset</div>
          <div className="presets-wrap">{PRESET_LIST.map(p=>(
            <button key={p.key} className={`preset-pill ${style.preset===p.key?"on":""}`} onClick={()=>applyPreset(p.key)}>{p.emoji} {p.label}</button>
          ))}</div>
          <div className="divider"/>
          <div className="sec-label">Font</div>
          <select className="sel" value={style.fontName} onChange={e=>set({fontName:e.target.value})}>{FONTS.map(f=><option key={f} value={f}>{f}</option>)}</select>
          <div className="sec-label mt8">Font size <span className="val">{style.fontSize}px</span></div>
          <div className="size-row">
            <button className="size-btn" onClick={()=>set({fontSize:Math.max(10,style.fontSize-2)})}>−</button>
            <input type="range" min={10} max={72} value={style.fontSize} onChange={e=>set({fontSize:Number(e.target.value)})} className="rng"/>
            <button className="size-btn" onClick={()=>set({fontSize:Math.min(72,style.fontSize+2)})}>+</button>
            <span className="size-num">{style.fontSize}</span>
          </div>
          <div className="divider"/>
          <div className="sec-label">Text color</div>
          <div className="color-row"><input type="color" className="cpick" value={style.primaryColor} onChange={e=>set({primaryColor:e.target.value})}/><span className="chex">{style.primaryColor}</span></div>
          <div className="chips">{["#FFFFFF","#FFFF00","#00FFFF","#FF4500","#FF69B4","#000000"].map(c=>(
            <button key={c} className={`chip ${style.primaryColor===c?"on":""}`} style={{background:c,border:["#FFFFFF","#FFFF00"].includes(c)?"1px solid #555":"none"}} onClick={()=>set({primaryColor:c})}/>
          ))}</div>
          <div className="sec-label mt8">Outline color</div>
          <div className="color-row"><input type="color" className="cpick" value={style.outlineColor} onChange={e=>set({outlineColor:e.target.value})}/><span className="chex">{style.outlineColor}</span></div>
          <div className="chips">{["#000000","#FFFFFF","#0055FF","#FFD700","#FF4500"].map(c=>(
            <button key={c} className={`chip ${style.outlineColor===c?"on":""}`} style={{background:c,border:c==="#FFFFFF"?"1px solid #555":"none"}} onClick={()=>set({outlineColor:c})}/>
          ))}</div>
          <div className="divider"/>
          <div className="sec-label">Background <span className="val">{style.bgOpacity===0?"off":`${Math.round(style.bgOpacity*100)}%`}</span></div>
          <input type="range" min={0} max={1} step={0.05} value={style.bgOpacity} onChange={e=>set({bgOpacity:Number(e.target.value)})} className="rng"/>
        </div>
      )}
      {tab==="subs"&&(
        <div className="tab-body no-pad">
          <div className="sub-list" ref={listRef}>
            {subtitles.map((sub,i)=>(
              <div key={i} className={`sub-item ${activeIdx===i?"hi":""}`}>
                <div className="si-n">{i+1}</div>
                <div className="si-body">
                  <div className="si-times">
                    <input className="tc" defaultValue={toTimecode(sub.start)} onBlur={e=>updTime(i,"start",e.target.value)}/>
                    <span className="tc-arr">→</span>
                    <input className="tc" defaultValue={toTimecode(sub.end)} onBlur={e=>updTime(i,"end",e.target.value)}/>
                  </div>
                  <textarea className="si-txt" value={sub.text} onChange={e=>updT(i,e.target.value)} rows={2}/>
                </div>
                <div className="si-meta">
                  <span className="cdot" style={{background:sub.confidence>0.85?"var(--grn)":sub.confidence>0.7?"var(--amb)":"var(--red)"}}/>
                  <button className="del-btn" onClick={()=>onSubChange(subtitles.filter((_,j)=>j!==i))}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExportPanel({subtitles,videoFile,style,onBack}:{subtitles:Subtitle[];videoFile:File|null;style:SubStyle;onBack:()=>void;}){
  const [rendering,setRendering]=useState(false);
  const [done,setDone]=useState(false);
  const dl=(url:string,name:string)=>{const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
  const post=(path:string,name:string)=>fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subtitles})}).then(r=>r.blob()).then(b=>dl(URL.createObjectURL(b),name));
  const render=async()=>{
    if(!videoFile)return;setRendering(true);
    try{
      const form=new FormData();form.append("video",videoFile);form.append("subtitles",JSON.stringify(subtitles));form.append("style",JSON.stringify(style));
      const res=await fetch("/api/render",{method:"POST",body:form});
      if(!res.ok)throw new Error(await res.text());
      dl(URL.createObjectURL(await res.blob()),"subflow_export.mp4");setDone(true);
    }catch(e:any){alert("Render failed: "+e.message);}finally{setRendering(false);}
  };
  return(
    <div className="export-panel">
      <h3>Export</h3><p className="export-sub">Choose your output format</p>
      <div className="export-grid">
        <button className="export-card" onClick={()=>post("/api/export/srt","subtitles.srt")}><span className="ei">📄</span><span className="el">SRT File</span><span className="ed">Most video players</span></button>
        <button className="export-card" onClick={()=>post("/api/export/vtt","subtitles.vtt")}><span className="ei">🌐</span><span className="el">WebVTT</span><span className="ed">Web players</span></button>
        <button className="export-card" onClick={()=>navigator.clipboard.writeText(subtitles.map(s=>s.text).join("\n"))}><span className="ei">📋</span><span className="el">Copy Text</span><span className="ed">Plain transcript</span></button>
        <button className={`export-card accent ${rendering?"loading":""} ${done?"done":""}`} onClick={render} disabled={rendering||!videoFile}>
          <span className="ei">{done?"✅":"🎬"}</span><span className="el">{rendering?"Rendering…":done?"Downloaded!":"Burn to Video"}</span><span className="ed">Embed subtitles into MP4</span>
        </button>
      </div>
      <button className="btn-ghost" onClick={onBack}>← Back to editor</button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App(){
  const [step,setStep]=useState<Step>("upload");
  const [videoFile,setVideoFile]=useState<File|null>(null);
  const [videoUrl,setVideoUrl]=useState("");
  const [targetLang,setTargetLang]=useState("original");
  const [subtitles,setSubtitles]=useState<Subtitle[]>([]);
  const [style,setStyle]=useState<SubStyle>(DEFAULT_STYLE);
  const [error,setError]=useState<string|null>(null);
  const [currentTime,setCurrentTime]=useState(0);

  const [nativeW,setNativeW]=useState(0);
  const [nativeH,setNativeH]=useState(0);
  // Exact px size of the video element (set via style, no object-fit)
  const [dispW,setDispW]=useState(0);
  const [dispH,setDispH]=useState(0);

  const videoRef=useRef<HTMLVideoElement>(null);
  const colRef=useRef<HTMLDivElement>(null);

  const computeSize=useCallback(()=>{
    const col=colRef.current;
    if(!col||nativeW===0||nativeH===0)return;
    // Use getBoundingClientRect for reliable dimensions in flex layout
    const rect=col.getBoundingClientRect();
    const maxW=Math.floor(rect.width)-2;
    const maxH=Math.floor(rect.height)-34;
    if(maxW<=0||maxH<=0)return;
    const ar=nativeW/nativeH;
    let w=maxW, h=Math.round(maxW/ar);
    if(h>maxH){h=maxH;w=Math.round(maxH*ar);}
    w=Math.round(w); h=Math.round(h);
    console.log("[computeSize] col="+Math.round(rect.width)+"x"+Math.round(rect.height)+" native="+nativeW+"x"+nativeH+" disp="+w+"x"+h+" fontScale="+(h/nativeH).toFixed(4));
    setDispW(w); setDispH(h);
    if(videoRef.current){
      videoRef.current.style.width=w+"px";
      videoRef.current.style.height=h+"px";
    }
  },[nativeW,nativeH]);

  useEffect(()=>{
    computeSize();
    const obs=new ResizeObserver(()=>setTimeout(computeSize,30));
    if(colRef.current)obs.observe(colRef.current);
    return()=>obs.disconnect();
  },[computeSize]);

  const fontScale=dispH>0&&nativeH>0?dispH/nativeH:0.2;

  const handleFile=useCallback((f:File)=>{
    setVideoFile(f);setVideoUrl(URL.createObjectURL(f));setError(null);
    setNativeW(0);setNativeH(0);setDispW(0);setDispH(0);
  },[]);

  const startTranscription=async()=>{
    if(!videoFile)return;setStep("processing");setError(null);
    try{
      const form=new FormData();form.append("video",videoFile);form.append("targetLang",targetLang);
      const res=await fetch("/api/transcribe",{method:"POST",body:form});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error??"Transcription failed.");
      setSubtitles(data.subtitles);setStep("edit");
    }catch(e:any){setError(e.message??"Unknown error.");setStep("upload");}
  };

  const currentSub=subtitles.find(s=>currentTime>=s.start&&currentTime<=s.end);
  const stepIndex=["upload","processing","edit","export"].indexOf(step);

  return(
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="logo">
            <svg viewBox="0 0 32 32" fill="none" width="22" height="22">
              <rect x="2" y="6" width="28" height="20" rx="3" stroke="#f59e0b" strokeWidth="1.5"/>
              <path d="M13 13L19 16L13 19V13Z" fill="#f59e0b"/>
              <path d="M2 12H30" stroke="#f59e0b" strokeWidth="1.5"/>
              <circle cx="6" cy="9" r="1" fill="#f59e0b"/>
              <circle cx="9.5" cy="9" r="1" fill="#f59e0b"/>
              <circle cx="13" cy="9" r="1" fill="#f59e0b"/>
            </svg>
            <span className="logo-txt">SubFlow</span>
          </div>
          <div className="steps-nav">
            {[1,2,3,4].map((n,i)=>(
              <span key={n} className={`sdot ${stepIndex===i?"active":""} ${stepIndex>i?"done":""}`}>{n}</span>
            ))}
          </div>
          {step==="edit"&&(
            <div className="hdr-acts">
              <button className="btn-sm-o" onClick={()=>setStep("upload")}>← New</button>
              <button className="btn-sm-p" onClick={()=>setStep("export")}>Export →</button>
            </div>
          )}
        </header>

        <main className="main">
          {step==="upload"&&(
            <div className="page-ctr fade-in">
              <div className="hero"><h1>Transcribe & translate<br/>your videos</h1><p>Powered by Whisper AI — free, fast, no subscription</p></div>
              {error&&<div className="err-banner">⚠ {error}</div>}
              <UploadZone onFile={handleFile}/>
              {videoFile&&(
                <div className="file-card fade-in">
                  <div className="file-row">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style={{color:"var(--amb)",flexShrink:0}}><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 9L15 12L10 15V9Z" fill="currentColor"/></svg>
                    <div><p className="fname">{videoFile.name}</p><p className="fmeta">{formatSize(videoFile.size)}</p></div>
                    <button className="clear-btn" onClick={()=>{setVideoFile(null);setVideoUrl("");}}>×</button>
                  </div>
                  <div className="fld">
                    <label>Translate to</label>
                    <select value={targetLang} onChange={e=>setTargetLang(e.target.value)}>
                      {LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <button className="btn-primary" onClick={startTranscription}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/></svg>
                    Start transcription
                  </button>
                </div>
              )}
            </div>
          )}

          {step==="processing"&&(
            <div className="page-ctr fade-in"><ProcessingView fileName={videoFile?.name??""}/></div>
          )}

          {step==="edit"&&(
            <div className="editor-page fade-in">
              {/* VIDEO COLUMN — video element is sized exactly in JS, no object-fit */}
              <div className="vid-col" ref={colRef}>
                <div style={{
                  position:"relative",
                  width:dispW||"min(100%,360px)",
                  height:dispH||"auto",
                  background:"#000",
                  borderRadius:12,
                  overflow:"hidden",
                  flexShrink:0,
                }}>
                  <video ref={videoRef} src={videoUrl} controls
                    style={{display:"block",background:"#000"}}
                    onTimeUpdate={e=>setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                    onLoadedMetadata={e=>{
                      const v=e.target as HTMLVideoElement;
                      setNativeW(v.videoWidth);
                      setNativeH(v.videoHeight);
                      setTimeout(computeSize,80);
                    }}/>
                  {dispW>0&&(
                    <SubtitleBox
                      text={currentSub?.text??"Sample subtitle text"}
                      style={style}
                      onChange={setStyle}
                      fontScale={fontScale}
                    />
                  )}
                </div>
                <p className="drag-hint">⠿ Drag box · drag corners to resize</p>
              </div>

              {/* RIGHT PANEL */}
              <RightPanel
                style={style} onChange={setStyle}
                subtitles={subtitles} onSubChange={setSubtitles}
                currentTime={currentTime}
              />
            </div>
          )}

          {step==="export"&&(
            <div className="page-ctr fade-in">
              <ExportPanel subtitles={subtitles} videoFile={videoFile} style={style} onBack={()=>setStep("edit")}/>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

const CSS=`
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0d0f12;--s1:#161920;--s2:#1e2229;--brd:rgba(255,255,255,0.07);--txt:#e8eaf0;--mut:#6b7280;--amb:#f59e0b;--amd:rgba(245,158,11,0.12);--amg:rgba(245,158,11,0.22);--grn:#34d399;--red:#f87171;--r:9px;--rl:14px;}
  html,body,#root{height:100%;overflow:hidden}
  body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .app{height:100vh;display:flex;flex-direction:column}
  .hdr{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--brd);background:rgba(13,15,18,0.97);flex-shrink:0}
  .logo{display:flex;align-items:center;gap:8px;margin-right:auto}
  .logo-txt{font-family:'Syne',sans-serif;font-weight:800;font-size:17px;letter-spacing:-0.02em}
  .steps-nav{display:flex;gap:5px}
  .sdot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:10px;font-weight:700;border:1.5px solid var(--brd);color:var(--mut);background:var(--s1);transition:all .2s}
  .sdot.active{border-color:var(--amb);color:var(--amb);background:var(--amd)}
  .sdot.done{border-color:var(--grn);color:var(--grn);background:rgba(52,211,153,0.1)}
  .hdr-acts{display:flex;gap:8px}
  .btn-sm-p{background:var(--amb);color:#0d0f12;border:none;border-radius:7px;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:7px 14px;cursor:pointer}
  .btn-sm-p:hover{background:#fbbf24}
  .btn-sm-o{background:transparent;color:var(--txt);border:1.5px solid var(--brd);border-radius:7px;font-size:12px;padding:6px 12px;cursor:pointer}
  .btn-sm-o:hover{border-color:var(--amb);color:var(--amb)}
  .main{flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .page-ctr{width:100%;max-width:500px;padding:28px 20px;overflow-y:auto;max-height:100%}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeUp .3s ease both}
  .hero{margin-bottom:22px}
  .hero h1{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(22px,4vw,34px);line-height:1.1;letter-spacing:-0.03em}
  .hero p{color:var(--mut);margin-top:6px;font-size:13px}
  .upload-zone{border:2px dashed var(--brd);border-radius:var(--rl);padding:38px 24px;text-align:center;cursor:pointer;transition:all .2s;background:var(--s1)}
  .upload-zone:hover,.upload-zone.active{border-color:var(--amb);background:var(--amd)}
  .upload-icon{width:44px;height:44px;margin:0 auto 12px;color:var(--amb)}
  .upload-icon svg{width:100%;height:100%}
  .upload-title{font-family:'Syne',sans-serif;font-weight:700;font-size:15px;margin-bottom:5px}
  .upload-sub{color:var(--mut);font-size:12px;margin-bottom:16px}
  .btn-outline{background:transparent;color:var(--txt);border:1.5px solid var(--brd);border-radius:var(--r);font-size:13px;padding:8px 16px;cursor:pointer;transition:all .2s}
  .btn-outline:hover{border-color:var(--amb);color:var(--amb)}
  .btn-primary{display:inline-flex;align-items:center;gap:8px;justify-content:center;background:var(--amb);color:#0d0f12;border:none;border-radius:var(--r);font-family:'Syne',sans-serif;font-weight:700;font-size:14px;padding:11px 20px;cursor:pointer;transition:all .2s;width:100%;box-shadow:0 0 14px var(--amg)}
  .btn-primary:hover{background:#fbbf24}
  .btn-ghost{background:transparent;border:none;color:var(--mut);font-size:13px;cursor:pointer;transition:color .2s;padding:4px 0;display:block;margin-top:6px}
  .btn-ghost:hover{color:var(--txt)}
  .err-banner{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:var(--r);padding:10px 14px;color:#f87171;font-size:12px;margin-bottom:14px}
  .file-card{margin-top:14px;background:var(--s1);border:1px solid var(--brd);border-radius:var(--rl);padding:14px;display:flex;flex-direction:column;gap:11px}
  .file-row{display:flex;align-items:center;gap:10px}
  .fname{font-weight:500;font-size:13px}
  .fmeta{font-size:11px;color:var(--mut);font-family:'JetBrains Mono',monospace}
  .clear-btn{margin-left:auto;background:none;border:none;color:var(--mut);font-size:18px;cursor:pointer;line-height:1}
  .clear-btn:hover{color:var(--red)}
  .fld{display:flex;flex-direction:column;gap:5px}
  .fld label{font-size:11px;color:var(--mut);font-weight:500;letter-spacing:.05em;text-transform:uppercase}
  .fld select{background:var(--s2);border:1.5px solid var(--brd);border-radius:var(--r);color:var(--txt);font-size:13px;padding:8px 10px;cursor:pointer;outline:none}
  .fld select:focus{border-color:var(--amb)}
  .processing-view{text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 0}
  .spinner-wrap{position:relative;width:58px;height:58px;display:flex;align-items:center;justify-content:center}
  .spinner-ring{position:absolute;inset:0;color:var(--amb);animation:spin 1.4s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner-icon{color:var(--amb);width:22px;height:22px}
  .proc-title{font-family:'Syne',sans-serif;font-weight:700;font-size:18px}
  .proc-file{font-size:11px;color:var(--mut);font-family:'JetBrains Mono',monospace;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .proc-steps{display:flex;gap:5px;flex-wrap:wrap;justify-content:center}
  .sbadge{font-size:10px;padding:3px 9px;border-radius:20px;border:1px solid var(--brd);color:var(--mut);background:var(--s1);font-family:'JetBrains Mono',monospace}
  .sbadge.active{border-color:var(--amb);color:var(--amb);background:var(--amd)}
  .editor-page{width:100%;height:100%;display:flex;overflow:hidden}
  .vid-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px;gap:4px}
  .drag-hint{font-size:11px;color:var(--mut);text-align:center}
  .right-panel{width:290px;flex-shrink:0;border-left:1px solid var(--brd);display:flex;flex-direction:column;overflow:hidden;background:var(--s1)}
  .tab-bar{display:flex;border-bottom:1px solid var(--brd);flex-shrink:0}
  .tab-btn{flex:1;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--mut);font-size:12px;font-weight:500;padding:11px 8px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:5px;margin-bottom:-1px}
  .tab-btn.on{color:var(--amb);border-bottom-color:var(--amb)}
  .tbadge{background:var(--s2);border:1px solid var(--brd);border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:9px;padding:1px 6px;color:var(--mut)}
  .tab-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
  .tab-body.no-pad{padding:0;flex:1;overflow:hidden;display:flex;flex-direction:column}
  .tab-body::-webkit-scrollbar{width:3px}
  .tab-body::-webkit-scrollbar-thumb{background:var(--brd);border-radius:3px}
  .sec-label{font-size:10px;color:var(--mut);font-weight:500;letter-spacing:.06em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center}
  .sec-label.mt8{margin-top:4px}
  .val{color:var(--amb);font-family:'JetBrains Mono',monospace;font-size:10px}
  .presets-wrap{display:flex;flex-wrap:wrap;gap:5px}
  .preset-pill{background:var(--s2);border:1.5px solid var(--brd);border-radius:20px;color:var(--mut);font-size:11px;padding:4px 10px;cursor:pointer;transition:all .2s;white-space:nowrap}
  .preset-pill.on{border-color:var(--amb);color:var(--amb);background:var(--amd)}
  .divider{height:1px;background:var(--brd);margin:4px 0}
  .sel{background:var(--s2);border:1.5px solid var(--brd);border-radius:var(--r);color:var(--txt);font-size:12px;padding:7px 9px;cursor:pointer;outline:none;width:100%}
  .sel:focus{border-color:var(--amb)}
  .size-row{display:flex;align-items:center;gap:6px}
  .size-btn{background:var(--s2);border:1px solid var(--brd);border-radius:6px;color:var(--txt);font-size:16px;width:26px;height:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1}
  .size-btn:hover{border-color:var(--amb);color:var(--amb)}
  .size-num{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--amb);min-width:26px;text-align:center;flex-shrink:0}
  .rng{flex:1;accent-color:var(--amb);cursor:pointer}
  .color-row{display:flex;align-items:center;gap:7px}
  .cpick{width:26px;height:26px;border:none;background:none;cursor:pointer;padding:0;border-radius:5px;flex-shrink:0}
  .chex{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mut)}
  .chips{display:flex;gap:5px;margin-top:3px}
  .chip{width:18px;height:18px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .15s}
  .chip.on{border-color:var(--amb);transform:scale(1.2)}
  .sub-list{flex:1;overflow-y:auto}
  .sub-list::-webkit-scrollbar{width:3px}
  .sub-list::-webkit-scrollbar-thumb{background:var(--brd);border-radius:3px}
  .sub-item{display:grid;grid-template-columns:20px 1fr auto;gap:4px 7px;padding:8px 10px;border-bottom:1px solid var(--brd);transition:background .15s}
  .sub-item:last-child{border-bottom:none}
  .sub-item:hover{background:rgba(255,255,255,0.02)}
  .sub-item.hi{background:var(--amd);border-left:2px solid var(--amb)}
  .si-n{grid-row:1/3;align-self:center;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mut);text-align:center}
  .si-body{display:flex;flex-direction:column;gap:3px}
  .si-times{display:flex;align-items:center;gap:3px}
  .tc{background:var(--s2);border:1px solid var(--brd);border-radius:4px;color:var(--txt);font-family:'JetBrains Mono',monospace;font-size:9px;padding:2px 5px;width:82px;outline:none}
  .tc:focus{border-color:var(--amb)}
  .tc-arr{color:var(--mut);font-size:9px}
  .si-txt{background:transparent;border:none;color:var(--txt);font-family:'DM Sans',sans-serif;font-size:12px;resize:none;outline:none;width:100%;line-height:1.4;padding:0}
  .si-meta{grid-row:1/3;align-self:center;display:flex;flex-direction:column;align-items:center;gap:5px}
  .cdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
  .del-btn{background:none;border:none;color:var(--mut);font-size:14px;cursor:pointer;transition:color .2s;line-height:1}
  .del-btn:hover{color:var(--red)}
  .export-panel{display:flex;flex-direction:column;gap:18px}
  .export-panel h3{font-family:'Syne',sans-serif;font-weight:800;font-size:24px}
  .export-sub{color:var(--mut);font-size:13px;margin-top:-10px}
  .export-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
  .export-card{background:var(--s1);border:1.5px solid var(--brd);border-radius:var(--rl);padding:15px 13px;display:flex;flex-direction:column;align-items:flex-start;gap:4px;cursor:pointer;transition:all .2s;text-align:left}
  .export-card:hover{border-color:var(--amb);background:var(--amd)}
  .export-card.accent{border-color:var(--amb);background:var(--amd)}
  .export-card.loading{opacity:.6;cursor:wait}
  .export-card.done{border-color:var(--grn);background:rgba(52,211,153,0.08)}
  .ei{font-size:19px}.el{font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--txt)}.ed{font-size:11px;color:var(--mut)}
  @media(max-width:700px){.right-panel{width:250px}}
  @media(max-width:600px){.editor-page{flex-direction:column}.vid-col{flex:none;height:55%}.right-panel{width:100%;border-left:none;border-top:1px solid var(--brd)}}
`;
