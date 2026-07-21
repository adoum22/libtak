import { ArrowLeft, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NotFound() {
    return (
        <main className="empty-state min-h-screen" aria-labelledby="not-found-title">
            <SearchX size={56} className="text-muted" aria-hidden="true" />
            <p className="badge">Erreur 404</p>
            <h1 id="not-found-title">Page introuvable</h1>
            <p>L’adresse demandée n’existe pas ou a été déplacée.</p>
            <Link to="/" className="btn-primary">
                <ArrowLeft size={18} aria-hidden="true" />
                Retour à l’application
            </Link>
        </main>
    );
}
