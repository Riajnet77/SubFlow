import { useState, useRef, useCallback, useEffect, DragEvent } from "react";

interface Subtitle {
  start: number;
  end: number;
  text: string;
  confidence: number;
}

type Step = "upload" | "processing" | "edit" | "export";

const LANGUAGES = [
  { code: "original", label: "Original language (no translation)" },
  { code: "English", label: "English" },
  { code: "Portuguese", label: "Portuguese" },
  { code: "Spanish", label: "Spanish" },
  { code: "French", label: "French" },
  { code: "German", label: "German" },
  { code: "Italian", label: "Italian" },
  { code: "Japanese", label: "Japanese" },
  { code: "Korean", label: "Korean" },
  { code: "Chinese", label: "Chinese (Simplified)" },
  { code: "Russian", label: "Russian" },
  { code: "Arabic", label: "Arabic" },
  { code: "Hindi", label: "Hindi" },
];

function toTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`upload-zone ${drag ? "active" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}/>
      <div className="upload-icon">
        <svg viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="currentColor" strokeWidth="2"/>
          <path d="M20 20L28 24L20 28V20Z" fill="currentColor"/>
          <path d="M4 16H44" stroke="currentColor" strokeWidth="2"/>
          <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
          <circle cx="14" cy="12" r="1.5" fill="currentColor"/>
          <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
        </svg>
      </div>
      <p className="upload-title">Drop your video here</p>
      <p className="upload-sub">MP4, MOV, MKV, AVI, WebM — up to 500 MB</p>
      <button type="button" className="btn-outline" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Browse files</button>
    </div>
  );
}

function ProcessingView({ fileName }: { fileName: string }) {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="processing-view">
      <div className="processing-spinner">
        <svg viewBox="0 0 50 50" className="spinner-ring">
          <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="94 32" strokeLinecap="round"/>
        </svg>
        <div className="spinner-icon">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M9 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-4M9 7V5a2 2 0 014 0v2M9 7h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
      <p className="processing-title">Transcribing{dots}</p>
      <p className="processing-file">{fileName}</p>
      <div className="processing-steps">
        <span className="step-badge active">Extracting audio</span>
        <span className="step-badge">Whisper transcription</span>
        <span className="step-badge">Translating</span>
      </div>
    </div>
  );
}

function SubtitleEditor({ subtitles, onChange }: { subtitles: Subtitle[]; onChange: (s: Subtitle[]) => void }) {
  const updateText = (i: number, text: string) => { const n = [...subtitles]; n[i] = { ...n[i], text }; onChange(n); };
  const updateTime = (i: number, field: "start" | "end", value: string) => {
    const parts = value.split(":").map(Number);
    const secs = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    if (!isNaN(secs)) { const n = [...subtitles]; n[i] = { ...n[i], [field]: secs }; onChange(n); }
  };
  return (
    <div className="subtitle-editor">
      <div className="editor-header">
        <h3>Subtitle Editor</h3>
        <span className="count-badge">{subtitles.length} lines</span>
      </div>
      <div className="subtitle-list">
        {subtitles.map((sub, i) => (
          <div key={i} className="subtitle-item">
            <div className="sub-index">{i + 1}</div>
            <div className="sub-timecodes">
              <input className="timecode-input" defaultValue={toTimecode(sub.start)} onBlur={(e) => updateTime(i, "start", e.target.value)}/>
              <span className="timecode-arrow">→</span>
              <input className="timecode-input" defaultValue={toTimecode(sub.end)} onBlur={(e) => updateTime(i, "end", e.target.value)}/>
            </div>
            <textarea className="sub-text" value={sub.text} onChange={(e) => updateText(i, e.target.value)} rows={2}/>
            <div className="sub-actions">
              <span className="confidence-dot" title={`${(sub.confidence * 100).toFixed(0)}%`} style={{ background: sub.confidence > 0.85 ? "var(--green)" : sub.confidence > 0.7 ? "var(--amber)" : "var(--red)" }}/>
              <button className="delete-btn" onClick={() => onChange(subtitles.filter((_, idx) => idx !== i))}>×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportPanel({ subtitles, videoFile, onBack }: { subtitles: Subtitle[]; videoFile: File | null; onBack: () => void }) {
  const [rendering, setRendering] = useState(false);
  const [renderDone, setRenderDone] = useState(false);

  const dl = (url: string, name: string) => { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
  const post = (path: string, name: string) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtitles }) }).then(r => r.blob()).then(b => dl(URL.createObjectURL(b), name));

  const renderVideo = async () => {
    if (!videoFile) return;
    setRendering(true);
    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("subtitles", JSON.stringify(subtitles));
      const res = await fetch("/api/render", { method: "POST", body: form });
      if (!res.ok) throw new Error("Render failed");
      dl(URL.createObjectURL(await res.blob()), "subflow_export.mp4");
      setRenderDone(true);
    } catch { alert("Render failed. Check server logs."); }
    finally { setRendering(false); }
  };

  return (
    <div className="export-panel">
      <h3>Export</h3>
      <p className="export-sub">Choose your output format</p>
      <div className="export-grid">
        <button className="export-card" onClick={() => post("/api/export/srt", "subtitles.srt")}><span className="export-icon">📄</span><span className="export-label">SRT File</span><span className="export-desc">Compatible with most players</span></button>
        <button className="export-card" onClick={() => post("/api/export/vtt", "subtitles.vtt")}><span className="export-icon">🌐</span><span className="export-label">WebVTT</span><span className="export-desc">For web players & browsers</span></button>
        <button className="export-card" onClick={() => navigator.clipboard.writeText(subtitles.map(s => s.text).join("\n"))}><span className="export-icon">📋</span><span className="export-label">Copy Text</span><span className="export-desc">Plain transcript to clipboard</span></button>
        <button className={`export-card accent ${rendering ? "loading" : ""} ${renderDone ? "done" : ""}`} onClick={renderVideo} disabled={rendering || !videoFile}>
          <span className="export-icon">{renderDone ? "✅" : "🎬"}</span>
          <span className="export-label">{rendering ? "Rendering…" : renderDone ? "Downloaded!" : "Burn to Video"}</span>
          <span className="export-desc">Embed subtitles into MP4</span>
        </button>
      </div>
      <button className="btn-ghost back-btn" onClick={onBack}>← Edit subtitles</button>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState("original");
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => { setVideoFile(file); setError(null); }, []);

  const startTranscription = async () => {
    if (!videoFile) return;
    setStep("processing");
    setError(null);
    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("targetLang", targetLang);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transcription failed.");
      setSubtitles(data.subtitles);
      setStep("edit");
    } catch (e: any) {
      setError(e.message ?? "Unknown error.");
      setStep("upload");
    }
  };

  const stepIndex = ["upload", "processing", "edit", "export"].indexOf(step);

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="header">
          <div className="logo">
            <svg viewBox="0 0 32 32" fill="none" className="logo-icon">
              <rect x="2" y="6" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M13 13L19 16L13 19V13Z" fill="currentColor"/>
              <path d="M2 12H30" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="6" cy="9" r="1" fill="currentColor"/>
              <circle cx="9.5" cy="9" r="1" fill="currentColor"/>
              <circle cx="13" cy="9" r="1" fill="currentColor"/>
            </svg>
            <span className="logo-text">SubFlow</span>
          </div>
          <nav className="steps-nav">
            {[1,2,3,4].map((n, i) => (
              <span key={n} className={`step-dot ${stepIndex === i ? "active" : ""} ${stepIndex > i ? "done" : ""}`}>{n}</span>
            ))}
          </nav>
        </header>
        <main className="main">
          {step === "upload" && (
            <div className="panel fade-in">
              <div className="panel-hero">
                <h1>Transcribe & translate<br/>your videos</h1>
                <p>Powered by Whisper AI — free, fast, no subscription</p>
              </div>
              {error && <div className="error-banner">⚠ {error}</div>}
              <UploadZone onFile={handleFile} />
              {videoFile && (
                <div className="file-preview fade-in">
                  <div className="file-info">
                    <svg className="file-icon" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 9L15 12L10 15V9Z" fill="currentColor"/></svg>
                    <div>
                      <p className="file-name">{videoFile.name}</p>
                      <p className="file-meta">{formatFileSize(videoFile.size)}</p>
                    </div>
                    <button className="clear-btn" onClick={() => setVideoFile(null)}>×</button>
                  </div>
                  <div className="lang-selector">
                    <label>Translate to</label>
                    <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
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
          {step === "processing" && (
            <div className="panel centered fade-in"><ProcessingView fileName={videoFile?.name ?? ""} /></div>
          )}
          {step === "edit" && (
            <div className="panel wide fade-in">
              <div className="edit-header">
                <div><h2>Review subtitles</h2><p className="edit-sub">Click any line to edit text or timecodes</p></div>
                <div className="edit-actions">
                  <button className="btn-outline" onClick={() => setStep("upload")}>← New video</button>
                  <button className="btn-primary" onClick={() => setStep("export")}>Export →</button>
                </div>
              </div>
              <SubtitleEditor subtitles={subtitles} onChange={setSubtitles} />
            </div>
          )}
          {step === "export" && (
            <div className="panel fade-in"><ExportPanel subtitles={subtitles} videoFile={videoFile} onBack={() => setStep("edit")} /></div>
          )}
        </main>
      </div>
    </>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#0d0f12; --surface:#161920; --surface2:#1e2229; --border:rgba(255,255,255,0.07);
    --text:#e8eaf0; --muted:#6b7280; --amber:#f59e0b; --amber-dim:rgba(245,158,11,0.12);
    --amber-glow:rgba(245,158,11,0.25); --green:#34d399; --red:#f87171;
    --radius:10px; --radius-lg:16px;
  }
  html,body,#root{height:100%}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  .app{min-height:100vh;display:flex;flex-direction:column}
  .header{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid var(--border);background:rgba(13,15,18,0.95);backdrop-filter:blur(12px);position:sticky;top:0;z-index:100}
  .logo{display:flex;align-items:center;gap:10px}
  .logo-icon{width:28px;height:28px;color:var(--amber)}
  .logo-text{font-family:'Syne',sans-serif;font-weight:800;font-size:18px;letter-spacing:-0.02em}
  .steps-nav{display:flex;align-items:center;gap:6px}
  .step-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;border:1.5px solid var(--border);color:var(--muted);background:var(--surface);transition:all 0.25s}
  .step-dot.active{border-color:var(--amber);color:var(--amber);background:var(--amber-dim)}
  .step-dot.done{border-color:var(--green);color:var(--green);background:rgba(52,211,153,0.1)}
  .main{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:48px 24px}
  .panel{width:100%;max-width:580px}
  .panel.centered{display:flex;justify-content:center}
  .panel.wide{max-width:800px}
  @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeUp 0.4s ease both}
  .panel-hero{margin-bottom:36px}
  .panel-hero h1{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(28px,5vw,40px);line-height:1.1;letter-spacing:-0.03em}
  .panel-hero p{color:var(--muted);margin-top:10px;font-size:15px}
  .upload-zone{border:2px dashed var(--border);border-radius:var(--radius-lg);padding:48px 32px;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--surface)}
  .upload-zone:hover,.upload-zone.active{border-color:var(--amber);background:var(--amber-dim);box-shadow:0 0 0 1px var(--amber-glow)}
  .upload-icon{width:56px;height:56px;margin:0 auto 20px;color:var(--amber)}
  .upload-icon svg{width:100%;height:100%}
  .upload-title{font-family:'Syne',sans-serif;font-weight:700;font-size:18px;margin-bottom:8px}
  .upload-sub{color:var(--muted);font-size:13px;margin-bottom:24px}
  .btn-primary{display:inline-flex;align-items:center;gap:8px;justify-content:center;background:var(--amber);color:#0d0f12;border:none;border-radius:var(--radius);font-family:'Syne',sans-serif;font-weight:700;font-size:14px;padding:12px 24px;cursor:pointer;transition:all 0.2s;box-shadow:0 0 20px var(--amber-glow);width:100%}
  .btn-primary:hover{background:#fbbf24;transform:translateY(-1px)}
  .btn-outline{background:transparent;color:var(--text);border:1.5px solid var(--border);border-radius:var(--radius);font-size:13px;padding:10px 18px;cursor:pointer;transition:all 0.2s}
  .btn-outline:hover{border-color:var(--amber);color:var(--amber)}
  .btn-ghost{background:transparent;border:none;color:var(--muted);font-size:13px;cursor:pointer;transition:color 0.2s;padding:4px 0}
  .btn-ghost:hover{color:var(--text)}
  .error-banner{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:var(--radius);padding:12px 16px;color:#f87171;font-size:13px;margin-bottom:20px}
  .file-preview{margin-top:20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;display:flex;flex-direction:column;gap:16px}
  .file-info{display:flex;align-items:center;gap:12px}
  .file-icon{width:36px;height:36px;color:var(--amber);flex-shrink:0}
  .file-name{font-weight:500;font-size:14px}
  .file-meta{font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace}
  .clear-btn{margin-left:auto;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:2px 6px;border-radius:4px;transition:color 0.2s}
  .clear-btn:hover{color:var(--red)}
  .lang-selector{display:flex;flex-direction:column;gap:8px}
  .lang-selector label{font-size:12px;color:var(--muted);font-weight:500;letter-spacing:0.05em;text-transform:uppercase}
  .lang-selector select{background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px;padding:10px 14px;cursor:pointer;outline:none;transition:border-color 0.2s}
  .lang-selector select:focus{border-color:var(--amber)}
  .processing-view{text-align:center;padding:60px 32px;display:flex;flex-direction:column;align-items:center;gap:20px}
  .processing-spinner{position:relative;width:72px;height:72px;display:flex;align-items:center;justify-content:center}
  .spinner-ring{position:absolute;inset:0;color:var(--amber);animation:spin 1.4s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner-icon{color:var(--amber);width:28px;height:28px}
  .spinner-icon svg{width:100%;height:100%}
  .processing-title{font-family:'Syne',sans-serif;font-weight:700;font-size:22px;min-width:200px}
  .processing-file{font-size:13px;color:var(--muted);font-family:'JetBrains Mono',monospace;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .processing-steps{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
  .step-badge{font-size:11px;padding:4px 10px;border-radius:20px;border:1px solid var(--border);color:var(--muted);background:var(--surface);font-family:'JetBrains Mono',monospace}
  .step-badge.active{border-color:var(--amber);color:var(--amber);background:var(--amber-dim)}
  .edit-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;gap:16px;flex-wrap:wrap}
  .edit-header h2{font-family:'Syne',sans-serif;font-weight:700;font-size:22px}
  .edit-sub{color:var(--muted);font-size:13px;margin-top:4px}
  .edit-actions{display:flex;gap:10px}
  .edit-actions .btn-primary{width:auto}
  .subtitle-editor{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
  .editor-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
  .editor-header h3{font-family:'Syne',sans-serif;font-weight:700;font-size:15px}
  .count-badge{font-size:11px;font-family:'JetBrains Mono',monospace;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:3px 10px;color:var(--muted)}
  .subtitle-list{max-height:520px;overflow-y:auto}
  .subtitle-list::-webkit-scrollbar{width:4px}
  .subtitle-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
  .subtitle-item{display:grid;grid-template-columns:36px 1fr auto;grid-template-rows:auto auto;gap:6px 12px;padding:14px 16px;border-bottom:1px solid var(--border);transition:background 0.15s}
  .subtitle-item:last-child{border-bottom:none}
  .subtitle-item:hover{background:rgba(255,255,255,0.02)}
  .sub-index{grid-row:1/3;align-self:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);text-align:center}
  .sub-timecodes{display:flex;align-items:center;gap:8px}
  .timecode-input{background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;padding:4px 8px;width:110px;outline:none;transition:border-color 0.2s}
  .timecode-input:focus{border-color:var(--amber)}
  .timecode-arrow{color:var(--muted);font-size:12px}
  .sub-text{background:transparent;border:none;color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;resize:none;outline:none;width:100%;line-height:1.5;padding:0}
  .sub-actions{grid-row:1/3;align-self:center;display:flex;flex-direction:column;align-items:center;gap:8px}
  .confidence-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;cursor:help}
  .delete-btn{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:2px 5px;border-radius:4px;transition:color 0.2s}
  .delete-btn:hover{color:var(--red)}
  .export-panel{display:flex;flex-direction:column;gap:24px}
  .export-panel h3{font-family:'Syne',sans-serif;font-weight:800;font-size:28px}
  .export-sub{color:var(--muted);margin-top:-16px}
  .export-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .export-card{background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:20px 16px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;cursor:pointer;transition:all 0.2s;text-align:left}
  .export-card:hover{border-color:var(--amber);background:var(--amber-dim)}
  .export-card.accent{border-color:var(--amber);background:var(--amber-dim)}
  .export-card.loading{opacity:0.6;cursor:wait}
  .export-card.done{border-color:var(--green);background:rgba(52,211,153,0.08)}
  .export-icon{font-size:22px}
  .export-label{font-family:'Syne',sans-serif;font-weight:700;font-size:14px;color:var(--text)}
  .export-desc{font-size:12px;color:var(--muted)}
  .back-btn{align-self:flex-start}
  @media(max-width:600px){.header{padding:12px 16px}.main{padding:32px 16px}.panel-hero h1{font-size:26px}.export-grid{grid-template-columns:1fr}.edit-header{flex-direction:column}}
`;
