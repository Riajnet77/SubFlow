import React, { useEffect } from 'react';
import { useStore } from '@/src/store/useStore';
import { Sun, Moon, Monitor, LayoutDashboard, Settings } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';

export function AppLayout({ children, activeTab, onTabChange }: { children: React.ReactNode, activeTab: string, onTabChange: (t: string) => void }) {
  const { theme, setTheme } = useStore();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const getThemeIcon = () => {
    if (theme === 'light') return <Sun className="w-5 h-5" />;
    if (theme === 'dark') return <Moon className="w-5 h-5" />;
    return <Monitor className="w-5 h-5" />;
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar for Desktop / Bottom Nav for Mobile */}
      <aside className="fixed bottom-0 w-full h-16 bg-card border-t z-50 md:relative md:h-full md:w-64 md:border-t-0 md:border-r flex md:flex-col py-2 md:py-6 px-4 md:px-6">
        <div className="hidden md:flex items-center gap-2 mb-10 px-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg leading-none">S</span>
          </div>
          <h1 className="font-semibold text-lg tracking-tight">SubFlow</h1>
        </div>

        <nav className="flex-1 flex md:flex-col justify-around md:justify-start gap-2 w-full">
          <NavItem 
            icon={<LayoutDashboard className="w-5 h-5" />} 
            label="Projects" 
            active={activeTab === 'projects'} 
            onClick={() => onTabChange('projects')} 
          />
          <NavItem 
            icon={<Settings className="w-5 h-5" />} 
            label="Settings" 
            active={activeTab === 'settings'} 
            onClick={() => onTabChange('settings')} 
          />
        </nav>

        <div className="hidden md:block mt-auto pb-4">
          <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground" onClick={cycleTheme}>
            {getThemeIcon()}
            <span className="capitalize">{theme} Theme</span>
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-[calc(100vh-4rem)] md:h-screen overflow-y-auto relative">
        <header className="md:hidden flex items-center justify-between p-4 border-b bg-background/80 backdrop-blur sticky top-0 z-40">
           <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs leading-none">S</span>
            </div>
            <h1 className="font-semibold text-md tracking-tight">SubFlow</h1>
          </div>
          <Button variant="ghost" size="icon" onClick={cycleTheme}>
            {getThemeIcon()}
          </Button>
        </header>
        <div className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col md:flex-row items-center gap-1 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-xl transition-all ${
        active 
          ? 'bg-primary/5 text-primary md:bg-primary md:text-primary-foreground font-medium' 
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
    >
      {icon}
      <span className="text-[10px] md:text-sm font-medium">{label}</span>
      {active && (
        <span className="md:hidden absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}
