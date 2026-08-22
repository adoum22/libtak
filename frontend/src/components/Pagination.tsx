import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}

export default function Pagination({
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    onPageChange
}: PaginationProps) {
    const { t } = useTranslation();
    if (totalPages <= 1) return null;

    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    const getPageNumbers = () => {
        const pages: (number | string)[] = [];
        const showPages = 5;

        if (totalPages <= showPages) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            if (currentPage <= 3) {
                pages.push(1, 2, 3, 4, '...', totalPages);
            } else if (currentPage >= totalPages - 2) {
                pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
            } else {
                pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
            }
        }
        return pages;
    };

    return (
        <nav
            className="accessible-pagination flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]"
            aria-label={t('ResultsPagination')}
        >
            <p className="text-sm text-muted" aria-live="polite">
                {t('ShowingResults', { start: startItem, end: endItem, total: totalItems })}
            </p>

            <div className="accessible-pagination__pages">
                <button
                    type="button"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg hover:bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label={t('PreviousPage')}
                >
                    <ChevronLeft size={18} aria-hidden="true" />
                </button>

                {getPageNumbers().map((page, index) => (
                    typeof page === 'number' ? (
                        <button
                            type="button"
                            key={`${page}-${index}`}
                            onClick={() => onPageChange(page)}
                            aria-label={t('PageNumber', { page })}
                            aria-current={currentPage === page ? 'page' : undefined}
                            className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${currentPage === page
                                    ? 'bg-accent text-white'
                                    : 'hover:bg-tertiary'
                                }`}
                        >
                            {page}
                        </button>
                    ) : (
                        <span key={`ellipsis-${index}`} className="px-2 text-muted" aria-hidden="true">…</span>
                    )
                ))}

                <button
                    type="button"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg hover:bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label={t('NextPage')}
                >
                    <ChevronRight size={18} aria-hidden="true" />
                </button>
            </div>
        </nav>
    );
}
