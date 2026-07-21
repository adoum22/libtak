import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

type ApplyUpdate = () => void | Promise<void>;

export default function PWAUpdatePrompt() {
  const [applyUpdate, setApplyUpdate] = useState<ApplyUpdate | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const apply = (event as CustomEvent<{ apply?: ApplyUpdate }>).detail?.apply;
      if (typeof apply === 'function') setApplyUpdate(() => apply);
    };
    window.addEventListener('pwa:update-available', onUpdate);
    return () => window.removeEventListener('pwa:update-available', onUpdate);
  }, []);

  if (!applyUpdate) return null;

  return (
    <aside
      className="fixed bottom-24 left-1/2 z-[200] flex w-[min(92vw,34rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-accent/30 bg-secondary p-4 shadow-2xl md:bottom-6"
      role="status"
      aria-live="polite"
    >
      <RefreshCw className="shrink-0 text-accent" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        Une nouvelle version est prête. Enregistrez votre travail puis actualisez l’application.
      </p>
      <button
        type="button"
        className="btn-primary shrink-0"
        disabled={updating}
        aria-busy={updating}
        onClick={async () => {
          setUpdating(true);
          try {
            await applyUpdate();
          } finally {
            setUpdating(false);
          }
        }}
      >
        {updating ? 'Mise à jour…' : 'Actualiser'}
      </button>
      <button
        type="button"
        className="btn-ghost shrink-0 p-2"
        aria-label="Reporter la mise à jour"
        onClick={() => setApplyUpdate(null)}
      >
        <X size={18} />
      </button>
    </aside>
  );
}
