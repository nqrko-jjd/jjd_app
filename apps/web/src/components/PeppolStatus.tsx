'use client';
import Link from 'next/link';
import { Check, Clock3, CircleAlert } from 'lucide-react';
import { tr } from '@/lib/ui-language';

// Official standalone Peppol mark (no wordmark), from peppol.org.
// Its alpha channel is used as a mask so delivery status controls the colour.
const peppolMark = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAE90lEQVRYw7XXeYxdZRkG8N9Mp1C6OUJJtWXTUOyxGgJBpOzQEoghhTa4lBKiINSArAHEUykJy4Egi5IqJEKjCASxYBUbTVFrSN1QkGLpqezQDQVhUgrdpr38Mc9tbmCmnQE8ycnNvfc73/e8z/u8z/ueNgO5yroNR+Kn2AOLcBZeUBUN7+NqH+D6oTg3nw/jEFyKId7n1THA9Z8KA4twFW7Fl7BQWS/COmwZCBttA6B+J8zETXgJXdgHu+EVPIdleAR/wsuqYssHB1DWHTgguT4Jo7Aaz2MNNmAkxgbQyIC5B3dj5fYYadvB4SPxVVyMXfPrW5iOx7EeWzAYw/EJTMY0fCZrrsIfVEV33wB6KB6C0dFFV/67PLT/G7fgdIzBcapiTR+g2/FxnIFzsBnfxv2qYnNfVbAbbsDvcv8GP8c38n0G5gfUW9jYJ2tVsRWrcD3OjjC/iykB12sVTMSZ+BeexdGJ4rc4DytDcUci6t5u6qoCNivrBXgbd+BqvKisl2aPhqpoNBF1oxH1VliLpzErh8OhKLAvjk7a7ADIVvwxOtgDP8F9YWeKsu5sAng89zTMxt6YgyVRcDtOjkZGY2q/TaynFOdhASaE3bPipjc3N/kvvp8SOgVL8UAigK14oiX/S8NYf691+HGYXRhNrcD09qBs4Ne4K0Jbj0EtNDdC3V/wIua1gOsPCw38HU+mPA/Ex7CslcaN+E8AHBrljlXWbRHV2/l/8IANvyeQNyPy8bgiDFza2gsGYRz+h8fiekNwmbJ+Nml4HcNSETs6sD3PdGC/pPbE/P5ImtiTHVm8M07A4dHDJSnLM3EnvoVH8Sp2wa5hptHL4YNz0OTY9T75PjoBbMGvmgLvwAicjwtjSMvCwuxQfkkEdE3seGgMarCyXqwqNrU4YCeOiKD3jHbWJv/XBuKcpgc0jWhmIlySNIzBMFWxWlnfnFxdiduijzcT0STMUtaLU14Hh8EJqSYJ5CI8FCAzskdXqxOemk2vwFFpPHvhGWyK+jcnFUvi6524Mfa9Drtn7XP4WcxrfHI9T1VsCEP7pXuuaAWwPIuviyMOxTnK+nMRXCc+HZ38Ppt2RFSnYDH+mhJd1pLnQe8aToanulZFG9sAzMqAcQw+mYenRZTrg7hpQEfi8/gIDkr0d0dUG1OuWuy9tSoOzFwxPwPMtm74QkB8Acdhbh7+UUBMzv29bPJQ0jImUf4g3j5BWQ/qozB3wWlhd2EruLZeymh//CICmp68Nik8ORtNSsr+jG9GO6vTbO7H89vGsZ7cT01HHBHtzG5WT1sfI9gF6WAP4iJV8VoLlYeH8rkxk84cMDM2+xLuTRDP4LMp486o/6M4SVX8o/exvGd0mhs1T0OlrMe2GM/T6QcHYLiqeD3rp2aCWptKWZDKuT2j2i3xh1FhbLtjeRe+k0n4tLTna5X136LyR5OOcXgswFYp6zmZpL4cMDOy3yZ8peW8DdsHUBUNZb0mJrICX09uHwi1y1MJxyjrf+apndPhJuLY5Ht5RDc2ztgdRh7s71Tc3HhSxHZY7LUrE85TaeMjQvP4HPYGfokfok6gw3LeWnQ3/WEgLyYjA+D45H9cIt7UMkWPCkvXYem2PvGB34ze22ZHREh34OXY9xfxNcxQFfM/3Fez3sEMSS84IzPfxDjmFFWx8v/1duxdE9StGbNOTwO7K4bU7+sdf8Ogs2aOi08AAAAASUVORK5CYII=")';

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
  const content = <><span className="peppol-symbol" aria-hidden="true"><span style={{ display: 'inline-block', width: 19, height: 19, backgroundColor: 'currentColor', maskImage: peppolMark, WebkitMaskImage: peppolMark, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }}/><Icon size={11}/></span>{!compact && <span>{label}</span>}</>;
  const className = `peppol-status peppol-${state.tone}${compact ? ' compact' : ''}`;
  const title = `${label}. ${tr(state.detail)}`;
  return href
    ? <Link href={href} className={className} title={title} aria-label={title} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>{content}</Link>
    : <span className={className} title={title} aria-label={title}>{content}</span>;
}
