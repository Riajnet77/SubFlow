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

// ── Subtitle style (presets, box position, colors) ─────────────────────────
export interface SubBox { x: number; y: number; w: number; h: number; }
export interface SubStyle {
  fontSize: number;
  fontName: string;
  primaryColor: string;
  outlineColor: string;
  bgOpacity: number;
  preset: string;
  box: SubBox;
}

export const DEFAULT_BOX: SubBox = { x: 5, y: 78, w: 90, h: 14 };
export const DEFAULT_STYLE: SubStyle = {
  fontSize: 26,
  fontName: 'Impact',
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  bgOpacity: 0,
  preset: 'impact',
  box: DEFAULT_BOX,
};

export const FONTS = ['Arial', 'Impact', 'Georgia', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Courier New'];

// NOTE: matches the preset keys the backend (server.ts) already understands
// (boxPresets / impactPresets / inline-tag logic all key off style.preset).
export const PRESETS: Record<string, Partial<SubStyle>> = {
  impact:   { fontName: 'Impact',       fontSize: 26, primaryColor: '#FFFFFF', outlineColor: '#000000', bgOpacity: 0 },
  bold:     { fontName: 'Impact',       fontSize: 30, primaryColor: '#FFFF00', outlineColor: '#000000', bgOpacity: 0 },
  neon:     { fontName: 'Arial',        fontSize: 22, primaryColor: '#00FFFF', outlineColor: '#0055FF', bgOpacity: 0 },
  fire:     { fontName: 'Impact',       fontSize: 26, primaryColor: '#FF4500', outlineColor: '#FFD700', bgOpacity: 0 },
  ice:      { fontName: 'Arial',        fontSize: 20, primaryColor: '#E0F7FF', outlineColor: '#0099CC', bgOpacity: 0.25 },
  cinema:   { fontName: 'Georgia',      fontSize: 18, primaryColor: '#FFFFFF', outlineColor: '#000000', bgOpacity: 0.75 },
  minimal:  { fontName: 'Arial',        fontSize: 16, primaryColor: '#FFFFFF', outlineColor: '#222222', bgOpacity: 0 },
  classic:  { fontName: 'Arial',        fontSize: 18, primaryColor: '#FFFFFF', outlineColor: '#000000', bgOpacity: 0.55 },
  karaoke:  { fontName: 'Impact',       fontSize: 28, primaryColor: '#FFFF00', outlineColor: '#FF6600', bgOpacity: 0 },
  shadow:   { fontName: 'Impact',       fontSize: 26, primaryColor: '#FFFFFF', outlineColor: '#000000', bgOpacity: 0 },
  pink:     { fontName: 'Arial',        fontSize: 22, primaryColor: '#FF69B4', outlineColor: '#880033', bgOpacity: 0 },
  matrix:   { fontName: 'Courier New',  fontSize: 18, primaryColor: '#00FF00', outlineColor: '#003300', bgOpacity: 0 },
  retro:    { fontName: 'Impact',       fontSize: 24, primaryColor: '#FFA500', outlineColor: '#8B4513', bgOpacity: 0 },
  elegant:  { fontName: 'Georgia',      fontSize: 20, primaryColor: '#FFD700', outlineColor: '#8B6914', bgOpacity: 0 },
  purple:   { fontName: 'Impact',       fontSize: 24, primaryColor: '#CC99FF', outlineColor: '#330066', bgOpacity: 0 },
  green:    { fontName: 'Arial',        fontSize: 20, primaryColor: '#00FF88', outlineColor: '#006633', bgOpacity: 0 },
  darkbox:  { fontName: 'Arial',        fontSize: 18, primaryColor: '#FFFFFF', outlineColor: '#000000', bgOpacity: 0.85 },
  whitebox: { fontName: 'Arial',        fontSize: 18, primaryColor: '#000000', outlineColor: '#FFFFFF', bgOpacity: 0.9 },
  reels:    { fontName: 'Impact',       fontSize: 28, primaryColor: '#FFFFFF', outlineColor: '#000000', bgOpacity: 0 },
};

export const PRESET_LIST = [
  { key: 'impact',   label: 'Impact',    emoji: '💥' }, { key: 'bold',     label: 'Bold',     emoji: '⚡' },
  { key: 'neon',     label: 'Neon',      emoji: '🌀' }, { key: 'fire',     label: 'Fire',     emoji: '🔥' },
  { key: 'ice',      label: 'Ice',       emoji: '❄️' }, { key: 'cinema',   label: 'Cinema',   emoji: '🎬' },
  { key: 'classic',  label: 'Classic',   emoji: '📺' }, { key: 'minimal',  label: 'Minimal',  emoji: '◻️' },
  { key: 'karaoke',  label: 'Karaoke',   emoji: '🎤' }, { key: 'shadow',   label: 'Shadow',   emoji: '🌑' },
  { key: 'pink',     label: 'Pink',      emoji: '🩷' }, { key: 'matrix',   label: 'Matrix',   emoji: '💻' },
  { key: 'retro',    label: 'Retro',     emoji: '📼' }, { key: 'elegant',  label: 'Elegant',  emoji: '✨' },
  { key: 'purple',   label: 'Purple',    emoji: '🟣' }, { key: 'green',    label: 'Green',    emoji: '💚' },
  { key: 'darkbox',  label: 'Dark Box',  emoji: '⬛' }, { key: 'whitebox', label: 'White Box', emoji: '⬜' },
  { key: 'reels',    label: 'Reels',     emoji: '🎞️' },
];

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
  style?: SubStyle; // optional for backward compat with projects saved before this existed
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
  updateStyle: (projectId: string, style: SubStyle) => void;
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
          // Every new project gets a style so the preview/export always has one.
          const newProjects = [{ ...project, style: project.style ?? DEFAULT_STYLE }, ...state.projects];
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
      updateStyle: (projectId, style) => {
        let updatedProject: Project | undefined;
        set((state) => {
          const newProjects = state.projects.map((p) => {
            if (p.id !== projectId) return p;
            updatedProject = { ...p, style };
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
