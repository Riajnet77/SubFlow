import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useStore } from '@/src/store/useStore';
import { Button } from '@/src/components/ui/Button';
import { UploadCloud, X, FileVideo } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function UploadModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { addProject } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const [isProcessing, setIsProcessing] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles[0]) {
      setFile(acceptedFiles[0]);
    }
  }, []);

  // @ts-expect-error - react-dropzone types mismatch with React 19 occasionally
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    maxSize: 1024 * 1024 * 500, // 500MB fake limit for UI
    multiple: false
  });

  const handleProcess = () => {
    if (!file) return;
    setIsProcessing(true);

    const videoUrl = URL.createObjectURL(file);
    const id = Date.now().toString();

    const video = document.createElement('video');
    video.src = videoUrl;
    video.onloadedmetadata = async () => {
      const fileName = file.name.replace(/\.[^/.]+$/, "");
      const duration = video.duration;

      addProject({
        id,
        name: fileName,
        status: 'processing',
        videoUrl,
        duration,
        sourceLang: sourceLang === 'auto' ? 'Auto-Detect' : sourceLang,
        targetLang,
        subtitles: [],
        createdAt: new Date().toISOString(),
        progress: 0
      });

      // Show artificial uploading setup progress
      updateProgress(id, 20);

      try {
        const langMap: Record<string, string> = {
          en: 'English',
          es: 'Spanish',
          pt: 'Portuguese',
          fr: 'French',
          de: 'German',
          ja: 'Japanese'
        };
        
        const targetLangName = langMap[targetLang] || 'English';

        // Generate realistic mock transcription based on filename, duration, and target language
        const prompt = `Generate a realistic fictional video transcript for a video titled "${fileName}".
        The total video duration is ${duration.toFixed(1)} seconds.
        Create a sequence of subtitles that spans this entire duration. 
        Each subtitle usually lasts 2 to 6 seconds.
        Make the spoken text contextually relevant to the title "${fileName}". 
        Include hesitations or natural speech patterns.
        IMPORTANT: The spoken text MUST be entirely written / translated in ${targetLangName}.
        Provide the response strictly as a JSON array.`;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: { type: Type.NUMBER, description: "Start time in seconds" },
                  end: { type: Type.NUMBER, description: "End time in seconds" },
                  text: { type: Type.STRING, description: "Spoken text" },
                  confidence: { type: Type.NUMBER, description: "Confidence score between 0.70 and 0.99" }
                },
                required: ["start", "end", "text", "confidence"]
              }
            }
          }
        });

        updateProgress(id, 80);

        const generatedData = JSON.parse(response.text.trim());
        const subtitles = generatedData.map((item: any, i: number) => ({
          id: `sub-${i}-${Date.now()}`,
          start: item.start,
          end: item.end,
          text: item.text,
          confidence: item.confidence
        }));

        useStore.getState().updateProject(id, { 
          progress: 100, 
          status: 'ready',
          subtitles: subtitles
        });
      } catch (error) {
        console.error("AI Generation failed:", error);
        // Fallback if the AI fails
        const mockSubs = Array.from({ length: Math.ceil(duration / 3) }).map((_, i) => ({
          id: `sub-${i}-fallback`,
          start: i * 3,
          end: Math.min((i * 3) + 2.8, duration),
          text: `Fallback caption ${i + 1} for ${fileName}.`,
          confidence: 0.9
        }));
        
        useStore.getState().updateProject(id, { 
          progress: 100, 
          status: 'ready',
          subtitles: mockSubs
        });
      }

      setIsProcessing(false);
      setFile(null);
      onClose();
    };
    
    setTimeout(() => {
      if(video.readyState === 0) {
        addProject({
          id,
          name: file.name.replace(/\.[^/.]+$/, ""),
          status: 'failed',
          duration: 0,
          sourceLang, targetLang, subtitles: [], createdAt: new Date().toISOString(), progress: 0
        });
        setIsProcessing(false); setFile(null); onClose();
      }
    }, 2000);
  };

  const updateProgress = (id: string, progress: number) => {
    useStore.getState().updateProject(id, { progress });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4">
        <motion.div 
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="bg-card w-full max-w-lg md:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[90vh]"
        >
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-xl font-semibold">New Project</h2>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full -mr-2">
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="p-6 overflow-y-auto">
            {!file ? (
              <div 
                {...getRootProps()} 
                className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'}`}
              >
                <input {...getInputProps()} />
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <h3 className="font-medium text-lg">Upload Video</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-[200px]">
                  Drag and drop your video file here, or click to browse. Max 1hr.
                </p>
              </div>
            ) : (
              <div className="bg-muted/50 border rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex flex-shrink-0 items-center justify-center text-primary">
                    <FileVideo className="w-6 h-6" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / (1024*1024)).toFixed(2)} MB</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setFile(null)} className="text-muted-foreground">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}

            <div className="mt-8 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spoken Language</label>
                  <select 
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="auto">Auto-Detect</option>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="pt">Portuguese</option>
                    <option value="fr">French</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Translate To</label>
                  <select 
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="pt">Portuguese</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="ja">Japanese</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 border-t mt-auto">
            <Button 
              size="lg" 
              className="w-full rounded-xl" 
              disabled={!file || isProcessing}
              onClick={handleProcess}
            >
              {isProcessing ? 'Preparing...' : 'Start Processing'}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
