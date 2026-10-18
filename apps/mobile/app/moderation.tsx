import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Text } from '@/lib/AppText';
import { apiGet, apiSend } from '@/lib/api';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';

type Report = { id: string; at: string; meta: { reason?: string; body?: string; authorId?: string; authorName?: string } };
export default function Moderation() {
  const { user } = useSession();
  const [items, setItems] = useState<Report[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setItems((await apiGet<{items: Report[]}>('/api/messagerie/moderation/reports')).items); setError(''); }
    catch { setError('Impossible de charger les signalements.'); }
  }, []);
  useFocusEffect(useCallback(() => { if (user?.role === 'admin') void load(); }, [load, user?.role]));
  async function resolve(id: string, remove: boolean) {
    setBusy(true);
    try { await apiSend(`/api/messagerie/moderation/reports/${id}/resolve`, 'POST', { remove }, false); await load(); }
    catch { Alert.alert('Action non enregistrée', 'Vérifiez votre connexion.'); }
    finally { setBusy(false); }
  }
  async function block(authorId: string) {
    setBusy(true);
    try { await apiSend(`/api/users/${authorId}`, 'PATCH', { active: false }, false); Alert.alert('Compte désactivé', 'Cet utilisateur ne peut plus accéder au service.'); }
    catch { Alert.alert('Désactivation impossible', 'Vérifiez la connexion et les droits du compte.'); }
    finally { setBusy(false); }
  }
  if (user?.role !== 'admin' || user.entityScope) return <Text>Accès réservé à la direction.</Text>;
  return <ScrollView contentContainerStyle={{padding:20,gap:20}} style={{backgroundColor:T.paper}}>
    <Stack.Screen options={{title:'Signalements'}} />
    <Text>Examinez les signalements rapidement. Un compte abusif peut être désactivé dans la gestion des utilisateurs sur le site.</Text>
    {!!error && <Text>{error}</Text>}
    {!error && !items.length && <Text>Aucun signalement en attente.</Text>}
    {items.map(r=><View key={r.id} style={{backgroundColor:T.surface,padding:16,borderRadius:12,gap:10}}>
      <Text>{r.meta.authorName || 'Auteur'} · {new Date(r.at).toLocaleDateString('fr-BE')}</Text>
      <Text>{r.meta.reason}</Text><Text>{r.meta.body || 'Pièce jointe ou note vocale signalée.'}</Text>
      {r.meta.authorId && r.meta.authorId !== user.id && <Pressable disabled={busy} onPress={()=>Alert.alert('Désactiver ce compte ?', 'Cet utilisateur perdra son accès à JJD. La direction pourra le réactiver sur le site.', [{text:'Annuler',style:'cancel'},{text:'Désactiver',style:'destructive',onPress:()=>{void block(r.meta.authorId!);}}])}><Text style={{color:T.crit,paddingVertical:12}}>Désactiver le compte de l’auteur</Text></Pressable>}
      <Pressable disabled={busy} onPress={()=>Alert.alert('Retirer le message ?', 'Son contenu sera masqué dans la conversation.', [{text:'Annuler',style:'cancel'},{text:'Retirer',style:'destructive',onPress:()=>{void resolve(r.id,true);}}])}><Text style={{color:T.crit,paddingVertical:12}}>Retirer le message</Text></Pressable>
      <Pressable disabled={busy} onPress={()=>{void resolve(r.id,false);}}><Text style={{paddingVertical:12}}>Classer sans retrait</Text></Pressable>
    </View>)}
  </ScrollView>;
}
