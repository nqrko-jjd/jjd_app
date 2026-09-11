'use client';

/** Taille de page conventionnellement utilisée pour « Tout afficher » (au-delà des volumes
 *  réels de l'appli — sert surtout à vérifier qu'une liste complète est bien là, ex. tous les R-). */
export const PAGE_SIZE_ALL = 5000;

/** Barre Précédent/Suivant + taille de page, pour les listes paginées côté serveur. Le
 *  sélecteur de taille reste visible même sur une seule page, pour pouvoir revenir à une
 *  pagination plus fine après avoir choisi « Tout afficher ». */
export function PaginationBar({
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
  sizes = [50, 100, 200, 500, PAGE_SIZE_ALL],
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  sizes?: number[];
}) {
  return (
    <div className="row" style={{ marginTop: '0.8rem', gap: '0.5rem', alignItems: 'center' }}>
      {totalPages > 1 && (
        <>
          <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Précédent</button>
          <span className="muted">Page {page} / {totalPages}</span>
          <button className="btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Suivant →</button>
        </>
      )}
      <select
        className="select"
        style={{ maxWidth: 160, marginLeft: 'auto' }}
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
      >
        {sizes.map((s) => <option key={s} value={s}>{s >= PAGE_SIZE_ALL ? 'Tout afficher' : `${s} / page`}</option>)}
      </select>
    </div>
  );
}
