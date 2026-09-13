'use client';

/** Sélecteur d'assignés à cases à cocher (équipe active — ouvriers, chefs, bureau). */
export function AssigneePicker({
  people,
  value,
  onChange,
}: {
  people: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }
  return (
    <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: '0.4rem 0.6rem' }}>
      {people.length === 0 && <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>Aucune personne active.</p>}
      {people.map((p) => (
        <label key={p.id} className="row" style={{ gap: '0.5rem', alignItems: 'center', padding: '0.22rem 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
          <span>{p.name}</span>
        </label>
      ))}
    </div>
  );
}
