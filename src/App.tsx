import { useState, useEffect } from 'react';
import { useStore } from '@/src/store/useStore';
import { AppLayout } from '@/src/components/layout/AppLayout';
import { ProjectsList } from '@/src/pages/ProjectsList';
import { EditorScreen } from '@/src/pages/EditorScreen';
import { UploadModal } from '@/src/pages/UploadModal';
import { SettingsScreen } from '@/src/pages/SettingsScreen';
import { initFirebaseSync, loginWithGoogle } from '@/src/lib/firebase';
import { Button } from '@/src/components/ui/Button';
import { Video } from 'lucide-react';

export default function App() {
  const { user, activeProjectId, setActiveProject } = useStore();
  const [activeTab, setActiveTab] = useState('projects');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  useEffect(() => {
    initFirebaseSync();
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 text-primary">
            <Video className="w-8 h-8" />
          </div>
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight mb-2">Welcome to SubFlow</h1>
          <p className="text-muted-foreground text-center max-w-md mb-8">Sign in to sync your transcription projects securely to the cloud and export rendered videos directly from our servers.</p>
          <Button onClick={loginWithGoogle} size="lg" className="rounded-full px-8 shadow-lg shadow-primary/20">
            Sign In with Google
          </Button>
      </div>
    );
  }

  // If a project is active, show the Editor (it takes over the whole screen effectively)
  if (activeProjectId) {
    return (
      <div className="h-screen w-full bg-background text-foreground overflow-hidden">
        <EditorScreen 
          projectId={activeProjectId} 
          onBack={() => setActiveProject(null)} 
        />
      </div>
    );
  }

  return (
    <>
      <AppLayout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'projects' && (
          <ProjectsList 
            onNewProject={() => setIsUploadModalOpen(true)}
            onOpenProject={(id) => setActiveProject(id)}
          />
        )}
        {activeTab === 'settings' && <SettingsScreen />}
      </AppLayout>

      <UploadModal 
        isOpen={isUploadModalOpen} 
        onClose={() => setIsUploadModalOpen(false)} 
      />
    </>
  );
}
