import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncProjectToDB, deleteProjectFromDB } from '../lib/firebase';

export interface Subtitle {
  id: string;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface UserInfo {
  uid: string;
  email: string | null;
  name: string;
  photoUrl: string;
}

export interface Project {
  id: string;
  userId?: string;
  name: string;
  status: 'processing' | 'ready' | 'failed';
  videoUrl?: string; // object URL, volatile
  thumbnailUrl?: string;
  duration: number;
  sourceLang: string;
  targetLang: string;
  subtitles: Subtitle[];
  createdAt: string;
  progress: number;
  error?: string;
}

interface AppState {
  user: UserInfo | null;
  projects: Project[];
  activeProjectId: string | null;
  addProject: (project: Project) => void;
  updateProject: (id: string, data: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  updateSubtitle: (projectId: string, subId: string, newText: string) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      projects: [],
      activeProjectId: null,
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      addProject: (project) => {
        set((state) => {
          const newProjects = [project, ...state.projects];
          return { projects: newProjects };
        });
        syncProjectToDB(project).catch(console.error);
      },
      updateProject: (id, data) => {
        let updatedProject: Project | undefined;
        set((state) => {
          const newProjects = state.projects.map((p) => {
            if (p.id === id) {
              updatedProject = { ...p, ...data };
              return updatedProject;
            }
            return p;
          });
          return { projects: newProjects };
        });
        if (updatedProject) syncProjectToDB(updatedProject).catch(console.error);
      },
      deleteProject: (id) => {
         set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
        }));
        deleteProjectFromDB(id).catch(console.error);
      },
      setActiveProject: (id) => set({ activeProjectId: id }),
      updateSubtitle: (projectId, subId, newText) => {
        let updatedProject: Project | undefined;
        set((state) => {
          const newProjects = state.projects.map((p) => {
            if (p.id !== projectId) return p;
            updatedProject = {
              ...p,
              subtitles: p.subtitles.map((sub) => (sub.id === subId ? { ...sub, text: newText } : sub)),
            };
            return updatedProject;
          });
          return { projects: newProjects };
        });
        if (updatedProject) syncProjectToDB(updatedProject).catch(console.error);
      },
    }),
    {
      name: 'subflow-storage',
      partialize: (state) => ({ 
        projects: state.projects.map(p => ({
          ...p,
          videoUrl: undefined,
          thumbnailUrl: undefined,
          status: p.status === 'processing' ? 'failed' : p.status
        })),
        theme: state.theme
      }),
    }
  )
);
