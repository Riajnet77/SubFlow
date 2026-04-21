import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/src/store/useStore';
import { Button } from '@/src/components/ui/Button';
import { ArrowLeft, Play, Pause, Download, Languages, SplitSquareHorizontal, CheckCircle2, Copy, Video, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { formatTime, generateVTT, generateSRT, downloadFile } from '@/src/lib/utils';

export function EditorScreen({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { projects, updateSubtitle } = useStore();
  const project = projects.find(p => p.id === projectId);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);

  useEffect(() => {
    if(!videoRef.current) return;
    const v = videoRef.current;
    
    const handleTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      // Find active subtitle
      if (project) {
        const active = project.subtitles.find(s => v.currentTime >= s.start && v.currentTime <= s.end);
        if (active) {
          setActiveSubId(active.id);
          // Auto scroll into view (rough implementation)
          const el = document.getElementById(`sub-${active.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          setActiveSubId(null);
        }
      }
    };

    v.addEventListener('timeupdate', handleTimeUpdate);
    v.addEventListener('play', () => setIsPlaying(true));
    v.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      v.removeEventListener('timeupdate', handleTimeUpdate);
      v.removeEventListener('play', () => setIsPlaying(true));
      v.removeEventListener('pause', () => setIsPlaying(false));
    }
  }, [project]);

  if (!project) {
    return <div>Project not found</div>;
  }

  const handlePlayPause = () => {
    if(videoRef.current) {
      if(isPlaying) videoRef.current.pause();
      else videoRef.current.play();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow space to play/pause only if not typing in a textarea
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
      const interval = setInterval(() => {
        p += Math.random() * 3;
        if (p < 85) setRenderProgress(p);
      }, 1500);

      const response = await fetch(project.videoUrl);
      const blob = await response.blob();
      
      const formData = new FormData();
      formData.append('video', blob, `${project.name}.mp4`);
      formData.append('subtitles', JSON.stringify(project.subtitles));

      const renderRes = await fetch('/api/render', {
        method: 'POST',
        body: formData,
      });

      clearInterval(interval);
      setRenderProgress(100);

      if (!renderRes.ok) {
        throw new Error('Rendering failed on the server');
      }

      const outBlob = await renderRes.blob();
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
          
          {/* Active Subtitle Overlay */}
          <div className="absolute bottom-16 md:bottom-8 left-0 w-full flex justify-center pointer-events-none px-4 md:px-12">
            {activeSubId && (
              <div 
                className="bg-black/70 backdrop-blur-sm px-3 py-1.5 md:px-5 md:py-2 rounded-md text-[#FFFFEA] text-center text-sm md:text-base lg:text-lg font-medium shadow-lg shadow-black/50 border border-white/5 break-words max-w-full"
                style={{
                  textWrap: "balance"
                }}
              >
                {project.subtitles.find(s => s.id === activeSubId)?.text}
              </div>
            )}
          </div>

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
        <div className="p-4 border-b flex items-center justify-between bg-card sticky top-0 z-10">
          <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Subtitles</h3>
          <div className="text-xs font-mono text-muted-foreground">{project.subtitles.length} segments</div>
        </div>
        
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
