import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore, SubStyle, PRESETS, PRESET_LIST, FONTS, DEFAULT_STYLE } from '@/src/store/useStore';
import { Button } from '@/src/components/ui/Button';
import { ArrowLeft, Play, Pause, Download, Languages, SplitSquareHorizontal, Copy, Video, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { formatTime, generateVTT, generateSRT, downloadFile } from '@/src/lib/utils';

// ── Draggable/resizable subtitle box drawn over the video preview ──────────
// Mirrors the position the exported video will use (style.box, in % of frame).
function SubtitleBox({ text, style, onChange, fontScale }: {
  text: string; style: SubStyle; onChange: (s: SubStyle) => void; fontScale: number;
}) {
  const [sel, setSel] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ type: string; sx: number; sy: number; sb: SubStyle['box'] } | null>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setSel(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const parentSize = () => {
    const p = ref.current?.parentElement;
    return p ? { w: p.clientWidth, h: p.clientHeight } : { w: 1, h: 1 };
  };
  const clamp = (b: SubStyle['box']): SubStyle['box'] => ({
    x: Math.max(0, Math.min(100 - b.w, b.x)),
    y: Math.max(0, Math.min(100 - b.h, b.y)),
    w: Math.max(8, Math.min(100, b.w)),
    h: Math.max(4, Math.min(50, b.h)),
  });

  const pointerDown = (e: React.PointerEvent, type: string) => {
    e.stopPropagation(); e.preventDefault(); setSel(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { type, sx: e.clientX, sy: e.clientY, sb: { ...style.box } };
  };
  const pointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { type, sx, sy, sb } = drag.current;
    const { w: pw, h: ph } = parentSize();
    const dx = ((e.clientX - sx) / pw) * 100, dy = ((e.clientY - sy) / ph) * 100;
    let nb = { ...sb };
    if (type === 'move') { nb.x = sb.x + dx; nb.y = sb.y + dy; }
    if (type === 'se') { nb.w = sb.w + dx; nb.h = sb.h + dy; }
    if (type === 'sw') { nb.x = sb.x + dx; nb.w = sb.w - dx; nb.h = sb.h + dy; }
    if (type === 'ne') { nb.y = sb.y + dy; nb.w = sb.w + dx; nb.h = sb.h - dy; }
    if (type === 'nw') { nb.x = sb.x + dx; nb.y = sb.y + dy; nb.w = sb.w - dx; nb.h = sb.h - dy; }
    if (type === 'n') { nb.y = sb.y + dy; nb.h = sb.h - dy; }
    if (type === 's') { nb.h = sb.h + dy; }
    if (type === 'e') { nb.w = sb.w + dx; }
    if (type === 'w') { nb.x = sb.x + dx; nb.w = sb.w - dx; }
    onChange({ ...style, box: clamp(nb), preset: 'custom' });
  };
  const pointerUp = () => { drag.current = null; };

  const fs = Math.max(8, Math.round(style.fontSize * fontScale));
  const textShadow = style.bgOpacity === 0
    ? `1px 1px 3px ${style.outlineColor},-1px -1px 3px ${style.outlineColor},1px -1px 3px ${style.outlineColor},-1px 1px 3px ${style.outlineColor}`
    : 'none';

  const HANDLES = [
    { k: 'nw', s: { top: -5, left: -5, cursor: 'nw-resize' } }, { k: 'ne', s: { top: -5, right: -5, cursor: 'ne-resize' } },
    { k: 'sw', s: { bottom: -5, left: -5, cursor: 'sw-resize' } }, { k: 'se', s: { bottom: -5, right: -5, cursor: 'se-resize' } },
    { k: 'n', s: { top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' } },
    { k: 's', s: { bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' } },
    { k: 'e', s: { right: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'e-resize' } },
    { k: 'w', s: { left: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'w-resize' } },
  ] as const;

  return (
    <div ref={ref}
      style={{
        position: 'absolute', left: `${style.box.x}%`, top: `${style.box.y}%`,
        width: `${style.box.w}%`, height: `${style.box.h}%`,
        border: sel ? '2px solid #f59e0b' : '1.5px dashed rgba(255,255,255,0.5)',
        borderRadius: 4, zIndex: 20, cursor: 'move',
        background: sel ? 'rgba(245,158,11,0.06)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box',
      }}
      onPointerDown={e => pointerDown(e, 'move')} onPointerMove={pointerMove} onPointerUp={pointerUp}
    >
      <span style={{
        fontFamily: style.fontName, fontSize: fs + 'px', color: style.primaryColor, textShadow,
        background: style.bgOpacity > 0 ? `rgba(0,0,0,${style.bgOpacity})` : 'transparent',
        padding: style.bgOpacity > 0 ? '2px 8px' : '0', borderRadius: style.bgOpacity > 0 ? '3px' : '0',
        textAlign: 'center', lineHeight: 1.2, maxWidth: '98%', wordBreak: 'break-word',
        whiteSpace: 'normal', display: 'block', pointerEvents: 'none', userSelect: 'none',
      }}>{text || 'Sample subtitle text'}</span>
      {sel && HANDLES.map(h => (
        <div key={h.k}
          style={{ position: 'absolute', width: 10, height: 10, background: '#f59e0b', border: '1.5px solid #fff', borderRadius: 2, zIndex: 30, ...h.s as any }}
          onPointerDown={e => pointerDown(e, h.k)} onPointerMove={pointerMove} onPointerUp={pointerUp} />
      ))}
    </div>
  );
}

// ── Style tab: presets + font + colors + background opacity ────────────────
function StylePanel({ style, onChange }: { style: SubStyle; onChange: (s: SubStyle) => void }) {
  const set = (p: Partial<SubStyle>) => onChange({ ...style, ...p, preset: 'custom' });
  const applyPreset = (k: string) => onChange({ ...style, ...PRESETS[k], preset: k });

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Preset</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_LIST.map(p => (
            <button key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                style.preset === p.key ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >{p.emoji} {p.label}</button>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Font</div>
        <select
          value={style.fontName}
          onChange={e => set({ fontName: e.target.value })}
          className="w-full bg-muted border border-border rounded-lg text-sm px-3 py-2 outline-none"
        >
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground uppercase tracking-wider mb-2">
          <span>Font size</span><span className="text-primary font-mono">{style.fontSize}px</span>
        </div>
        <input type="range" min={10} max={120} value={style.fontSize}
          onChange={e => set({ fontSize: Number(e.target.value) })}
          className="w-full accent-primary" />
      </div>

      <div className="h-px bg-border" />

      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Text color</div>
        <div className="flex items-center gap-2">
          <input type="color" value={style.primaryColor} onChange={e => set({ primaryColor: e.target.value })}
            className="w-8 h-8 rounded-md border-none cursor-pointer bg-transparent p-0" />
          <span className="text-xs font-mono text-muted-foreground">{style.primaryColor}</span>
        </div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Outline color</div>
        <div className="flex items-center gap-2">
          <input type="color" value={style.outlineColor} onChange={e => set({ outlineColor: e.target.value })}
            className="w-8 h-8 rounded-md border-none cursor-pointer bg-transparent p-0" />
          <span className="text-xs font-mono text-muted-foreground">{style.outlineColor}</span>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div>
        <div className="flex justify-between text-xs text-muted-foreground uppercase tracking-wider mb-2">
          <span>Background</span>
          <span className="text-primary font-mono">{style.bgOpacity === 0 ? 'off' : `${Math.round(style.bgOpacity * 100)}%`}</span>
        </div>
        <input type="range" min={0} max={1} step={0.05} value={style.bgOpacity}
          onChange={e => set({ bgOpacity: Number(e.target.value) })}
          className="w-full accent-primary" />
      </div>
    </div>
  );
}

export function EditorScreen({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { projects, updateSubtitle, updateStyle } = useStore();
  const project = projects.find(p => p.id === projectId);
  const style = project?.style ?? DEFAULT_STYLE;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [rightTab, setRightTab] = useState<'style' | 'subtitles'>('style');

  // Native + displayed video size — needed so the exported burn-in matches the preview 1:1
  const [nativeW, setNativeW] = useState(0);
  const [nativeH, setNativeH] = useState(0);
  const [dispH, setDispH] = useState(0);
  const fontScale = dispH > 0 && nativeH > 0 ? dispH / nativeH : 0.2;

  const measureH = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const h = v.getBoundingClientRect().height;
    if (h > 0) setDispH(h);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const obs = new ResizeObserver(() => setTimeout(measureH, 50));
    obs.observe(v);
    return () => obs.disconnect();
  }, [measureH]);

  useEffect(() => {
    if(!videoRef.current) return;
    const v = videoRef.current;
    
    const handleTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      if (project) {
        const active = project.subtitles.find(s => v.currentTime >= s.start && v.currentTime <= s.end);
        if (active) {
          setActiveSubId(active.id);
          const el = document.getElementById(`sub-${active.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          setActiveSubId(null);
        }
      }
    };
    const handleLoadedMetadata = () => {
      setNativeW(v.videoWidth);
      setNativeH(v.videoHeight);
      setTimeout(measureH, 100);
    };

    v.addEventListener('timeupdate', handleTimeUpdate);
    v.addEventListener('loadedmetadata', handleLoadedMetadata);
    v.addEventListener('loadeddata', () => setTimeout(measureH, 100));
    v.addEventListener('play', () => setIsPlaying(true));
    v.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      v.removeEventListener('timeupdate', handleTimeUpdate);
      v.removeEventListener('loadedmetadata', handleLoadedMetadata);
      v.removeEventListener('play', () => setIsPlaying(true));
      v.removeEventListener('pause', () => setIsPlaying(false));
    }
  }, [project, measureH]);

  if (!project) {
    return <div>Project not found</div>;
  }

  const currentSub = project.subtitles.find(s => s.id === activeSubId);

  const handlePlayPause = () => {
    if(videoRef.current) {
      if(isPlaying) videoRef.current.pause();
      else videoRef.current.play();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        if(videoRef.current) {
          if(videoRef.current.paused) videoRef.current.play();
          else videoRef.current.pause();
        }
      }
      if (e.code === 'Escape') {
        setShowExport(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showExport]);

  const jumpToTime = (time: number) => {
    if(videoRef.current) {
      videoRef.current.currentTime = time;
      if(!isPlaying) videoRef.current.play();
    }
  }

  const exportSubs = (format: 'vtt' | 'srt') => {
    const data = format === 'vtt' ? generateVTT(project.subtitles) : generateSRT(project.subtitles);
    downloadFile(data, `${project.name}.${format}`, 'text/plain');
    setShowExport(false);
  }

  const copyToClipboard = () => {
    if (!project) return;
    const text = project.subtitles.map(s => s.text).join('\n');
    navigator.clipboard.writeText(text);
    setShowExport(false);
  }

  const exportVideo = async () => {
    if (!project) return;
    setIsRendering(true);
    setRenderProgress(0);

    try {
      let p = 0;
      const progressInterval = setInterval(() => {
        p += Math.random() * 3;
        if (p < 85) setRenderProgress(p);
      }, 1500);

      const response = await fetch(project.videoUrl!);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('video', blob, `${project.name}.mp4`);
      formData.append('subtitles', JSON.stringify(project.subtitles));
      // This was missing entirely before — without it the backend never knew which
      // preset/colors/box position to burn in and always fell back to black/default.
      formData.append('style', JSON.stringify({
        ...style,
        browserH: dispH,
        nativeW,
        nativeH,
        fontScale,
      }));

      // /api/render responds immediately with a jobId and renders in the background —
      // poll /api/render/:id/status until done, then fetch /api/render/:id/download.
      const startRes = await fetch('/api/render', { method: 'POST', body: formData });
      if (!startRes.ok) throw new Error('Failed to start render');
      const { jobId } = await startRes.json();

      let status: 'processing' | 'done' | 'error' = 'processing';
      while (status === 'processing') {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`/api/render/${jobId}/status`);
        const statusData = await statusRes.json();
        status = statusData.status;
        if (status === 'error') throw new Error(statusData.error || 'Rendering failed on the server');
      }

      clearInterval(progressInterval);
      setRenderProgress(100);

      const outBlob = await (await fetch(`/api/render/${jobId}/download`)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(outBlob);
      a.download = `${project.name}_subtitled.mp4`;
      a.click();

      setTimeout(() => {
        setIsRendering(false);
        setShowExport(false);
      }, 1000);

    } catch(err) {
      console.error(err);
      alert((err as Error).message);
      setIsRendering(false);
      setRenderProgress(0);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full absolute inset-0 md:relative">
      {/* Header for mobile overlay */}
      <div className="md:hidden absolute top-0 left-0 w-full z-20 p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-center text-white">
        <button onClick={onBack} className="p-2 bg-black/40 rounded-full backdrop-blur"><ArrowLeft className="w-5 h-5"/></button>
        <span className="font-medium text-sm truncate max-w-[200px]">{project.name}</span>
        <button onClick={() => setShowExport(true)} className="p-2 bg-black/40 rounded-full backdrop-blur"><Download className="w-5 h-5"/></button>
      </div>

      {/* Video Section */}
      <div className="w-full md:w-1/2 lg:w-7/12 flex flex-col pt-0 md:pt-0">
        <div className="hidden md:flex items-center justify-between mb-4">
          <Button variant="ghost" onClick={onBack} className="-ml-4 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div className="font-medium">{project.name}</div>
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)}>
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
        </div>

        <div className="relative w-full aspect-video bg-black md:rounded-2xl overflow-hidden group shadow-2xl">
          {project.videoUrl ? (
            <video 
              ref={videoRef}
              src={project.videoUrl} 
              className="w-full h-full object-contain"
              playsInline
            />
          ) : (
            <div className="flex w-full h-full items-center justify-center text-white/50">
              Video Source Unavailable (Session Expired?)
            </div>
          )}

          {/* Draggable/resizable subtitle box — same style used for export */}
          <SubtitleBox
            text={currentSub?.text ?? 'Sample subtitle text'}
            style={style}
            onChange={(s) => updateStyle(project.id, s)}
            fontScale={fontScale}
          />

          {/* Simple controls */}
          <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black/80 to-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <div className="flex flex-col gap-2">
              {/* Progress bar visual */}
              <div 
                className="w-full h-1.5 bg-white/30 rounded-full overflow-hidden cursor-pointer"
                onClick={(e) => {
                  if(!videoRef.current) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos = (e.clientX - rect.left) / rect.width;
                  videoRef.current.currentTime = pos * project.duration;
                }}
              >
                <div className="h-full bg-primary" style={{ width: `${(currentTime/project.duration)*100}%` }}/>
              </div>
              <div className="flex items-center justify-between text-white">
                <button onClick={handlePlayPause} className="hover:scale-110 transition-transform">
                  {isPlaying ? <Pause className="w-6 h-6 fill-white"/> : <Play className="w-6 h-6 fill-white"/>}
                </button>
                <div className="text-xs font-mono">{formatTime(currentTime)} / {formatTime(project.duration)}</div>
              </div>
            </div>
          </div>
        </div>
        <p className="hidden md:block text-xs text-muted-foreground text-center mt-2">⠿ Drag box to move · drag corners to resize</p>
        
        {/* Under Video tools (desktop mainly) */}
        <div className="hidden md:flex items-center justify-between mt-6 p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-4">
             <div className="text-sm">
                <span className="text-muted-foreground">Source: </span> {project.sourceLang}
             </div>
             <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
             <div className="text-sm">
                <span className="text-muted-foreground">Target: </span> {project.targetLang}
             </div>
          </div>
          <Button variant="ghost" size="sm" className="text-primary"><Languages className="w-4 h-4 mr-2"/> Update Translation</Button>
        </div>
      </div>

      {/* Editor Section */}
      <div className="w-full md:w-1/2 lg:w-5/12 flex flex-col h-[calc(100vh-56.25vw)] md:h-auto border-t md:border-t-0 md:border-l bg-card/50">
        <div className="flex border-b bg-card sticky top-0 z-10">
          <button
            onClick={() => setRightTab('style')}
            className={`flex-1 text-sm font-medium py-3 border-b-2 transition-colors ${rightTab === 'style' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
          >🎨 Style</button>
          <button
            onClick={() => setRightTab('subtitles')}
            className={`flex-1 text-sm font-medium py-3 border-b-2 transition-colors ${rightTab === 'subtitles' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
          >📝 Subtitles ({project.subtitles.length})</button>
        </div>

        {rightTab === 'style' && (
          <div className="flex-1 overflow-y-auto pb-24 md:pb-4 custom-scrollbar">
            <StylePanel style={style} onChange={(s) => updateStyle(project.id, s)} />
          </div>
        )}

        {rightTab === 'subtitles' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24 md:pb-4 custom-scrollbar">
            {project.subtitles.map((sub, i) => (
              <div 
                key={sub.id} 
                id={`sub-${sub.id}`}
                className={`p-3 md:p-4 rounded-xl border transition-all ${
                  activeSubId === sub.id 
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm' 
                    : 'border-border/60 hover:border-border bg-card'
                }`}
              >
                <div className="flex justify-between items-center mb-2">
                  <button 
                    onClick={() => jumpToTime(sub.start)}
                    className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    {formatTime(sub.start).substring(0, 8)} ➔ {formatTime(sub.end).substring(0, 8)}
                  </button>
                  
                  {/* Confidence Indicator */}
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <button className="text-muted-foreground hover:text-foreground opacity-50 hover:opacity-100" title="Split subtitle">
                        <SplitSquareHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {sub.confidence < 0.9 && (
                      <div className="w-2 h-2 rounded-full bg-orange-400" title="Low confidence - Please review" />
                    )}
                  </div>
                </div>
                
                <textarea
                  value={sub.text}
                  onChange={(e) => updateSubtitle(project.id, sub.id, e.target.value)}
                  className={`w-full bg-transparent resize-none outline-none text-sm leading-relaxed ${activeSubId === sub.id ? 'text-foreground font-medium' : 'text-foreground/80'}`}
                  rows={2}
                  onFocus={() => {if(!isPlaying) jumpToTime(sub.start)}}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export Modal Overlay */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
           <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-card w-full max-w-sm rounded-3xl p-6 shadow-2xl border">
              {!isRendering ? (
                <>
                  <h3 className="text-lg font-semibold mb-4">Export Result</h3>
                  <div className="space-y-3">
                    <Button className="w-full justify-start rounded-xl h-12 bg-primary text-primary-foreground hover:bg-primary/90" onClick={exportVideo}>
                      <Video className="w-4 h-4 mr-3" /> Export Video (.MP4)
                    </Button>
                    <div className="relative flex items-center py-2">
                        <div className="flex-grow border-t border-border"></div>
                        <span className="flex-shrink-0 mx-4 text-muted-foreground text-[10px] tracking-wider uppercase">Or Text Formats</span>
                        <div className="flex-grow border-t border-border"></div>
                    </div>
                    <Button className="w-full justify-start rounded-xl h-12" variant="outline" onClick={() => exportSubs('srt')}>
                      <Download className="w-4 h-4 mr-3" /> Download .SRT
                    </Button>
                    <Button className="w-full justify-start rounded-xl h-12" variant="outline" onClick={() => exportSubs('vtt')}>
                      <Download className="w-4 h-4 mr-3" /> Download .VTT
                    </Button>
                    <Button className="w-full justify-start rounded-xl h-12" variant="outline" onClick={copyToClipboard}>
                      <Copy className="w-4 h-4 mr-3" /> Copy as Text
                    </Button>
                  </div>
                  <Button className="w-full mt-6" variant="ghost" onClick={() => setShowExport(false)}>Cancel</Button>
                </>
              ) : (
                <div className="py-8 flex flex-col items-center justify-center text-center">
                  <RefreshCw className="w-10 h-10 animate-spin text-primary mb-4" />
                  <h3 className="text-lg font-semibold">Rendering Media...</h3>
                  <p className="text-sm text-muted-foreground mt-2 mb-6 leading-relaxed">Encoding translated subtitles into the video format. Please don't close this window.</p>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-200" style={{ width: `${renderProgress}%` }} />
                  </div>
                  <span className="text-xs font-mono mt-3 text-muted-foreground">{Math.round(renderProgress)}% Complete</span>
                </div>
              )}
           </motion.div>
        </div>
      )}
    </div>
  );
}
