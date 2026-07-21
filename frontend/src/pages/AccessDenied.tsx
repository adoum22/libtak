import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AccessDenied() {
    return (
        <section className="empty-state min-h-[60vh]" aria-labelledby="access-denied-title">
            <ShieldAlert size={56} className="text-warning" aria-hidden="true" />
            <h1 id="access-denied-title">Accès non autorisé</h1>
            <p>Votre compte ne possède pas la permission nécessaire pour cette page.</p>
            <Link to="/" className="btn-primary">
                <ArrowLeft size={18} aria-hidden="true" />
                Revenir à l’accueil
            </Link>
        </section>
    );
}
