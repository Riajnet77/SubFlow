import { useState, useRef, useCallback, useEffect, DragEvent } from "react";

interface Subtitle { start: number; end: number; text: string; confidence: number; }
interface SubBox { x: number; y: number; w: number; h: number; } // % of video dimensions
interface SubStyle {
  fontSize: number; fontName: string;
  primaryColor: string; outlineColor: string;
  bgOpacity: number; preset: string;
  box: SubBox;
}
type Step = "upload"|"processing"|"edit"|"export";

const LANGUAGES = [
  {code:"original",label:"Original (no translation)"},
  {code:"English",label:"English"},{code:"Portuguese",label:"Portuguese"},
  {code:"Spanish",label:"Spanish"},{code:"French",label:"French"},
  {code:"German",label:"German"},{code:"Italian",label:"Italian"},
  {code:"Japanese",label:"Japanese"},{code:"Korean",label:"Korean"},
  {code:"Chinese",label:"Chinese"},{code:"Russian",label:"Russian"},
  {code:"Arabic",label:"Arabic"},{code:"Hindi",label:"Hindi"},
];
const FONTS = ["Arial","Impact","Georgia","Verdana","Trebuchet MS","Tahoma","Courier New","Times New Roman"];

const PRESETS: Record<string,Partial<SubStyle>> = {
  impact:  {fontName:"Impact", fontSize:26,primaryColor:"#FFFFFF",outlineColor:"#000000",bgOpacity:0},
  bold:    {fontName:"Impact", fontSize:30,primaryColor:"#FFFF00",outlineColor:"#000000",bgOpacity:0},
  neon:    {fontName:"Arial",  fontSize:22,primaryColor:"#00FFFF",outlineColor:"#0055FF",bgOpacity:0},
  fire:    {fontName:"Impact", fontSize:24,primaryColor:"#FF4500",outlineColor:"#FFD700",bgOpacity:0},
  ice:     {fontName:"Arial",  fontSize:20,primaryColor:"#E0F7FF",outlineColor:"#0099CC",bgOpacity:0.3},
  cinema:  {fontName:"Georgia",fontSize:18,primaryColor:"#FFFFFF",outlineColor:"#000000",bgOpacity:0.7},
  minimal: {fontName:"Arial",  fontSize:16,primaryColor:"#FFFFFF",outlineColor:"#222222",bgOpacity:0},
  classic: {fontName:"Arial",  fontSize:18,primaryColor:"#FFFFFF",outlineColor:"#000000",bgOpacity:0.5},
};

const PRESET_LIST = [
  {key:"impact",label:"Impact",emoji:"💥"},
  {key:"bold",  label:"Bold",  emoji:"⚡"},
  {key:"neon",  label:"Neon",  emoji:"🌀"},
  {key:"fire",  label:"Fire",  emoji:"🔥"},
  {key:"ice",   label:"Ice",   emoji:"❄️"},
  {key:"cinema",label:"Cinema",emoji:"🎬"},
  {key:"minimal",label:"Minimal",emoji:"◻️"},
  {key:"classic",label:"Classic",emoji:"📺"},
];

const DEFAULT_BOX: SubBox = {x:5, y:75, w:90, h:18};
const DEFAULT_STYLE: SubStyle = {
  ...PRESETS.impact as SubStyle,
  fontSize:26, fontName:"Impact",
  primaryColor:"#FFFFFF", outlineColor:"#000000", bgOpacity:0,
  preset:"impact", box:DEFAULT_BOX,
};

