import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export default function NetworkStatusBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[250] flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-semibold text-black shadow-lg"
      role="status"
      aria-live="assertive"
    >
      <WifiOff size={18} aria-hidden="true" />
      Connexion interrompue : consultation possible, mais les opérations ne seront pas envoyées.
    </div>
  );
}
