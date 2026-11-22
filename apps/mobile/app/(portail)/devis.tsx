import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/lib/AppText';
import { EmptyState, ScreenHeader } from '@/lib/ui';
import { T } from '@/lib/theme';
import { PortalScroll, usePortalData } from '@/lib/portal';
import { QuoteCard, type PortalQuote } from '@/lib/portal-quote';

export default function Devis() {
  const st = usePortalData<{ items: PortalQuote[] }>('/api/portal/quotes');
  const [all, setAll] = useState(false);
  const items = st.data?.items ?? [];
  const todo = items.filter((q) => q.status === 'sent');
  const shown = all ? items : todo;
  const forbidden = !!st.error && /limit/i.test(st.error);

  return (
    <PortalScroll state={forbidden ? { ...st, data: {}, error: null } : st}>
      <ScreenHeader eyebrow="Espace client" title="Mes devis" description={forbidden ? undefined : `${todo.length} devis à valider`} />
      {forbidden ? <EmptyState icon="lock" title="Accès limité" description="Votre compte ne permet pas de consulter les devis. Contactez JJD Consult." /> : (<>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['À valider', false], ['Tous', true]] as const).map(([label, v]) => (
            <Pressable key={label} accessibilityRole="button" onPress={() => setAll(v)}
              style={{ paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, backgroundColor: all === v ? T.primary : T.surface, borderWidth: 1, borderColor: T.line }}>
              <Text style={{ color: all === v ? '#fff' : T.ink, fontWeight: '700' }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {shown.length === 0
          ? <EmptyState icon="file-text" title={all ? 'Aucun devis' : 'Aucun devis à valider'} description="Vos devis apparaîtront ici dès qu’ils vous seront envoyés." />
          : shown.map((q) => <QuoteCard key={q.id} q={q} onChanged={st.load} />)}
      </>)}
    </PortalScroll>
  );
}
