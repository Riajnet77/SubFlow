import { useState, useRef, useCallback, useEffect, DragEvent, PointerEvent as ReactPointerEvent } from "react";

interface Subtitle { start: number; end: number; text: string; confidence: number; }
interface SubStyle {
  fontSize: number; fontName: string;
  primaryColor: string; outlineColor: string; bgOpacity: number;
  positionY: number; preset: string;
}
type Step = "upload"|"processing"|"edit"|"export";
type EditTab = "style"|"subtitles";

const LANGUAGES = [
  {code:"original",label:"Original language (no translation)"},
  {code:"English",label:"English"},{code:"Portuguese",label:"Portuguese"},
  {code:"Spanish",label:"Spanish"},{code:"French",label:"French"},
  {code:"German",label:"German"},{code:"Italian",label:"Italian"},
  {code:"Japanese",label:"Japanese"},{code:"Korean",label:"Korean"},
  {code:"Chinese",label:"Chinese (Simplified)"},{code:"Russian",label:"Russian"},
  {code:"Arabic",label:"Arabic"},{code:"Hindi",label:"Hindi"},
];
const FONTS = ["Arial","Impact","Georgia","Verdana","Trebuchet MS","Tahoma","Courier New"];

const PRESETS: Record<string, Partial<SubStyle>> = {
  custom:   {},
  impact:   { fontName:"Impact",  fontSize:28, primaryColor:"#FFFFFF", outlineColor:"#000000", bgOpacity:0 },
  neon:     { fontName:"Arial",   fontSize:22, primaryColor:"#00FFFF", outlineColor:"#0055FF", bgOpacity:0 },
  fire:     { fontName:"Impact",  fontSize:26, primaryColor:"#FF4500", outlineColor:"#FFD700", bgOpacity:0 },
  ice:      { fontName:"Arial",   fontSize:22, primaryColor:"#E0F7FF", outlineColor:"#0099CC", bgOpacity:0.3 },
  cinema:   { fontName:"Georgia", fontSize:20, primaryColor:"#FFFFFF", outlineColor:"#000000", bgOpacity:0.65 },
  minimal:  { fontName:"Arial",   fontSize:18, primaryColor:"#FFFFFF", outlineColor:"#222222", bgOpacity:0 },
  bold:     { fontName:"Impact",  fontSize:32, primaryColor:"#FFFF00", outlineColor:"#000000", bgOpacity:0 },
  subtitle: { fontName:"Arial",   fontSize:18, primaryColor:"#FFFFFF", outlineColor:"#000000", bgOpacity:0.5 },
};

const PRESET_META: {key:string; label:string; emoji:string}[] = [
  {key:"impact", label:"Impact",   emoji:"💥"},
  {key:"bold",   label:"Bold",     emoji:"⚡"},
  {key:"neon",   label:"Neon",     emoji:"🌀"},
  {key:"fire",   label:"Fire",     emoji:"🔥"},
  {key:"ice",    label:"Ice",      emoji:"❄️"},
  {key:"cinema", label:"Cinema",   emoji:"🎬"},
  {key:"minimal",label:"Minimal",  emoji:"◻️"},
  {key:"subtitle",label:"Classic", emoji:"📺"},
  {key:"custom", label:"Custom",   emoji:"✏️"},
];

const DEFAULT_STYLE: SubStyle = { positionY:82, preset:"impact", ...PRESETS.impact as SubStyle, fontSize:28, fontName:"Impact", primaryColor:"#FFFFFF", outlineColor:"#000000", bgOpacity:0 };

function toTimecode(s:number){ const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60),ms=Math.round((s%1)*1000); return`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${String(ms).padStart(3,"0")}`; }
function formatSize(b:number){return b<1024*1024?`${(b/1024).toFixed(1)} KB`:`${(b/(1024*1024)).toFixed(1)} MB`;}

