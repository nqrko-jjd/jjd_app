'use client';
import Link from 'next/link';
import { Network, Check, Clock3, CircleAlert } from 'lucide-react';
import { tr } from '@/lib/ui-language';

export function peppolDisplay(id?: string | null, status?: string | null) {
  if (!id && !status) return null;
  if (status === 'error') return { tone: 'error', label: 'Peppol : échec de livraison', detail: 'La livraison a échoué. Ouvrez le suivi Peppol pour vérifier ou réessayer.' };
  if (id && status === 'delivered') return { tone: 'delivered', label: 'Peppol : réception confirmée', detail: 'Le point d’accès Peppol du client a confirmé la réception. Cela ne signifie pas que la facture est payée ou lue.' };
  if (id) return { tone: 'pending', label: 'Peppol : confirmation en attente', detail: 'Document transmis au réseau Peppol. La réception chez le client n’est pas encore confirmée.' };
  return { tone: 'pending', label: 'Peppol : envoi non confirmé', detail: 'Aucune référence de transmission disponible. Ce statut ne constitue pas une preuve d’envoi.' };
}

export function PeppolStatus({ peppolId, peppolStatus, href, compact = false }: {
  peppolId?: string | null; peppolStatus?: string | null; href?: string; compact?: boolean;
}) {
  const state = peppolDisplay(peppolId, peppolStatus);
  if (!state) return null;
  const Icon = state.tone === 'delivered' ? Check : state.tone === 'error' ? CircleAlert : Clock3;
  const label = tr(state.label);
  const content = <><span className="peppol-symbol" aria-hidden="true"><Network size={19}/><Icon size={11}/></span>{!compact && <span>{label}</span>}</>;
  const className = `peppol-status peppol-${state.tone}${compact ? ' compact' : ''}`;
  const title = `${label}. ${tr(state.detail)}`;
  return href
    ? <Link href={href} className={className} title={title} aria-label={title} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>{content}</Link>
    : <span className={className} title={title} aria-label={title}>{content}</span>;
}
