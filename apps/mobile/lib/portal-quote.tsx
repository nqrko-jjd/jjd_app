import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/lib/AppText';
import { apiSend } from './api';
import { openApiFile } from './files';
import { Alert } from './i18n';
import { Badge, Card, Muted, dateBE, eur } from './ui';
import { BigButton, DOC_TONE, quoteLabel } from './portal';

export interface PortalQuote {
  id: string; number: string | null; title: string | null; status: string; hasPdf: boolean;
  totalHt: number | null; totalTtc: number | null; issuedOn: string | null; dueOn: string | null;
  building?: string | null; worksiteRef?: string | null;
}

export async function openPortalPdf(id: string, number: string | null) {
  try { await openApiFile(`/api/portal/documents/${id}/pdf`, `${number ?? 'document'}.pdf`); }
  catch (e) { Alert.alert('Document', (e as Error).message); }
}

/** Carte devis : voir le PDF, accepter ou refuser (avec confirmation). */
export function QuoteCard({ q, onChanged }: { q: PortalQuote; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const pending = q.status !== 'accepted' && q.status !== 'declined';
  // un devis brouillon/expiré ne se signe pas depuis l'appli : seul « envoyé » est à valider
  const actionable = q.status === 'sent';

  async function respond(decision: 'accept' | 'decline') {
    setBusy(true);
    try {
      await apiSend(`/api/portal/quotes/${q.id}/${decision}`, 'POST', {}, false);
      onChanged();
    } catch (e) { Alert.alert('Erreur', (e as Error).message); }
    finally { setBusy(false); }
  }
  function confirm(decision: 'accept' | 'decline') {
    const yes = decision === 'accept';
    Alert.alert(
      yes ? 'Accepter ce devis ?' : 'Refuser ce devis ?',
      yes ? `Vous acceptez le devis ${q.number} de ${eur(q.totalTtc)} TTC. JJD sera prévenu.` : `Vous refusez le devis ${q.number}. JJD sera prévenu.`,
      [{ text: 'Annuler', style: 'cancel' }, { text: yes ? 'Oui, j’accepte' : 'Oui, je refuse', style: yes ? 'default' : 'destructive', onPress: () => void respond(decision) }],
    );
  }

  return (
    <Card accent={actionable ? '#e0c68e' : undefined}>
      <Text style={{ fontWeight: '700', fontSize: 16 }}>{q.title || `Devis ${q.number}`}</Text>
      <Muted>{[q.number, q.building, q.issuedOn ? `émis le ${dateBE(q.issuedOn)}` : null].filter(Boolean).join(' · ')}</Muted>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Badge tone={DOC_TONE[q.status]}>{quoteLabel(q.status)}</Badge>
        <Text style={{ fontWeight: '800', fontSize: 17 }}>{eur(q.totalTtc)} <Text style={{ fontWeight: '400', fontSize: 12 }}>TTC</Text></Text>
      </View>
      {q.dueOn && pending ? <Muted>Valable jusqu’au {dateBE(q.dueOn)}</Muted> : null}
      {q.hasPdf ? <BigButton label="Voir le devis (PDF)" icon="file-text" tone="ghost" onPress={() => void openPortalPdf(q.id, q.number)} /> : null}
      {actionable ? (
        <View style={{ gap: 10 }}>
          <BigButton label="Accepter le devis" icon="check" busy={busy} onPress={() => confirm('accept')} />
          <BigButton label="Refuser le devis" tone="danger" busy={busy} onPress={() => confirm('decline')} />
        </View>
      ) : null}
    </Card>
  );
}
