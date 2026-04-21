import { useState } from 'react';
import { useStore } from '@/src/store/useStore';
import { Button } from '@/src/components/ui/Button';
import { Plus, Search, Video, Clock, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { formatTime } from '@/src/lib/utils';

export function ProjectsList({ onNewProject, onOpenProject }: { onNewProject: () => void, onOpenProject: (id: string) => void }) {
  const { projects } = useStore();
  const [search, setSearch] = useState('');

  const filteredProjects = projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-6 w-full pb-20 md:pb-0">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight">Your Projects</h2>
          <p className="text-muted-foreground mt-2 text-sm md:text-base">Manage and edit your video transcriptions.</p>
        </div>
        <Button onClick={onNewProject} size="lg" className="rounded-full shadow-lg shadow-primary/20 shrink-0">
          <Plus className="w-5 h-5 mr-2" />
          New Project
        </Button>
      </div>

      <div className="relative mt-4">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search projects..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-12 pl-10 pr-4 rounded-xl border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
        {filteredProjects.length === 0 ? (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Video className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-medium">No projects found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {search ? "Try adjusting your search terms." : "Upload a video to start transcribing and translating your content."}
            </p>
          </div>
        ) : (
          filteredProjects.map((p, i) => (
            <motion.div
              layoutId={`proj-${p.id}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => p.status !== 'processing' && onOpenProject(p.id)}
              key={p.id}
              className={`group flex flex-col bg-card border rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:border-primary/20 ${p.status === 'processing' ? 'opacity-80 cursor-default' : 'cursor-pointer'}`}
            >
              <div className="h-32 bg-muted relative overflow-hidden flex items-center justify-center">
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt={p.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <Video className="w-8 h-8 text-muted-foreground/30" />
                )}
                {p.status === 'processing' && (
                  <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex flex-col items-center justify-center p-4">
                    <RefreshCw className="w-8 h-8 animate-spin text-primary mb-2" />
                    <div className="w-full bg-muted/50 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${p.progress}%` }} />
                    </div>
                  </div>
                )}
                <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur px-2 py-0.5 rounded text-[10px] text-white font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatTime(p.duration).split('.')[0]}
                </div>
              </div>
              <div className="p-4 flex flex-col flex-1">
                <h3 className="font-semibold line-clamp-1">{p.name}</h3>
                <div className="flex items-center justify-between mt-2 flex-1 items-end">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    {p.sourceLang} → {p.targetLang}
                  </div>
                  {p.status === 'failed' ? (
                    <span className="text-xs text-destructive flex items-center gap-1 bg-destructive/10 px-2 py-1 rounded-full"><AlertCircle className="w-3 h-3"/> Failed</span>
                  ) : p.status === 'ready' ? (
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
