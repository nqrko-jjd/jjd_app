'use client';

/** Barre Précédent/Suivant + taille de page, pour les listes paginées côté serveur. */
export function PaginationBar({
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
  sizes = [50, 100, 200, 500],
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  sizes?: number[];
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="row" style={{ marginTop: '0.8rem', gap: '0.5rem', alignItems: 'center' }}>
      <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Précédent</button>
      <span className="muted">Page {page} / {totalPages}</span>
      <button className="btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Suivant →</button>
      <select
        className="select"
        style={{ maxWidth: 140, marginLeft: 'auto' }}
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
      >
        {sizes.map((s) => <option key={s} value={s}>{s} / page</option>)}
      </select>
    </div>
  );
}
