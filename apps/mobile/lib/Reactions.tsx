import { useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { Text } from './AppText';
import { T } from './theme';

export interface Reaction { emoji: string; count: number; mine: boolean }
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Pastilles d'émojis sous un message ; un appui ajoute ou retire sa propre réaction. */
export function ReactionChips({ reactions, onToggle, mine }: { reactions?: Reaction[]; onToggle: (emoji: string) => void; mine?: boolean }) {
  if (!reactions?.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      {reactions.map((r) => (
        <Pressable
          key={r.emoji}
          accessibilityRole="button"
          onPress={() => onToggle(r.emoji)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: r.mine ? T.primary : T.line, backgroundColor: r.mine ? T.primarySoft : T.surface }}
        >
          <Text style={{ fontSize: 14 }}>{r.emoji}</Text>
          <Text style={{ fontSize: 12, fontWeight: '700', color: r.mine ? T.primary : T.ink2 }}>{r.count}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Choix d'une réaction (appui long sur un message). « Autre » : l'émoji se tape au clavier du téléphone. */
export function ReactionPicker({ visible, onPick, onClose }: { visible: boolean; onPick: (emoji: string) => void; onClose: () => void }) {
  const [other, setOther] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 }} onPress={onClose}>
        <Pressable style={{ backgroundColor: T.surface, borderRadius: 18, padding: 16, gap: 12 }} onPress={() => {}}>
          <Text style={{ fontWeight: '800', color: T.ink, fontSize: 15 }}>Réagir au message</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {QUICK.map((e) => (
              <Pressable key={e} accessibilityRole="button" onPress={() => { setOther(''); onPick(e); }} style={{ padding: 8 }}>
                <Text style={{ fontSize: 30 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={other}
              onChangeText={(t) => setOther(t.slice(-4))}
              placeholder="Autre émoji (clavier)"
              placeholderTextColor={T.ink3}
              style={{ flex: 1, backgroundColor: T.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: T.ink }}
            />
            <Pressable accessibilityRole="button" disabled={!other.trim()} onPress={() => { const e = other.trim(); setOther(''); onPick(e); }} style={{ backgroundColor: T.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, opacity: other.trim() ? 1 : 0.4 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Envoyer</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
