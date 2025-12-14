import { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        // Check if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsInstalled(true);
            return;
        }

        // Listen for beforeinstallprompt event
        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);

            // Show prompt after a short delay (don't interrupt user immediately)
            setTimeout(() => setShowPrompt(true), 3000);
        };

        window.addEventListener('beforeinstallprompt', handler);

        // Listen for successful installation
        window.addEventListener('appinstalled', () => {
            setIsInstalled(true);
            setShowPrompt(false);
            setDeferredPrompt(null);
        });

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setIsInstalled(true);
        }

        setShowPrompt(false);
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        // Don't show again for this session
        sessionStorage.setItem('pwa-prompt-dismissed', 'true');
    };

    // Don't show if already installed, dismissed, or no prompt available
    if (isInstalled || !showPrompt || sessionStorage.getItem('pwa-prompt-dismissed')) {
        return null;
    }

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-slideUp">
            <div className="bg-secondary border border-accent/30 rounded-2xl shadow-2xl shadow-accent/10 p-5 backdrop-blur-lg">
                <button
                    onClick={handleDismiss}
                    className="absolute top-3 right-3 p-1.5 text-muted hover:text-primary hover:bg-tertiary rounded-lg transition-colors"
                >
                    <X size={18} />
                </button>

                <div className="flex items-start gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-accent to-amber-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
                        <Smartphone size={28} className="text-white" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-lg text-primary mb-1">
                            Installer l'application
                        </h3>
                        <p className="text-sm text-muted mb-4">
                            Installez Librairie POS sur votre bureau pour un accès rapide et hors ligne.
                        </p>

                        <div className="flex gap-3">
                            <button
                                onClick={handleInstall}
                                className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold shadow-lg shadow-accent/20"
                            >
                                <Download size={18} />
                                Installer
                            </button>
                            <button
                                onClick={handleDismiss}
                                className="btn-ghost px-4 py-2.5 text-sm"
                            >
                                Plus tard
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
