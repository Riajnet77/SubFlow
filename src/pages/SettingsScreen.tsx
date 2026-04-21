import { Button } from '@/src/components/ui/Button';

export function SettingsScreen() {
  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto py-8">
      <div>
        <h2 className="text-3xl md:text-5xl font-semibold tracking-tight">Settings</h2>
        <p className="text-muted-foreground mt-2 text-sm md:text-base">Manage your application preferences.</p>
      </div>

      <div className="mt-8 space-y-8">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Export Preferences</h3>
          <div className="flex items-center justify-between p-4 bg-card border rounded-2xl">
            <div>
              <p className="font-medium">Burn-in Subtitles</p>
              <p className="text-sm text-muted-foreground">Hardcode subtitles into exported video.</p>
            </div>
            <div className="w-12 h-6 bg-muted rounded-full relative cursor-pointer">
              <div className="w-5 h-5 bg-white rounded-full shadow absolute top-0.5 left-0.5" />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Data & Privacy</h3>
          <div className="flex items-center justify-between p-4 bg-card border border-destructive/20 rounded-2xl">
            <div>
              <p className="font-medium text-destructive">Clear All Data</p>
              <p className="text-sm text-muted-foreground">Remove all local projects and subtitles.</p>
            </div>
            <Button variant="destructive" onClick={() => {
               if(confirm('Are you sure? This cannot be undone.')) {
                 localStorage.removeItem('subflow-storage');
                 window.location.reload();
               }
            }}>Clear</Button>
          </div>
        </div>

      </div>
    </div>
  );
}
