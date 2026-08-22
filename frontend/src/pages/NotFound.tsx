import { ArrowLeft, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
    const { t } = useTranslation();
    return (
        <main className="empty-state min-h-screen" aria-labelledby="not-found-title">
            <SearchX size={56} className="text-muted" aria-hidden="true" />
            <p className="badge">{t('Error404')}</p>
            <h1 id="not-found-title">{t('PageNotFound')}</h1>
            <p>{t('PageNotFoundMessage')}</p>
            <Link to="/" className="btn-primary">
                <ArrowLeft size={18} aria-hidden="true" />
                {t('BackToApp')}
            </Link>
        </main>
    );
}