function toTimecode(s:number){
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.round((s%1)*1000);
  return`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
}
function formatSize(b:number){return b<1024*1024?`${(b/1024).toFixed(1)} KB`:`${(b/(1024*1024)).toFixed(1)} MB`;}

// ─── Draggable+Resizable Subtitle Box on Video ────────────────────────────────
function SubtitleBox({text, style, onChange, active}:{text:string; style:SubStyle; onChange:(s:SubStyle)=>void; active:boolean}){
  const [selected, setSelected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const action = useRef<{type:string;startX:number;startY:number;startBox:SubBox}|null>(null);

  // Deselect on click outside
  useEffect(()=>{
    const handler = (e:MouseEvent) => {
      if(containerRef.current && !containerRef.current.contains(e.target as Node)){
        setSelected(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  },[]);

  const getParentSize = () => {
    const p = containerRef.current?.parentElement;
    return p ? {w:p.clientWidth, h:p.clientHeight} : {w:1,h:1};
  };

  const clampBox = (b:SubBox):SubBox => ({
    x: Math.max(0, Math.min(100-b.w, b.x)),
    y: Math.max(0, Math.min(100-b.h, b.y)),
    w: Math.max(15, Math.min(100-b.x, b.w)),
    h: Math.max(8,  Math.min(100-b.y, b.h)),
  });

  const onPointerDown = (e:React.PointerEvent, type:string) => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    action.current = {type, startX:e.clientX, startY:e.clientY, startBox:{...style.box}};
  };

  const onPointerMove = (e:React.PointerEvent) => {
    if(!action.current) return;
    const {type,startX,startY,startBox} = action.current;
    const {w:pw,h:ph} = getParentSize();
    const dx = ((e.clientX-startX)/pw)*100;
    const dy = ((e.clientY-startY)/ph)*100;
    let nb = {...startBox};
    if(type==="move")  { nb.x=startBox.x+dx; nb.y=startBox.y+dy; }
    if(type==="se")    { nb.w=startBox.w+dx; nb.h=startBox.h+dy; }
    if(type==="sw")    { nb.x=startBox.x+dx; nb.w=startBox.w-dx; nb.h=startBox.h+dy; }
    if(type==="ne")    { nb.y=startBox.y+dy; nb.w=startBox.w+dx; nb.h=startBox.h-dy; }
    if(type==="nw")    { nb.x=startBox.x+dx; nb.y=startBox.y+dy; nb.w=startBox.w-dx; nb.h=startBox.h-dy; }
    if(type==="n")     { nb.y=startBox.y+dy; nb.h=startBox.h-dy; }
    if(type==="s")     { nb.h=startBox.h+dy; }
    if(type==="e")     { nb.w=startBox.w+dx; }
    if(type==="w")     { nb.x=startBox.x+dx; nb.w=startBox.w-dx; }
    onChange({...style, box:clampBox(nb), preset:"custom"});
  };

  const onPointerUp = () => { action.current=null; };

  const scaledFontSize = Math.max(10, style.fontSize * 0.55);
  const textShadow = style.bgOpacity===0
    ? `1px 1px 3px ${style.outlineColor},-1px -1px 3px ${style.outlineColor},1px -1px 3px ${style.outlineColor},-1px 1px 3px ${style.outlineColor}`
    : "none";

  return (
    <div ref={containerRef}
      style={{
        position:"absolute",
        left:`${style.box.x}%`, top:`${style.box.y}%`,
        width:`${style.box.w}%`, height:`${style.box.h}%`,
        border: selected ? "2px solid #f59e0b" : "1.5px dashed rgba(255,255,255,0.5)",
        borderRadius:4, zIndex:20, cursor:"move",
        background: selected ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.03)",
        display:"flex", alignItems:"center", justifyContent:"center",
        overflow:"visible",
        boxShadow: selected ? "0 0 0 1px rgba(245,158,11,0.3)" : "0 0 0 1px rgba(0,0,0,0.4)",
        transition:"border-color .15s, background .15s",
      }}
      onPointerDown={e=>{setSelected(true);onPointerDown(e,"move");}}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Text */}
      <span style={{
        fontFamily:style.fontName, fontSize:scaledFontSize+"px",
        color:style.primaryColor, textShadow,
        background:style.bgOpacity>0?`rgba(0,0,0,${style.bgOpacity})`:"transparent",
        padding:style.bgOpacity>0?"2px 8px":"0",
        borderRadius:style.bgOpacity>0?"3px":"0",
        textAlign:"center", lineHeight:1.25,
        maxWidth:"100%", wordBreak:"break-word",
        whiteSpace:"pre-wrap", pointerEvents:"none",
        display:"inline-block",
      }}>{text||"Sample text"}</span>

      {/* Resize handles - only when selected */}
      {selected && [
        {key:"nw",style:{top:-5,left:-5,cursor:"nw-resize"}},
        {key:"ne",style:{top:-5,right:-5,cursor:"ne-resize"}},
        {key:"sw",style:{bottom:-5,left:-5,cursor:"sw-resize"}},
        {key:"se",style:{bottom:-5,right:-5,cursor:"se-resize"}},
        {key:"n", style:{top:-5,left:"50%",transform:"translateX(-50%)",cursor:"n-resize"}},
        {key:"s", style:{bottom:-5,left:"50%",transform:"translateX(-50%)",cursor:"s-resize"}},
        {key:"e", style:{right:-5,top:"50%",transform:"translateY(-50%)",cursor:"e-resize"}},
        {key:"w", style:{left:-5,top:"50%",transform:"translateY(-50%)",cursor:"w-resize"}},
      ].map(h=>(
        <div key={h.key}
          style={{
            position:"absolute", width:10, height:10,
            background:"#f59e0b", border:"1.5px solid #fff",
            borderRadius:2, zIndex:30, ...h.style as any,
          }}
          onPointerDown={e=>onPointerDown(e,h.key)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}
      {/* Deselect hint */}
      {selected && (
        <div style={{position:"absolute",top:-22,right:0,fontSize:10,color:"rgba(255,255,255,0.6)",whiteSpace:"nowrap",pointerEvents:"none",background:"rgba(0,0,0,0.5)",padding:"2px 5px",borderRadius:3}}>
          click outside to deselect
        </div>
      )}
    </div>
  );
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────
function UploadZone({onFile}:{onFile:(f:File)=>void}){
  const [drag,setDrag]=useState(false);
  const ref=useRef<HTMLInputElement>(null);
  return(
    <div className={`upload-zone ${drag?"active":""}`}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={(e:DragEvent<HTMLDivElement>)=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)onFile(f);}}
      onClick={()=>ref.current?.click()}>
      <input ref={ref} type="file" accept="video/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);}}/>
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
      <div className="processing-spinner">
        <svg viewBox="0 0 50 50" className="spinner-ring"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="94 32" strokeLinecap="round"/></svg>
        <div className="spinner-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M9 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-4M9 7V5a2 2 0 014 0v2M9 7h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>
      </div>
      <p className="processing-title">Transcribing{dots}</p>
      <p className="processing-file">{fileName}</p>
      <div className="processing-steps">
        <span className="step-badge active">Extracting audio</span>
        <span className="step-badge">Whisper AI</span>
        <span className="step-badge">Translating</span>
      </div>
    </div>
  );
}

// ─── Style Controls ───────────────────────────────────────────────────────────
function StyleControls({style,onChange}:{style:SubStyle;onChange:(s:SubStyle)=>void}){
  const set=(p:Partial<SubStyle>)=>onChange({...style,...p,preset:"custom"});
  const applyPreset=(key:string)=>onChange({...style,...PRESETS[key],preset:key});

  return(
    <div className="style-controls">
      {/* Presets */}
      <div className="ctrl-section">
        <div className="ctrl-label">Preset</div>
        <div className="presets-scroll">
          {PRESET_LIST.map(p=>(
            <button key={p.key} className={`preset-pill ${style.preset===p.key?"on":""}`} onClick={()=>applyPreset(p.key)}>
              {p.emoji} {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ctrl-divider"/>

      {/* Font */}
      <div className="ctrl-row">
        <div className="ctrl-col">
          <div className="ctrl-label">Font</div>
          <select value={style.fontName} onChange={e=>set({fontName:e.target.value})}>
            {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="ctrl-col narrow">
          <div className="ctrl-label">Size <span className="ctrl-val">{style.fontSize}px</span></div>
          <div className="size-btns">
            <button className="size-btn" onClick={()=>set({fontSize:Math.max(10,style.fontSize-2)})}> − </button>
            <span className="size-num">{style.fontSize}</span>
            <button className="size-btn" onClick={()=>set({fontSize:Math.min(72,style.fontSize+2)})}> + </button>
          </div>
        </div>
      </div>

      {/* Size slider */}
      <div className="ctrl-col" style={{marginTop:4}}>
        <input type="range" min={10} max={72} value={style.fontSize} onChange={e=>set({fontSize:Number(e.target.value)})} style={{width:"100%",accentColor:"var(--amber)"}}/>
      </div>

      <div className="ctrl-divider"/>

      {/* Colors */}
      <div className="ctrl-row">
        <div className="ctrl-col">
          <div className="ctrl-label">Text color</div>
          <div className="color-row">
            <input type="color" value={style.primaryColor} onChange={e=>set({primaryColor:e.target.value})}/>
            <span className="color-hex">{style.primaryColor}</span>
          </div>
          <div className="color-chips">
            {["#FFFFFF","#FFFF00","#00FFFF","#FF4500","#FF69B4","#000000"].map(c=>(
              <button key={c} className={`chip ${style.primaryColor===c?"on":""}`}
                style={{background:c,border:["#FFFFFF","#FFFF00"].includes(c)?"1px solid #555":"none"}}
                onClick={()=>set({primaryColor:c})}/>
            ))}
          </div>
        </div>
        <div className="ctrl-col">
          <div className="ctrl-label">Outline</div>
          <div className="color-row">
            <input type="color" value={style.outlineColor} onChange={e=>set({outlineColor:e.target.value})}/>
            <span className="color-hex">{style.outlineColor}</span>
          </div>
          <div className="color-chips">
            {["#000000","#FFFFFF","#0055FF","#FFD700","#FF4500"].map(c=>(
              <button key={c} className={`chip ${style.outlineColor===c?"on":""}`}
                style={{background:c,border:c==="#FFFFFF"?"1px solid #555":"none"}}
                onClick={()=>set({outlineColor:c})}/>
            ))}
          </div>
        </div>
      </div>

      <div className="ctrl-divider"/>

      {/* Background */}
      <div className="ctrl-col">
        <div className="ctrl-label">Background opacity <span className="ctrl-val">{style.bgOpacity===0?"off":`${Math.round(style.bgOpacity*100)}%`}</span></div>
        <input type="range" min={0} max={1} step={0.05} value={style.bgOpacity} onChange={e=>set({bgOpacity:Number(e.target.value)})} style={{width:"100%",accentColor:"var(--amber)"}}/>
      </div>
    </div>
  );
}

// ─── Subtitle List ────────────────────────────────────────────────────────────
function SubtitleList({subtitles,onChange,currentTime}:{subtitles:Subtitle[];onChange:(s:Subtitle[])=>void;currentTime:number}){
  const listRef=useRef<HTMLDivElement>(null);
  const activeIdx=subtitles.findIndex(s=>currentTime>=s.start&&currentTime<=s.end);
  useEffect(()=>{
    if(activeIdx>=0&&listRef.current){
      const el=listRef.current.children[activeIdx] as HTMLElement;
      el?.scrollIntoView({block:"nearest",behavior:"smooth"});
    }
  },[activeIdx]);
  const upd=(i:number,text:string)=>{const n=[...subtitles];n[i]={...n[i],text};onChange(n);};
  const updT=(i:number,f:"start"|"end",v:string)=>{
    const p=v.split(":").map(Number);
    const s=(p[0]||0)*3600+(p[1]||0)*60+(p[2]||0);
    if(!isNaN(s)){const n=[...subtitles];n[i]={...n[i],[f]:s};onChange(n);}
  };
  return(
    <div className="sub-list-wrap">
      <div className="sub-list-header">
        <span className="sub-list-title">Subtitles</span>
        <span className="count-badge">{subtitles.length}</span>
      </div>
      <div className="sub-list" ref={listRef}>
        {subtitles.map((sub,i)=>(
          <div key={i} className={`sub-item ${activeIdx===i?"hi":""}`}>
            <div className="si-num">{i+1}</div>
            <div className="si-body">
              <div className="si-times">
                <input className="tc" defaultValue={toTimecode(sub.start)} onBlur={e=>updT(i,"start",e.target.value)}/>
                <span className="tc-arr">→</span>
                <input className="tc" defaultValue={toTimecode(sub.end)} onBlur={e=>updT(i,"end",e.target.value)}/>
              </div>
              <textarea className="si-text" value={sub.text} onChange={e=>upd(i,e.target.value)} rows={2}/>
            </div>
            <div className="si-meta">
              <span className="conf-dot" style={{background:sub.confidence>0.85?"var(--green)":sub.confidence>0.7?"var(--amber)":"var(--red)"}}/>
              <button className="del-btn" onClick={()=>onChange(subtitles.filter((_,j)=>j!==i))}>×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────
function ExportPanel({subtitles,videoFile,style,onBack}:{subtitles:Subtitle[];videoFile:File|null;style:SubStyle;onBack:()=>void}){
  const [rendering,setRendering]=useState(false);
  const [done,setDone]=useState(false);
  const dl=(url:string,name:string)=>{const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
  const post=(path:string,name:string)=>fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subtitles})}).then(r=>r.blob()).then(b=>dl(URL.createObjectURL(b),name));
  const render=async()=>{
    if(!videoFile)return;setRendering(true);
    try{
      const form=new FormData();
      form.append("video",videoFile);
      form.append("subtitles",JSON.stringify(subtitles));
      form.append("style",JSON.stringify(style));
      const res=await fetch("/api/render",{method:"POST",body:form});
      if(!res.ok)throw new Error();
      dl(URL.createObjectURL(await res.blob()),"subflow_export.mp4");
      setDone(true);
    }catch{alert("Render failed.");}
    finally{setRendering(false);}
  };
  return(
    <div className="export-panel">
      <h3>Export</h3>
      <p className="export-sub">Choose your output format</p>
      <div className="export-grid">
        <button className="export-card" onClick={()=>post("/api/export/srt","subtitles.srt")}><span className="ei">📄</span><span className="el">SRT File</span><span className="ed">Most video players</span></button>
        <button className="export-card" onClick={()=>post("/api/export/vtt","subtitles.vtt")}><span className="ei">🌐</span><span className="el">WebVTT</span><span className="ed">Web players</span></button>
        <button className="export-card" onClick={()=>navigator.clipboard.writeText(subtitles.map(s=>s.text).join("\n"))}><span className="ei">📋</span><span className="el">Copy Text</span><span className="ed">Plain transcript</span></button>
        <button className={`export-card accent ${rendering?"loading":""} ${done?"done":""}`} onClick={render} disabled={rendering||!videoFile}>
          <span className="ei">{done?"✅":"🎬"}</span>
          <span className="el">{rendering?"Rendering…":done?"Downloaded!":"Burn to Video"}</span>
          <span className="ed">Embed subtitles into MP4</span>
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

  const handleFile=useCallback((f:File)=>{
    setVideoFile(f);
    setVideoUrl(URL.createObjectURL(f));
    setError(null);
  },[]);

  const startTranscription=async()=>{
    if(!videoFile)return;
    setStep("processing");setError(null);
    try{
      const form=new FormData();
      form.append("video",videoFile);
      form.append("targetLang",targetLang);
      const res=await fetch("/api/transcribe",{method:"POST",body:form});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error??"Transcription failed.");
      setSubtitles(data.subtitles);
      setStep("edit");
    }catch(e:any){setError(e.message??"Unknown error.");setStep("upload");}
  };

  const currentSub=subtitles.find(s=>currentTime>=s.start&&currentTime<=s.end);
  const stepIndex=["upload","processing","edit","export"].indexOf(step);

  return(
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* Header */}
        <header className="header">
          <div className="logo">
            <svg viewBox="0 0 32 32" fill="none" width="22" height="22"><rect x="2" y="6" width="28" height="20" rx="3" stroke="#f59e0b" strokeWidth="1.5"/><path d="M13 13L19 16L13 19V13Z" fill="#f59e0b"/><path d="M2 12H30" stroke="#f59e0b" strokeWidth="1.5"/><circle cx="6" cy="9" r="1" fill="#f59e0b"/><circle cx="9.5" cy="9" r="1" fill="#f59e0b"/><circle cx="13" cy="9" r="1" fill="#f59e0b"/></svg>
            <span className="logo-text">SubFlow</span>
          </div>
          <div className="steps-nav">
            {[1,2,3,4].map((n,i)=>(
              <span key={n} className={`step-dot ${stepIndex===i?"active":""} ${stepIndex>i?"done":""}`}>{n}</span>
            ))}
          </div>
          {step==="edit"&&(
            <div className="hdr-acts">
              <button className="btn-sm-outline" onClick={()=>setStep("upload")}>← New</button>
              <button className="btn-sm-primary" onClick={()=>setStep("export")}>Export →</button>
            </div>
          )}
        </header>

        <main className="main">
          {/* Upload */}
          {step==="upload"&&(
            <div className="page-center fade-in">
              <div className="panel-hero">
                <h1>Transcribe & translate<br/>your videos</h1>
                <p>Powered by Whisper AI — free, fast, no subscription</p>
              </div>
              {error&&<div className="error-banner">⚠ {error}</div>}
              <UploadZone onFile={handleFile}/>
              {videoFile&&(
                <div className="file-card fade-in">
                  <div className="file-row">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{color:"var(--amber)",flexShrink:0}}><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 9L15 12L10 15V9Z" fill="currentColor"/></svg>
                    <div><p className="fname">{videoFile.name}</p><p className="fmeta">{formatSize(videoFile.size)}</p></div>
                    <button className="clear-btn" onClick={()=>{setVideoFile(null);setVideoUrl("");}}>×</button>
                  </div>
                  <div className="field">
                    <label>Translate to</label>
                    <select value={targetLang} onChange={e=>setTargetLang(e.target.value)}>
                      {LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <button className="btn-primary" onClick={startTranscription}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/></svg>
                    Start transcription
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Processing */}
          {step==="processing"&&(
            <div className="page-center fade-in"><ProcessingView fileName={videoFile?.name??""}/></div>
          )}

          {/* Editor */}
          {step==="edit"&&(
            <div className="editor-page fade-in">
              {/* Left: video */}
              <div className="video-col">
                <div className="video-wrap">
                  <video src={videoUrl} controls className="video-el"
                    onTimeUpdate={e=>setCurrentTime((e.target as HTMLVideoElement).currentTime)}/>
                  {/* Subtitle box overlay */}
                  <SubtitleBox
                    text={currentSub?.text??"Sample subtitle text"}
                    style={style}
                    onChange={setStyle}
                    active={!!currentSub}
                  />
                </div>
                <p className="drag-hint">⠿ Drag box to move · drag corners to resize</p>
              </div>

              {/* Right: controls */}
              <div className="controls-col">
                <div className="controls-scroll">
                  <StyleControls style={style} onChange={setStyle}/>
                  <div className="ctrl-divider"/>
                  <SubtitleList subtitles={subtitles} onChange={setSubtitles} currentTime={currentTime}/>
                </div>
              </div>
            </div>
          )}

          {/* Export */}
          {step==="export"&&(
            <div className="page-center fade-in">
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
  :root{--bg:#0d0f12;--s1:#161920;--s2:#1e2229;--brd:rgba(255,255,255,0.07);--txt:#e8eaf0;--mut:#6b7280;--amb:#f59e0b;--amd:rgba(245,158,11,0.12);--amg:rgba(245,158,11,0.25);--grn:#34d399;--red:#f87171;--r:10px;--rl:16px;}
  html,body,#root{height:100%;overflow:hidden}
  body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .app{height:100vh;display:flex;flex-direction:column}
  /* Header */
  .header{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--brd);background:rgba(13,15,18,0.97);flex-shrink:0;z-index:100}
  .logo{display:flex;align-items:center;gap:8px;margin-right:auto}
  .logo-text{font-family:'Syne',sans-serif;font-weight:800;font-size:17px;letter-spacing:-0.02em;color:var(--txt)}
  .steps-nav{display:flex;gap:5px}
  .step-dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:10px;font-weight:700;border:1.5px solid var(--brd);color:var(--mut);background:var(--s1);transition:all .2s}
  .step-dot.active{border-color:var(--amb);color:var(--amb);background:var(--amd)}
  .step-dot.done{border-color:var(--grn);color:var(--grn);background:rgba(52,211,153,0.1)}
  .hdr-acts{display:flex;gap:8px}
  .btn-sm-primary{background:var(--amb);color:#0d0f12;border:none;border-radius:8px;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:7px 14px;cursor:pointer;transition:all .2s}
  .btn-sm-primary:hover{background:#fbbf24}
  .btn-sm-outline{background:transparent;color:var(--txt);border:1.5px solid var(--brd);border-radius:8px;font-size:12px;padding:6px 12px;cursor:pointer;transition:all .2s}
  .btn-sm-outline:hover{border-color:var(--amb);color:var(--amb)}
  /* Main */
  .main{flex:1;overflow:hidden;display:flex}
  .page-center{width:100%;max-width:520px;margin:auto;padding:28px 20px;overflow-y:auto;max-height:100%}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeUp .3s ease both}
  .panel-hero{margin-bottom:24px}
  .panel-hero h1{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(22px,4vw,34px);line-height:1.1;letter-spacing:-0.03em}
  .panel-hero p{color:var(--mut);margin-top:6px;font-size:13px}
  .upload-zone{border:2px dashed var(--brd);border-radius:var(--rl);padding:40px 28px;text-align:center;cursor:pointer;transition:all .2s;background:var(--s1)}
  .upload-zone:hover,.upload-zone.active{border-color:var(--amb);background:var(--amd)}
  .upload-icon{width:46px;height:46px;margin:0 auto 12px;color:var(--amb)}
  .upload-icon svg{width:100%;height:100%}
  .upload-title{font-family:'Syne',sans-serif;font-weight:700;font-size:15px;margin-bottom:6px}
  .upload-sub{color:var(--mut);font-size:12px;margin-bottom:18px}
  .btn-outline{background:transparent;color:var(--txt);border:1.5px solid var(--brd);border-radius:var(--r);font-size:13px;padding:9px 18px;cursor:pointer;transition:all .2s}
  .btn-outline:hover{border-color:var(--amb);color:var(--amb)}
  .btn-primary{display:inline-flex;align-items:center;gap:8px;justify-content:center;background:var(--amb);color:#0d0f12;border:none;border-radius:var(--r);font-family:'Syne',sans-serif;font-weight:700;font-size:14px;padding:11px 22px;cursor:pointer;transition:all .2s;width:100%;box-shadow:0 0 16px var(--amg)}
  .btn-primary:hover{background:#fbbf24}
  .btn-ghost{background:transparent;border:none;color:var(--mut);font-size:13px;cursor:pointer;transition:color .2s;padding:4px 0;display:block;margin-top:8px}
  .btn-ghost:hover{color:var(--txt)}
  .error-banner{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:var(--r);padding:11px 14px;color:#f87171;font-size:13px;margin-bottom:14px}
  .file-card{margin-top:14px;background:var(--s1);border:1px solid var(--brd);border-radius:var(--rl);padding:14px;display:flex;flex-direction:column;gap:12px}
  .file-row{display:flex;align-items:center;gap:10px}
  .fname{font-weight:500;font-size:13px}
  .fmeta{font-size:11px;color:var(--mut);font-family:'JetBrains Mono',monospace}
  .clear-btn{margin-left:auto;background:none;border:none;color:var(--mut);font-size:18px;cursor:pointer;padding:2px 5px;border-radius:4px;transition:color .2s;line-height:1}
  .clear-btn:hover{color:var(--red)}
  .field{display:flex;flex-direction:column;gap:5px}
  .field label{font-size:11px;color:var(--mut);font-weight:500;letter-spacing:.05em;text-transform:uppercase}
  .field select{background:var(--s2);border:1.5px solid var(--brd);border-radius:var(--r);color:var(--txt);font-size:13px;padding:8px 10px;cursor:pointer;outline:none;transition:border-color .2s}
  .field select:focus{border-color:var(--amb)}
  .processing-view{text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 0}
  .processing-spinner{position:relative;width:60px;height:60px;display:flex;align-items:center;justify-content:center}
  .spinner-ring{position:absolute;inset:0;color:var(--amb);animation:spin 1.4s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner-icon{color:var(--amb);width:24px;height:24px}
  .spinner-icon svg{width:100%;height:100%}
  .processing-title{font-family:'Syne',sans-serif;font-weight:700;font-size:18px}
  .processing-file{font-size:12px;color:var(--mut);font-family:'JetBrains Mono',monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .processing-steps{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
  .step-badge{font-size:10px;padding:3px 9px;border-radius:20px;border:1px solid var(--brd);color:var(--mut);background:var(--s1);font-family:'JetBrains Mono',monospace}
  .step-badge.active{border-color:var(--amb);color:var(--amb);background:var(--amd)}
  /* Editor page */
  .editor-page{width:100%;height:100%;display:flex;overflow:hidden}
  .video-col{flex:0 0 auto;width:min(420px,55%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;background:var(--bg);gap:8px;border-right:1px solid var(--brd)}
  .video-wrap{position:relative;width:100%;background:#000;border-radius:12px;overflow:hidden}
  .video-el{width:100%;display:block;max-height:calc(100vh - 120px);object-fit:contain}
  .drag-hint{font-size:11px;color:var(--mut);text-align:center}
  .controls-col{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
  .controls-scroll{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:0}
  .controls-scroll::-webkit-scrollbar{width:4px}
  .controls-scroll::-webkit-scrollbar-thumb{background:var(--brd);border-radius:4px}
  /* Style controls */
  .style-controls{display:flex;flex-direction:column;gap:12px}
  .ctrl-section{display:flex;flex-direction:column;gap:6px}
  .ctrl-label{font-size:11px;color:var(--mut);font-weight:500;letter-spacing:.05em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center}
  .ctrl-val{color:var(--amb);font-family:'JetBrains Mono',monospace;font-size:10px}
  .presets-scroll{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
  .presets-scroll::-webkit-scrollbar{height:3px}
  .presets-scroll::-webkit-scrollbar-thumb{background:var(--brd);border-radius:3px}
  .preset-pill{flex-shrink:0;background:var(--s2);border:1.5px solid var(--brd);border-radius:20px;color:var(--mut);font-size:11px;padding:5px 12px;cursor:pointer;transition:all .2s;white-space:nowrap}
  .preset-pill.on{border-color:var(--amb);color:var(--amb);background:var(--amd)}
  .ctrl-divider{height:1px;background:var(--brd);margin:10px 0}
  .ctrl-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .ctrl-col{display:flex;flex-direction:column;gap:5px}
  .ctrl-col.narrow{max-width:120px}
  .ctrl-col select{background:var(--s2);border:1.5px solid var(--brd);border-radius:8px;color:var(--txt);font-size:12px;padding:7px 8px;cursor:pointer;outline:none;transition:border-color .2s}
  .ctrl-col select:focus{border-color:var(--amb)}
  .size-btns{display:flex;align-items:center;gap:4px}
  .size-btn{background:var(--s2);border:1px solid var(--brd);border-radius:6px;color:var(--txt);font-size:16px;width:28px;height:28px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;line-height:1}
  .size-btn:hover{border-color:var(--amb);color:var(--amb)}
  .size-num{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--amb);min-width:24px;text-align:center}
  .color-row{display:flex;align-items:center;gap:6px}
  .color-row input[type=color]{width:26px;height:26px;border:none;background:none;cursor:pointer;padding:0;border-radius:5px;flex-shrink:0}
  .color-hex{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mut)}
  .color-chips{display:flex;gap:5px;margin-top:2px}
  .chip{width:18px;height:18px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .15s;flex-shrink:0}
  .chip.on{border-color:var(--amb);transform:scale(1.2)}
  /* Subtitle list */
  .sub-list-wrap{display:flex;flex-direction:column;gap:8px}
  .sub-list-header{display:flex;align-items:center;justify-content:space-between}
  .sub-list-title{font-family:'Syne',sans-serif;font-weight:700;font-size:13px}
  .count-badge{font-size:10px;font-family:'JetBrains Mono',monospace;background:var(--s2);border:1px solid var(--brd);border-radius:20px;padding:2px 8px;color:var(--mut)}
  .sub-list{display:flex;flex-direction:column;max-height:300px;overflow-y:auto;background:var(--s1);border:1px solid var(--brd);border-radius:var(--rl)}
  .sub-list::-webkit-scrollbar{width:3px}
  .sub-list::-webkit-scrollbar-thumb{background:var(--brd);border-radius:3px}
  .sub-item{display:grid;grid-template-columns:22px 1fr auto;gap:4px 8px;padding:9px 11px;border-bottom:1px solid var(--brd);transition:background .15s}
  .sub-item:last-child{border-bottom:none}
  .sub-item:hover{background:rgba(255,255,255,0.02)}
  .sub-item.hi{background:var(--amd);border-left:2px solid var(--amb)}
  .si-num{grid-row:1/3;align-self:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mut);text-align:center}
  .si-body{display:flex;flex-direction:column;gap:3px}
  .si-times{display:flex;align-items:center;gap:4px}
  .tc{background:var(--s2);border:1px solid var(--brd);border-radius:4px;color:var(--txt);font-family:'JetBrains Mono',monospace;font-size:10px;padding:2px 5px;width:90px;outline:none}
  .tc:focus{border-color:var(--amb)}
  .tc-arr{color:var(--mut);font-size:10px}
  .si-text{background:transparent;border:none;color:var(--txt);font-family:'DM Sans',sans-serif;font-size:12px;resize:none;outline:none;width:100%;line-height:1.4;padding:0}
  .si-meta{grid-row:1/3;align-self:center;display:flex;flex-direction:column;align-items:center;gap:5px}
  .conf-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
  .del-btn{background:none;border:none;color:var(--mut);font-size:14px;cursor:pointer;padding:1px 3px;border-radius:3px;transition:color .2s;line-height:1}
  .del-btn:hover{color:var(--red)}
  /* Export */
  .export-panel{display:flex;flex-direction:column;gap:18px}
  .export-panel h3{font-family:'Syne',sans-serif;font-weight:800;font-size:24px}
  .export-sub{color:var(--mut);font-size:13px;margin-top:-10px}
  .export-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .export-card{background:var(--s1);border:1.5px solid var(--brd);border-radius:var(--rl);padding:16px 14px;display:flex;flex-direction:column;align-items:flex-start;gap:4px;cursor:pointer;transition:all .2s;text-align:left}
  .export-card:hover{border-color:var(--amb);background:var(--amd)}
  .export-card.accent{border-color:var(--amb);background:var(--amd)}
  .export-card.loading{opacity:.6;cursor:wait}
  .export-card.done{border-color:var(--grn);background:rgba(52,211,153,0.08)}
  .ei{font-size:20px}
  .el{font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--txt)}
  .ed{font-size:11px;color:var(--mut)}
  @media(max-width:700px){.video-col{width:100%;border-right:none;border-bottom:1px solid var(--brd)}.editor-page{flex-direction:column}.controls-col{flex:1}.video-el{max-height:240px}}
`;
