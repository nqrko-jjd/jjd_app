import { useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { apiSend } from './api';
import { Text } from './AppText';
import { T } from './theme';

export function ReportMessage({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  async function report(reason: string) {
    setBusy(true);
    try {
      await apiSend('/api/messagerie/moderation/reports', 'POST', { messageId: id, reason }, false);
      Alert.alert('Signalement enregistré', 'La direction peut examiner ce message. Pour un suivi : info@jjd-consult.be.');
    } catch { Alert.alert('Signalement non envoyé', 'Réessayez avec une connexion ou contactez info@jjd-consult.be.'); }
    finally { setBusy(false); }
  }
  return <Pressable disabled={busy} accessibilityRole="button" style={{ paddingVertical: 10 }} onPress={() => Alert.alert('Signaler ce message', 'Le signalement sera accessible à la direction de JJD.', [
    { text: 'Harcèlement ou contenu offensant', onPress: () => { void report('Harcèlement ou contenu offensant'); } },
    { text: 'Contenu illégal ou inapproprié', onPress: () => { void report('Contenu illégal ou inapproprié'); } },
    { text: 'Annuler', style: 'cancel' },
  ])}><Text style={{ fontSize: 12, color: T.ink2 }}>{busy ? 'Envoi du signalement…' : 'Signaler'}</Text></Pressable>;
}
