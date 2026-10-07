'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Money } from '@/lib/ui';
import { ContactPicker } from '@/components/ContactPicker';

/**
 * Sous un virement ENTRANT : la part qui n'est affectée à aucune facture (« reçu sans facture ») et le client à qui elle est attribuée.
 * Ce client verra ce montant sur sa fiche (acompte à facturer ou trop-perçu à rendre). Rien d'affiché quand tout est réparti.
 */
export function BankClientAssign({ txId, amount, shares, contact, onDone }: {
  txId: string;
  amount: number;
  /** part affectée par lien (null = le lien prend tout le virement) */
  shares: (number | null)[];
  contact: { id: string; name: string } | null;
  onDone: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const remaining = shares.length === 0 ? amount : shares.some((s) => s == null) ? 0 : Math.max(0, Math.round((amount - shares.reduce<number>((s, x) => s + (x ?? 0), 0)) * 100) / 100);
  if (remaining <= 0.01 && !contact) return null;

  async function assign(contactId: string | null) {
    setBusy(true);
    try { await api(`/api/finance/bank/${txId}`, { method: 'PATCH', body: { contactId } }); setPicking(false); onDone(); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: '0.35rem', fontSize: '0.76rem' }}>
      {remaining > 0.01 && (
        <div style={{ color: 'var(--warn, #b7791f)' }}>
          Reçu sans facture : <strong><Money value={remaining} /></strong>
        </div>
      )}
      <div className="muted">
        {contact ? <>Client : <strong>{contact.name}</strong>{' '}<button type="button" className="bank-document-link" disabled={busy} onClick={() => setPicking((v) => !v)}>changer</button>{' · '}<button type="button" className="bank-document-link" disabled={busy} onClick={() => assign(null)}>retirer</button></>
          : remaining > 0.01 ? <button type="button" className="bank-document-link" disabled={busy} onClick={() => setPicking((v) => !v)}>Attribuer à un client…</button> : null}
      </div>
      {picking && (
        <div style={{ marginTop: '0.3rem', minWidth: 240 }}>
          <ContactPicker value={contact?.id ?? ''} onChange={(id) => { if (id) assign(id); }} placeholder="client ou payeur" />
        </div>
      )}
    </div>
  );
}
