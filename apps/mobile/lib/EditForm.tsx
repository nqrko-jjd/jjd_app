import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { apiSend } from './api';
import { useSession } from './session';
import { Text } from './AppText';
import { Alert } from './i18n';
import { T } from './theme';

export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'multiline' | 'number' | 'date' | 'select' | 'bool' | 'phone' | 'email';
  options?: { value: string; label: string }[];
  /** Champ obligatoire côté serveur : jamais envoyé vide. */
  required?: boolean;
};
export type Section = { title: string; fields: Field[] };

const EDITORS = ['admin', 'office'];

const toForm = (v: unknown, f: Field): string | boolean => {
  if (f.type === 'bool') return !!v;
  if (v == null) return '';
  if (f.type === 'date') return String(v).slice(0, 10);
  return String(v);
};

/** Bouton « Modifier » + formulaire plein écran. Réservé au bureau (admin, office) — comme sur le PC. N'envoie que les champs changés. */
export function EditButton({ title, sections, values, path, onSaved }: {
  title: string; sections: Section[]; values: Record<string, unknown>; path: string; onSaved: () => void;
}) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  if (!user || !EDITORS.includes(user.role)) return null;
  const all = sections.flatMap((s) => s.fields);

  function show() {
    setForm(Object.fromEntries(all.map((f) => [f.key, toForm(values[f.key], f)])));
    setOpen(true);
  }
  async function save() {
    const body: Record<string, unknown> = {};
    for (const f of all) {
      const now = form[f.key];
      if (now === toForm(values[f.key], f)) continue;
      if (f.type === 'bool') body[f.key] = !!now;
      else if (now === '' || now == null) {
        if (f.required) { Alert.alert('Champ obligatoire', `« ${f.label} » ne peut pas être vide.`); return; }
        body[f.key] = null;
      } else if (f.type === 'number') {
        const n = Number(String(now).replace(',', '.'));
        if (Number.isNaN(n)) { Alert.alert('Nombre invalide', `« ${f.label} » doit être un nombre.`); return; }
        body[f.key] = n;
      } else if (f.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(now))) { Alert.alert('Date invalide', `« ${f.label} » : écrivez la date ainsi 2026-12-31.`); return; }
        body[f.key] = now;
      } else body[f.key] = String(now).trim();
    }
    if (!Object.keys(body).length) { setOpen(false); return; }
    setBusy(true);
    try {
      await apiSend(path, 'PATCH', body, false);
      setOpen(false);
      onSaved();
    } catch (e) {
      Alert.alert('Enregistrement impossible', e instanceof Error ? e.message : 'Vérifiez votre connexion.');
    }
    setBusy(false);
  }

  return (
    <>
      <Pressable accessibilityRole="button" onPress={show} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: T.primary }}>
        <Feather name="edit-2" size={16} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '800' }}>Modifier la fiche</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 54, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line }}>
            <Pressable onPress={() => setOpen(false)} hitSlop={10}><Text style={{ color: T.ink2, fontWeight: '700' }}>Annuler</Text></Pressable>
            <Text style={{ fontWeight: '800', color: T.ink, fontSize: 16 }}>{title}</Text>
            <Pressable onPress={save} disabled={busy} hitSlop={10}>
              {busy ? <ActivityIndicator /> : <Text style={{ color: T.primary, fontWeight: '800' }}>Enregistrer</Text>}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            {sections.map((sec) => (
              <View key={sec.title} style={{ gap: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: T.ink2, marginTop: 6 }}>{sec.title}</Text>
                {sec.fields.map((f) => (
                  <View key={f.key} style={{ gap: 4 }}>
                    <Text style={{ color: T.ink2, fontSize: 12.5, fontWeight: '600' }}>{f.label}{f.required ? ' *' : ''}</Text>
                    {f.type === 'bool' ? (
                      <Switch value={!!form[f.key]} onValueChange={(v) => setForm({ ...form, [f.key]: v })} trackColor={{ true: T.primary }} style={{ alignSelf: 'flex-start' }} />
                    ) : f.type === 'select' ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {!f.required && (
                          <Chip on={form[f.key] === ''} label="—" onPress={() => setForm({ ...form, [f.key]: '' })} />
                        )}
                        {(f.options ?? []).map((o) => (
                          <Chip key={o.value} on={form[f.key] === o.value} label={o.label} onPress={() => setForm({ ...form, [f.key]: o.value })} />
                        ))}
                      </View>
                    ) : (
                      <TextInput
                        value={String(form[f.key] ?? '')}
                        onChangeText={(t) => setForm({ ...form, [f.key]: t })}
                        multiline={f.type === 'multiline'}
                        keyboardType={f.type === 'number' ? 'decimal-pad' : f.type === 'phone' ? 'phone-pad' : f.type === 'email' ? 'email-address' : 'default'}
                        autoCapitalize={f.type === 'email' ? 'none' : 'sentences'}
                        placeholder={f.type === 'date' ? 'AAAA-MM-JJ' : undefined}
                        placeholderTextColor={T.ink3}
                        style={{ backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: T.ink, minHeight: f.type === 'multiline' ? 90 : undefined, textAlignVertical: f.type === 'multiline' ? 'top' : 'center' }}
                      />
                    )}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.primarySoft : T.surface }}>
      <Text style={{ color: on ? T.primary : T.ink, fontWeight: on ? '800' : '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
