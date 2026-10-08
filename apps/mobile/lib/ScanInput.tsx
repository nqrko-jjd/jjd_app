import { useRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { Text } from '@/lib/AppText';
import { T } from './theme';

/**
 * Saisie d'un code : caméra du téléphone (EAN, Code 128, QR…) OU champ texte toujours prêt — c'est ainsi que
 * répondent les lecteurs Zebra / douchettes Bluetooth (ils « tapent » le code puis Entrée).
 */
export function ScanInput({ onCode, placeholder = 'Scanner ou saisir un code', startOpen = false }: { onCode: (code: string) => void; placeholder?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [perm, ask] = useCameraPermissions();
  const [text, setText] = useState('');
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const emit = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (last.current.code === code && now - last.current.at < 1800) return; // la caméra relit le même code plusieurs fois
    last.current = { code, at: now };
    onCode(code);
  };

  return (
    <View style={{ gap: 10 }}>
      {open && (
        perm?.granted ? (
          <View style={s.camWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'qr', 'upc_a', 'upc_e', 'itf14'] }}
              onBarcodeScanned={({ data }) => emit(data)}
            />
            <View pointerEvents="none" style={s.aim} />
          </View>
        ) : (
          <View style={s.perm}>
            <Feather name="camera-off" size={22} color={T.ink2} />
            <Text style={{ color: T.ink2, textAlign: 'center' }}>L’appareil photo est nécessaire pour scanner.</Text>
            <Pressable accessibilityRole="button" onPress={() => ask()} style={s.permBtn}><Text style={{ color: '#fff', fontWeight: '700' }}>Autoriser la caméra</Text></Pressable>
          </View>
        )
      )}
      <View style={s.row}>
        <View style={s.field}>
          <Feather name="maximize" size={18} color={T.ink2} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => { emit(text); setText(''); }}
            placeholder={placeholder}
            placeholderTextColor={T.ink3}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            style={s.input}
          />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Fermer la caméra' : 'Ouvrir la caméra'} onPress={() => setOpen((o) => !o)} style={[s.camBtn, open && { backgroundColor: T.primary }]}>
          <Feather name="camera" size={22} color={open ? '#fff' : T.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  camWrap: { height: 230, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  aim: { position: 'absolute', left: '12%', right: '12%', top: '28%', bottom: '28%', borderWidth: 3, borderColor: T.gold, borderRadius: 16 },
  perm: { borderRadius: 20, backgroundColor: T.surface2, padding: 22, alignItems: 'center', gap: 10 },
  permBtn: { backgroundColor: T.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  row: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 16, paddingHorizontal: 14, minHeight: 54 },
  input: { flex: 1, fontSize: 16, color: T.ink, paddingVertical: 12 },
  camBtn: { width: 54, minHeight: 54, borderRadius: 16, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
