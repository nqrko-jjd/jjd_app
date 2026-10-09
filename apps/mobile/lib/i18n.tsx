import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert as RNAlert, type AlertButton, type AlertOptions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DICT } from './dict';
import { TPL } from './dict-tpl';
import { apiSend } from './api';

export type Locale = 'fr' | 'en' | 'pt-BR';
export const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
];
const KEY = 'locale';
const UNSENT = 'localeUnsent';
let current: Locale = 'fr';
export const getLocale = () => current;
export const isLocale = (v: unknown): v is Locale => v === 'fr' || v === 'en' || v === 'pt-BR';

/** Langue des dates (jours, mois) selon la langue choisie. */
export const dateLocale = () => (current === 'en' ? 'en-GB' : current === 'pt-BR' ? 'pt-BR' : 'fr-BE');

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Gabarits à trous ("{0} à traiter") : transformés une fois en expressions régulières. */
const PATTERNS = Object.entries(TPL).map(([k, v]) => ({
  re: new RegExp('^' + k.split(/(\{\d+\})/).map((part) => (/^\{\d+\}$/.test(part) ? '([\\s\\S]*?)' : esc(part))).join('') + '$'),
  slots: [...k.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])),
  v,
}));

/** Traduit un texte français de l'appli dans la langue choisie ; inchangé s'il n'a pas de traduction. */
export function tr(s: string): string {
  if (current === 'fr' || !s) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if (!m || !m[2]) return s;
  const core = m[2];
  const hit = DICT[core] ?? DICT[core.replace(/\s+/g, ' ')];
  if (hit) return m[1] + hit[current === 'en' ? 0 : 1] + m[3];
  for (const p of PATTERNS) {
    const r = p.re.exec(core);
    if (!r) continue;
    const vals: Record<number, string> = {};
    p.slots.forEach((n, i) => { vals[n] = r[i + 1] ?? ''; });
    const out = p.v[current === 'en' ? 0 : 1].replace(/\{(\d+)(?::([^|}]*)\|([^}]*))?\}/g, (_x, n, a, b) => (a !== undefined ? (vals[Number(n)] ? b : a) : tr(vals[Number(n)] ?? '')));
    return m[1] + out + m[3];
  }
  return s;
}

/** Comme Alert.alert, mais titre, message et boutons sont traduits. */
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    RNAlert.alert(tr(title), message ? tr(message) : message, buttons?.map((b) => ({ ...b, text: b.text ? tr(b.text) : b.text })), options);
  },
};

interface Ctx { locale: Locale; setLocale: (l: Locale) => Promise<void>; applyServerLocale: (l: string | null | undefined) => void }
const LocaleContext = createContext<Ctx>({ locale: 'fr', setLocale: async () => {}, applyServerLocale: () => {} });
export const useLocale = () => useContext(LocaleContext);

/** Change la langue : tout l'écran est redessiné (clé = langue) et le choix est gardé dans le compte. */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, set] = useState<Locale>('fr');
  const unsent = useRef(false); // langue choisie avant la connexion : à enregistrer dans le compte dès qu'il est connu
  const apply = (l: Locale) => { current = l; set(l); AsyncStorage.setItem(KEY, l).catch(() => {}); };
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => { if (isLocale(v)) { current = v; set(v); } }).catch(() => {});
    AsyncStorage.getItem(UNSENT).then((v) => { if (v === '1') unsent.current = true; }).catch(() => {});
  }, []);
  const value: Ctx = {
    locale,
    // le serveur d'abord : sinon le rechargement du profil (qui suit le changement d'écran) ramènerait l'ancienne langue
    setLocale: async (l) => {
      unsent.current = false;
      await apiSend('/api/auth/locale', 'PATCH', { locale: l }, false).catch(() => { unsent.current = true; });
      AsyncStorage.setItem(UNSENT, unsent.current ? '1' : '0').catch(() => {});
      apply(l);
    },
    applyServerLocale: (l) => {
      if (unsent.current && l) {
        apiSend('/api/auth/locale', 'PATCH', { locale: current }, false).then(() => { unsent.current = false; AsyncStorage.setItem(UNSENT, '0').catch(() => {}); }).catch(() => {});
        return;
      }
      if (isLocale(l) && l !== current) apply(l);
    },
  };
  return <LocaleContext.Provider value={value}><Fragment key={locale}>{children}</Fragment></LocaleContext.Provider>;
}