function subOverlayStyle(style:SubStyle, scale=1): React.CSSProperties {
  return {
    fontFamily: style.fontName,
    fontSize: Math.round(style.fontSize * scale)+"px",
    color: style.primaryColor,
    background: style.bgOpacity>0 ? `rgba(0,0,0,${style.bgOpacity})` : "transparent",
    padding: style.bgOpacity>0 ? `${Math.round(4*scale)}px ${Math.round(12*scale)}px` : "0",
    borderRadius: style.bgOpacity>0 ? "5px" : "0",
    textShadow: style.bgOpacity===0
      ? `${scale}px ${scale}px ${3*scale}px ${style.outlineColor},-${scale}px -${scale}px ${3*scale}px ${style.outlineColor},${scale}px -${scale}px ${3*scale}px ${style.outlineColor},-${scale}px ${scale}px ${3*scale}px ${style.outlineColor}`
      : "none",
    lineHeight:1.25, textAlign:"center" as const,
    maxWidth:"90%", wordBreak:"break-word" as const,
    whiteSpace:"pre-wrap" as const, display:"inline-block",
    userSelect:"none" as const,
  };
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

// ─── Draggable Video Player ───────────────────────────────────────────────────
function VideoCanvas({videoUrl, subtitles, style, onStyleChange, onTimeUpdate}:{
  videoUrl:string; subtitles:Subtitle[]; style:SubStyle;
  onStyleChange:(s:SubStyle)=>void; onTimeUpdate:(t:number)=>void;
}){
  const wrapRef=useRef<HTMLDivElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null);
  const [currentTime,setCurrentTime]=useState(0);
  const dragging=useRef(false);
  const startY=useRef(0);
  const startPosY=useRef(0);

  const currentSub=subtitles.find(s=>currentTime>=s.start&&currentTime<=s.end);

  const onPointerDown=(e:ReactPointerEvent<HTMLDivElement>)=>{
    dragging.current=true;
    startY.current=e.clientY;
    startPosY.current=style.positionY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!dragging.current||!wrapRef.current)return;
    const h=wrapRef.current.getBoundingClientRect().height;
    const dy=e.clientY-startY.current;
    const newY=Math.min(95,Math.max(5,startPosY.current+(dy/h)*100));
    onStyleChange({...style,positionY:Math.round(newY),preset:"custom"});
  };
  const onPointerUp=()=>{ dragging.current=false; };

  return(
    <div className="video-canvas" ref={wrapRef}>
      <video ref={videoRef} src={videoUrl} controls className="video-el"
        onTimeUpdate={e=>{const t=(e.target as HTMLVideoElement).currentTime;setCurrentTime(t);onTimeUpdate(t);}}/>
      {/* Subtitle overlay — draggable */}
      {currentSub&&(
        <div className="sub-drag-wrap"
          style={{top:`${style.positionY}%`,transform:"translateY(-50%)"}}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}>
          <div className="sub-drag-handle" title="Drag to reposition">⠿</div>
          <span style={subOverlayStyle(style, 0.58)}>{currentSub.text}</span>
        </div>
      )}
      {/* Position indicator */}
      <div className="pos-indicator">{Math.round(style.positionY)}%</div>
    </div>
  );
}

