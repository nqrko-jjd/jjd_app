import { createElement, useMemo, useState } from 'react';
import { View, Pressable, Platform, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { Text } from '@/lib/AppText';
import { openApiFile } from './files';
import { T } from './theme';

export interface MailAttachment { name: string; size: number; type: string; path: string | null; reason?: string | null }

const bytes = (n: number) => (n < 1024 ? `${n} o` : n < 1048576 ? `${Math.round(n / 1024)} Ko` : `${(n / 1048576).toFixed(1)} Mo`);
const fullDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = d.toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const sender = (raw: string | null) => {
  const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec((raw ?? '').trim());
  return m ? { name: m[1]!.trim() || m[2]!, email: m[2]! } : { name: raw ?? 'Expéditeur inconnu', email: '' };
};
const CSS = 'html,body{margin:0}body{padding:6px 2px;font:15px/1.55 -apple-system,Roboto,Segoe UI,Arial,sans-serif;color:#1f2933;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:.6em 0;padding-left:.8em;border-left:3px solid #d5dde5;color:#52606d}a{color:#1a6b4f}';

/** Un mail lisible sur téléphone : en-tête, pièces jointes (ouvertes d'un toucher), corps HTML nettoyé ou texte. */
export function MailView({ subject, from, to, date, html, text, attachments, children }: {
  subject: string | null; from: string | null; to?: string | null; date: string | null; html?: string | null; text?: string | null;
  attachments: MailAttachment[]; children?: React.ReactNode;
}) {
  const s = sender(from);
  const [h, setH] = useState(220);
  const [err, setErr] = useState<string | null>(null);
  const doc = useMemo(() => (html ? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><base target="_blank"><style>${CSS}</style></head><body>${html}<script>function r(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(String(document.body.scrollHeight))}window.onload=r;setTimeout(r,400)</script></body></html>` : null), [html]);

  async function open(a: MailAttachment) {
    if (!a.path) return;
    setErr(null);
    try { await openApiFile(a.path, a.name, a.type); } catch (e) { setErr(`Impossible d’ouvrir « ${a.name} » : ${(e as Error).message}`); }
  }

  return (
    <View style={st.wrap}>
      <View style={st.head}>
        <Text style={st.subject}>{subject?.trim() || '(sans objet)'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={st.avatar}><Text style={{ color: '#fff', fontWeight: '800' }}>{(s.name[0] ?? '?').toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: T.ink, fontWeight: '700' }} numberOfLines={1}>{s.name}</Text>
            {!!s.email && s.email !== s.name && <Text style={st.meta} numberOfLines={1}>{s.email}</Text>}
            {!!to && <Text style={st.meta} numberOfLines={1}>À : {to}</Text>}
            <Text style={st.meta}>{fullDate(date)}</Text>
          </View>
        </View>
      </View>

      {attachments.length > 0 && (
        <View style={st.atts}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Feather name="paperclip" size={14} color={T.ink2} /><Text style={st.attTitle}>{attachments.length} pièce{attachments.length > 1 ? 's' : ''} jointe{attachments.length > 1 ? 's' : ''}</Text></View>
          {attachments.map((a, i) => (
            <Pressable key={i} accessibilityRole="button" disabled={!a.path} onPress={() => open(a)} style={({ pressed }) => [st.att, !a.path && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}>
              <View style={st.attIc}><Feather name={/^image\//.test(a.type) ? 'image' : 'file-text'} size={18} color={T.primary} /></View>
              <View style={{ flex: 1 }}><Text style={{ color: T.ink, fontWeight: '700' }} numberOfLines={1}>{a.name}</Text><Text style={st.meta}>{a.path ? bytes(a.size) : a.reason ?? 'non conservée'}</Text></View>
              {!!a.path && <Feather name="download" size={18} color={T.ink3} />}
            </Pressable>
          ))}
          {err && <Text style={{ color: T.crit, fontWeight: '600' }}>{err}</Text>}
        </View>
      )}

      <View style={st.body}>
        {doc ? (
          Platform.OS === 'web'
            ? createElement('iframe', { srcDoc: doc.replace(/<script>[\s\S]*<\/script>/, ''), sandbox: 'allow-popups', style: { border: 0, width: '100%', height: 420, background: '#fff' } })
            : <WebView originWhitelist={['*']} source={{ html: doc }} style={{ height: h, backgroundColor: '#fff' }} scrollEnabled={false} javaScriptEnabled onMessage={(e) => { const n = Number(e.nativeEvent.data); if (n > 0) setH(Math.max(120, n + 16)); }} />
        ) : (
          <Text style={st.text}>{text?.trim() || 'Ce mail n’a pas de texte.'}</Text>
        )}
      </View>
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.line, overflow: 'hidden' },
  head: { padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  subject: { fontSize: 18, fontWeight: '800', color: T.ink, lineHeight: 24 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2f6f5a', alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 12.5, color: T.ink2 },
  atts: { padding: 14, gap: 8, backgroundColor: T.surface2, borderBottomWidth: 1, borderBottomColor: T.line },
  attTitle: { fontSize: 12, fontWeight: '800', color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  att: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.line, padding: 10 },
  attIc: { width: 36, height: 36, borderRadius: 10, backgroundColor: T.primarySoft, alignItems: 'center', justifyContent: 'center' },
  body: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8 },
  text: { fontSize: 15, lineHeight: 23, color: '#1f2933', padding: 4 },
});
