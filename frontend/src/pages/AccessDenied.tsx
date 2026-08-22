import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function AccessDenied() {
    const { t } = useTranslation();
    return (
        <section className="empty-state min-h-[60vh]" aria-labelledby="access-denied-title">
            <ShieldAlert size={56} className="text-warning" aria-hidden="true" />
            <h1 id="access-denied-title">{t('AccessDenied')}</h1>
            <p>{t('AccessDeniedMessage')}</p>
            <Link to="/" className="btn-primary">
                <ArrowLeft size={18} aria-hidden="true" />
                {t('BackToHome')}
            </Link>
        </section>
    );
}