// ─── Style Panel ──────────────────────────────────────────────────────────────
function StylePanel({style,onChange}:{style:SubStyle;onChange:(s:SubStyle)=>void}){
  const set=(p:Partial<SubStyle>)=>onChange({...style,...p,preset:"custom"});
  const applyPreset=(key:string)=>{
    if(key==="custom")return;
    onChange({...style,...PRESETS[key],preset:key});
  };
  return(
    <div className="style-grid-panel">
      {/* Presets row */}
      <div className="presets-row">
        {PRESET_META.map(p=>(
          <button key={p.key} className={`preset-card ${style.preset===p.key?"active":""}`} onClick={()=>applyPreset(p.key)}>
            <span className="preset-emoji">{p.emoji}</span>
            <span className="preset-name">{p.label}</span>
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div className="controls-row">
        {/* Font + Size */}
        <div className="ctrl-block">
          <label>Font</label>
          <select value={style.fontName} onChange={e=>set({fontName:e.target.value})}>
            {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="ctrl-block">
          <label>Size <span className="ctrl-val">{style.fontSize}px</span></label>
          <input type="range" min={12} max={52} value={style.fontSize} onChange={e=>set({fontSize:Number(e.target.value)})}/>
        </div>
        <div className="ctrl-block">
          <label>Position <span className="ctrl-val">{style.positionY}%</span></label>
          <input type="range" min={5} max={95} value={style.positionY} onChange={e=>set({positionY:Number(e.target.value)})}/>
          <div className="range-hints"><span>Top</span><span>Bottom</span></div>
        </div>
        {/* Colors */}
        <div className="ctrl-block">
          <label>Text</label>
          <div className="color-row">
            <input type="color" value={style.primaryColor} onChange={e=>set({primaryColor:e.target.value})}/>
            {["#FFFFFF","#FFFF00","#00FFFF","#FF4500","#000000"].map(c=>(
              <button key={c} className={`cdot ${style.primaryColor===c?"on":""}`} style={{background:c,border:c==="#FFFFFF"||c==="#FFFF00"?"1px solid #555":"none"}} onClick={()=>set({primaryColor:c})}/>
            ))}
          </div>
        </div>
        <div className="ctrl-block">
          <label>Outline</label>
          <div className="color-row">
            <input type="color" value={style.outlineColor} onChange={e=>set({outlineColor:e.target.value})}/>
            {["#000000","#FFFFFF","#0055FF","#FFD700","#FF4500"].map(c=>(
              <button key={c} className={`cdot ${style.outlineColor===c?"on":""}`} style={{background:c,border:c==="#FFFFFF"?"1px solid #555":"none"}} onClick={()=>set({outlineColor:c})}/>
            ))}
          </div>
        </div>
        <div className="ctrl-block">
          <label>Background <span className="ctrl-val">{style.bgOpacity===0?"off":`${Math.round(style.bgOpacity*100)}%`}</span></label>
          <input type="range" min={0} max={1} step={0.05} value={style.bgOpacity} onChange={e=>set({bgOpacity:Number(e.target.value)})}/>
        </div>
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
  const updateText=(i:number,text:string)=>{const n=[...subtitles];n[i]={...n[i],text};onChange(n);};
  const updateTime=(i:number,field:"start"|"end",value:string)=>{
    const parts=value.split(":").map(Number);
    const secs=(parts[0]||0)*3600+(parts[1]||0)*60+(parts[2]||0);
    if(!isNaN(secs)){const n=[...subtitles];n[i]={...n[i],[field]:secs};onChange(n);}
  };
  return(
    <div className="subtitle-editor">
      <div className="editor-header">
        <h3>Subtitles</h3>
        <span className="count-badge">{subtitles.length} lines</span>
      </div>
      <div className="subtitle-list" ref={listRef}>
        {subtitles.map((sub,i)=>(
          <div key={i} className={`subtitle-item ${activeIdx===i?"highlighted":""}`}>
            <div className="sub-index">{i+1}</div>
            <div className="sub-timecodes">
              <input className="timecode-input" defaultValue={toTimecode(sub.start)} onBlur={e=>updateTime(i,"start",e.target.value)}/>
              <span className="timecode-arrow">→</span>
              <input className="timecode-input" defaultValue={toTimecode(sub.end)} onBlur={e=>updateTime(i,"end",e.target.value)}/>
            </div>
            <textarea className="sub-text" value={sub.text} onChange={e=>updateText(i,e.target.value)} rows={2}/>
            <div className="sub-actions">
              <span className="confidence-dot" title={`${(sub.confidence*100).toFixed(0)}%`} style={{background:sub.confidence>0.85?"var(--green)":sub.confidence>0.7?"var(--amber)":"var(--red)"}}/>
              <button className="delete-btn" onClick={()=>onChange(subtitles.filter((_,idx)=>idx!==i))}>×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Export Panel ─────────────────────────────────────────────────────────────
function ExportPanel({subtitles,videoFile,style,onBack}:{subtitles:Subtitle[];videoFile:File|null;style:SubStyle;onBack:()=>void}){
  const [rendering,setRendering]=useState(false);
  const [renderDone,setRenderDone]=useState(false);
  const dl=(url:string,name:string)=>{const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
  const post=(path:string,name:string)=>fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subtitles})}).then(r=>r.blob()).then(b=>dl(URL.createObjectURL(b),name));
  const renderVideo=async()=>{
    if(!videoFile)return; setRendering(true);
    try{
      const form=new FormData();
      form.append("video",videoFile);
      form.append("subtitles",JSON.stringify(subtitles));
      form.append("style",JSON.stringify(style));
      const res=await fetch("/api/render",{method:"POST",body:form});
      if(!res.ok)throw new Error("Render failed");
      dl(URL.createObjectURL(await res.blob()),"subflow_export.mp4");
      setRenderDone(true);
    }catch{alert("Render failed.");}
    finally{setRendering(false);}
  };
  return(
    <div className="export-panel">
      <h3>Export</h3>
      <p className="export-sub">Choose your output format</p>
      <div className="export-grid">
        <button className="export-card" onClick={()=>post("/api/export/srt","subtitles.srt")}><span className="export-icon">📄</span><span className="export-label">SRT File</span><span className="export-desc">Compatible with most players</span></button>
        <button className="export-card" onClick={()=>post("/api/export/vtt","subtitles.vtt")}><span className="export-icon">🌐</span><span className="export-label">WebVTT</span><span className="export-desc">For web & browsers</span></button>
        <button className="export-card" onClick={()=>navigator.clipboard.writeText(subtitles.map(s=>s.text).join("\n"))}><span className="export-icon">📋</span><span className="export-label">Copy Text</span><span className="export-desc">Plain transcript</span></button>
        <button className={`export-card accent ${rendering?"loading":""} ${renderDone?"done":""}`} onClick={renderVideo} disabled={rendering||!videoFile}>
          <span className="export-icon">{renderDone?"✅":"🎬"}</span>
          <span className="export-label">{rendering?"Rendering…":renderDone?"Downloaded!":"Burn to Video"}</span>
          <span className="export-desc">Embed subtitles into MP4</span>
        </button>
      </div>
      <button className="btn-ghost back-btn" onClick={onBack}>← Back to editor</button>
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
  const [activeTab,setActiveTab]=useState<EditTab>("style");

  const handleFile=useCallback((f:File)=>{setVideoFile(f);setVideoUrl(URL.createObjectURL(f));setError(null);},[]);

  const startTranscription=async()=>{
    if(!videoFile)return; setStep("processing"); setError(null);
    try{
      const form=new FormData();
      form.append("video",videoFile);
      form.append("targetLang",targetLang);
      const res=await fetch("/api/transcribe",{method:"POST",body:form});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error??"Transcription failed.");
      setSubtitles(data.subtitles); setStep("edit");
    }catch(e:any){setError(e.message??"Unknown error.");setStep("upload");}
  };

  const stepIndex=["upload","processing","edit","export"].indexOf(step);

  return(
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="header">
          <div className="logo">
            <svg viewBox="0 0 32 32" fill="none" className="logo-icon"><rect x="2" y="6" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M13 13L19 16L13 19V13Z" fill="currentColor"/><path d="M2 12H30" stroke="currentColor" strokeWidth="1.5"/><circle cx="6" cy="9" r="1" fill="currentColor"/><circle cx="9.5" cy="9" r="1" fill="currentColor"/><circle cx="13" cy="9" r="1" fill="currentColor"/></svg>
            <span className="logo-text">SubFlow</span>
          </div>
          <nav className="steps-nav">
            {[1,2,3,4].map((n,i)=>(
              <span key={n} className={`step-dot ${stepIndex===i?"active":""} ${stepIndex>i?"done":""}`}>{n}</span>
            ))}
          </nav>
          {step==="edit"&&(
            <div className="header-actions">
              <button className="btn-outline sm" onClick={()=>setStep("upload")}>← New</button>
              <button className="btn-primary sm" onClick={()=>setStep("export")}>Export →</button>
            </div>
          )}
        </header>

        <main className="main">
          {step==="upload"&&(
            <div className="panel fade-in">
              <div className="panel-hero">
                <h1>Transcribe & translate<br/>your videos</h1>
                <p>Powered by Whisper AI — free, fast, no subscription</p>
              </div>
              {error&&<div className="error-banner">⚠ {error}</div>}
              <UploadZone onFile={handleFile}/>
              {videoFile&&(
                <div className="file-preview fade-in">
                  <div className="file-info">
                    <svg className="file-icon" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 9L15 12L10 15V9Z" fill="currentColor"/></svg>
                    <div><p className="file-name">{videoFile.name}</p><p className="file-meta">{formatSize(videoFile.size)}</p></div>
                    <button className="clear-btn" onClick={()=>{setVideoFile(null);setVideoUrl("");}}>×</button>
                  </div>
                  <div className="lang-selector">
                    <label>Translate to</label>
                    <select value={targetLang} onChange={e=>setTargetLang(e.target.value)}>
                      {LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <button className="btn-primary" onClick={startTranscription}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/></svg>
                    Start transcription
                  </button>
                </div>
              )}
            </div>
          )}

          {step==="processing"&&(
            <div className="panel centered fade-in"><ProcessingView fileName={videoFile?.name??""}/></div>
          )}

          {step==="edit"&&(
            <div className="editor-layout fade-in">
              {/* CENTER: video */}
              <div className="editor-center">
                <VideoCanvas
                  videoUrl={videoUrl}
                  subtitles={subtitles}
                  style={style}
                  onStyleChange={setStyle}
                  onTimeUpdate={setCurrentTime}
                />
              </div>
              {/* BOTTOM: tabs */}
              <div className="editor-bottom">
                <div className="tab-bar">
                  <button className={`tab-btn ${activeTab==="style"?"active":""}`} onClick={()=>setActiveTab("style")}>
                    🎨 Style
                  </button>
                  <button className={`tab-btn ${activeTab==="subtitles"?"active":""}`} onClick={()=>setActiveTab("subtitles")}>
                    📝 Subtitles <span className="tab-count">{subtitles.length}</span>
                  </button>
                </div>
                <div className="tab-content">
                  {activeTab==="style"&&<StylePanel style={style} onChange={setStyle}/>}
                  {activeTab==="subtitles"&&<SubtitleList subtitles={subtitles} onChange={setSubtitles} currentTime={currentTime}/>}
                </div>
              </div>
            </div>
          )}

          {step==="export"&&(
            <div className="panel fade-in">
              <ExportPanel subtitles={subtitles} videoFile={videoFile} style={style} onBack={()=>setStep("edit")}/>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0d0f12;--surface:#161920;--surface2:#1e2229;--border:rgba(255,255,255,0.07);--text:#e8eaf0;--muted:#6b7280;--amber:#f59e0b;--amber-dim:rgba(245,158,11,0.12);--amber-glow:rgba(245,158,11,0.25);--green:#34d399;--red:#f87171;--radius:10px;--radius-lg:16px;}
  html,body,#root{height:100%;overflow:hidden}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  .app{height:100vh;display:flex;flex-direction:column;overflow:hidden}
  .header{display:flex;align-items:center;gap:16px;padding:12px 24px;border-bottom:1px solid var(--border);background:rgba(13,15,18,0.97);backdrop-filter:blur(12px);flex-shrink:0;z-index:100}
  .logo{display:flex;align-items:center;gap:8px;margin-right:auto}
  .logo-icon{width:24px;height:24px;color:var(--amber)}
  .logo-text{font-family:'Syne',sans-serif;font-weight:800;font-size:17px;letter-spacing:-0.02em}
  .steps-nav{display:flex;gap:5px}
  .step-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;border:1.5px solid var(--border);color:var(--muted);background:var(--surface);transition:all .25s}
  .step-dot.active{border-color:var(--amber);color:var(--amber);background:var(--amber-dim)}
  .step-dot.done{border-color:var(--green);color:var(--green);background:rgba(52,211,153,0.1)}
  .header-actions{display:flex;gap:8px;margin-left:8px}
  .btn-primary{display:inline-flex;align-items:center;gap:8px;justify-content:center;background:var(--amber);color:#0d0f12;border:none;border-radius:var(--radius);font-family:'Syne',sans-serif;font-weight:700;font-size:14px;padding:11px 22px;cursor:pointer;transition:all .2s;box-shadow:0 0 16px var(--amber-glow);width:100%}
  .btn-primary.sm{width:auto;padding:8px 16px;font-size:13px}
  .btn-primary:hover{background:#fbbf24;transform:translateY(-1px)}
  .btn-outline{background:transparent;color:var(--text);border:1.5px solid var(--border);border-radius:var(--radius);font-size:13px;padding:10px 18px;cursor:pointer;transition:all .2s}
  .btn-outline.sm{padding:7px 14px;font-size:12px}
  .btn-outline:hover{border-color:var(--amber);color:var(--amber)}
  .btn-ghost{background:transparent;border:none;color:var(--muted);font-size:13px;cursor:pointer;transition:color .2s;padding:4px 0}
  .btn-ghost:hover{color:var(--text)}
  .main{flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .panel{width:100%;max-width:560px;padding:32px 24px;overflow-y:auto;max-height:100%}
  .panel.centered{display:flex;justify-content:center}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeUp .3s ease both}
  .panel-hero{margin-bottom:28px}
  .panel-hero h1{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(24px,4vw,36px);line-height:1.1;letter-spacing:-0.03em}
  .panel-hero p{color:var(--muted);margin-top:8px;font-size:14px}
  .upload-zone{border:2px dashed var(--border);border-radius:var(--radius-lg);padding:44px 28px;text-align:center;cursor:pointer;transition:all .2s;background:var(--surface)}
  .upload-zone:hover,.upload-zone.active{border-color:var(--amber);background:var(--amber-dim);box-shadow:0 0 0 1px var(--amber-glow)}
  .upload-icon{width:48px;height:48px;margin:0 auto 14px;color:var(--amber)}
  .upload-icon svg{width:100%;height:100%}
  .upload-title{font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:6px}
  .upload-sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .error-banner{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:var(--radius);padding:12px 16px;color:#f87171;font-size:13px;margin-bottom:16px}
  .file-preview{margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;display:flex;flex-direction:column;gap:12px}
  .file-info{display:flex;align-items:center;gap:10px}
  .file-icon{width:32px;height:32px;color:var(--amber);flex-shrink:0}
  .file-name{font-weight:500;font-size:13px}
  .file-meta{font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace}
  .clear-btn{margin-left:auto;background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:2px 5px;border-radius:4px;transition:color .2s}
  .clear-btn:hover{color:var(--red)}
  .lang-selector{display:flex;flex-direction:column;gap:5px}
  .lang-selector label{font-size:11px;color:var(--muted);font-weight:500;letter-spacing:.05em;text-transform:uppercase}
  .lang-selector select{background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;padding:8px 12px;cursor:pointer;outline:none;transition:border-color .2s}
  .lang-selector select:focus{border-color:var(--amber)}
  .processing-view{text-align:center;padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:16px}
  .processing-spinner{position:relative;width:64px;height:64px;display:flex;align-items:center;justify-content:center}
  .spinner-ring{position:absolute;inset:0;color:var(--amber);animation:spin 1.4s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner-icon{color:var(--amber);width:24px;height:24px}
  .spinner-icon svg{width:100%;height:100%}
  .processing-title{font-family:'Syne',sans-serif;font-weight:700;font-size:20px;min-width:160px}
  .processing-file{font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .processing-steps{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
  .step-badge{font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid var(--border);color:var(--muted);background:var(--surface);font-family:'JetBrains Mono',monospace}
  .step-badge.active{border-color:var(--amber);color:var(--amber);background:var(--amber-dim)}

  /* ─── Editor layout ─────────────────────────────────── */
  .editor-layout{width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden}
  .editor-center{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:12px 16px;background:var(--bg)}
  .editor-bottom{flex-shrink:0;height:300px;background:var(--surface);border-top:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}

  /* Video canvas */
  .video-canvas{position:relative;height:100%;max-height:100%;display:flex;align-items:center;justify-content:center;background:#000;border-radius:var(--radius-lg);overflow:hidden;max-width:600px;width:100%}
  .video-el{max-height:100%;max-width:100%;width:100%;display:block;object-fit:contain}
  .sub-drag-wrap{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:6px;cursor:grab;padding:0 8px;z-index:10}
  .sub-drag-wrap:active{cursor:grabbing}
  .sub-drag-handle{color:rgba(255,255,255,0.5);font-size:16px;line-height:1;flex-shrink:0;text-shadow:0 0 4px rgba(0,0,0,0.8)}
  .pos-indicator{position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);color:rgba(255,255,255,0.7);font-family:'JetBrains Mono',monospace;font-size:11px;padding:2px 7px;border-radius:6px;pointer-events:none;z-index:20}

  /* Tabs */
  .tab-bar{display:flex;border-bottom:1px solid var(--border);padding:0 16px;gap:4px;flex-shrink:0}
  .tab-btn{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--muted);font-size:13px;font-weight:500;padding:10px 14px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:6px;margin-bottom:-1px}
  .tab-btn.active{color:var(--amber);border-bottom-color:var(--amber)}
  .tab-count{background:var(--surface2);border:1px solid var(--border);border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:10px;padding:1px 7px;color:var(--muted)}
  .tab-content{flex:1;overflow-y:auto;overflow-x:hidden}
  .tab-content::-webkit-scrollbar{width:4px}
  .tab-content::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}

  /* Style panel (horizontal) */
  .style-grid-panel{padding:12px 16px;display:flex;flex-direction:column;gap:12px}
  .presets-row{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px}
  .presets-row::-webkit-scrollbar{height:3px}
  .presets-row::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
  .preset-card{flex-shrink:0;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:7px 12px;cursor:pointer;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px}
  .preset-card.active{border-color:var(--amber);background:var(--amber-dim)}
  .preset-emoji{font-size:18px;line-height:1}
  .preset-name{font-size:10px;color:var(--muted);white-space:nowrap}
  .preset-card.active .preset-name{color:var(--amber)}
  .controls-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px 20px}
  .ctrl-block{display:flex;flex-direction:column;gap:5px}
  .ctrl-block label{font-size:11px;color:var(--muted);font-weight:500;letter-spacing:.04em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center}
  .ctrl-val{color:var(--amber);font-family:'JetBrains Mono',monospace;font-size:10px}
  .ctrl-block select{background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;padding:7px 10px;cursor:pointer;outline:none;transition:border-color .2s;width:100%}
  .ctrl-block select:focus{border-color:var(--amber)}
  .ctrl-block input[type=range]{width:100%;accent-color:var(--amber);cursor:pointer;height:4px}
  .range-hints{display:flex;justify-content:space-between;font-size:10px;color:var(--muted)}
  .color-row{display:flex;align-items:center;gap:6px}
  .color-row input[type=color]{width:26px;height:26px;border:none;background:none;cursor:pointer;padding:0;border-radius:5px;flex-shrink:0}
  .cdot{width:18px;height:18px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .15s;flex-shrink:0}
  .cdot.on{border-color:var(--amber);transform:scale(1.2)}

  /* Subtitle list */
  .subtitle-editor{display:flex;flex-direction:column;height:100%}
  .editor-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0}
  .editor-header h3{font-family:'Syne',sans-serif;font-weight:700;font-size:14px}
  .count-badge{font-size:10px;font-family:'JetBrains Mono',monospace;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:2px 8px;color:var(--muted)}
  .subtitle-list{flex:1;overflow-y:auto}
  .subtitle-list::-webkit-scrollbar{width:4px}
  .subtitle-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
  .subtitle-item{display:grid;grid-template-columns:28px 1fr auto;grid-template-rows:auto auto;gap:4px 8px;padding:9px 12px;border-bottom:1px solid var(--border);transition:background .15s}
  .subtitle-item:last-child{border-bottom:none}
  .subtitle-item:hover{background:rgba(255,255,255,0.02)}
  .subtitle-item.highlighted{background:var(--amber-dim);border-left:2px solid var(--amber)}
  .sub-index{grid-row:1/3;align-self:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);text-align:center}
  .sub-timecodes{display:flex;align-items:center;gap:4px}
  .timecode-input{background:var(--surface2);border:1px solid var(--border);border-radius:5px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 6px;width:95px;outline:none;transition:border-color .2s}
  .timecode-input:focus{border-color:var(--amber)}
  .timecode-arrow{color:var(--muted);font-size:10px}
  .sub-text{background:transparent;border:none;color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;resize:none;outline:none;width:100%;line-height:1.4;padding:0}
  .sub-actions{grid-row:1/3;align-self:center;display:flex;flex-direction:column;align-items:center;gap:5px}
  .confidence-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;cursor:help}
  .delete-btn{background:none;border:none;color:var(--muted);font-size:15px;cursor:pointer;padding:2px 3px;border-radius:3px;transition:color .2s;line-height:1}
  .delete-btn:hover{color:var(--red)}

  /* Export */
  .export-panel{display:flex;flex-direction:column;gap:20px}
  .export-panel h3{font-family:'Syne',sans-serif;font-weight:800;font-size:24px}
  .export-sub{color:var(--muted);margin-top:-12px;font-size:13px}
  .export-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .export-card{background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:16px 14px;display:flex;flex-direction:column;align-items:flex-start;gap:4px;cursor:pointer;transition:all .2s;text-align:left}
  .export-card:hover{border-color:var(--amber);background:var(--amber-dim)}
  .export-card.accent{border-color:var(--amber);background:var(--amber-dim)}
  .export-card.loading{opacity:0.6;cursor:wait}
  .export-card.done{border-color:var(--green);background:rgba(52,211,153,0.08)}
  .export-icon{font-size:20px}
  .export-label{font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--text)}
  .export-desc{font-size:11px;color:var(--muted)}
  .back-btn{align-self:flex-start}
  @media(max-width:600px){.header{padding:10px 14px}.controls-row{grid-template-columns:1fr 1fr}.export-grid{grid-template-columns:1fr}}
`;
