import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { API_URL, getToken } from './api';

const safe = (n: string) => n.replace(/[^\w.\- ()éèàùçêâîôû]/gi, '_').slice(0, 80) || 'fichier';

/**
 * Ouvre un fichier protégé de l'API (PDF d'un devis, pièce jointe d'un mail…) : téléchargé avec la session, puis ouvert dans la feuille
 * de partage du téléphone (visionneuse PDF, Drive, WhatsApp…). Dans le navigateur (simulateur) : nouvel onglet ou téléchargement.
 */
export async function openApiFile(path: string, filename: string, mime = 'application/pdf'): Promise<void> {
  const token = await getToken();
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (Platform.OS === 'web') {
    const res = await fetch(`${API_URL}${path}`, { headers });
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.download = filename; a.click();
    return;
  }
  const out = await File.downloadFileAsync(`${API_URL}${path}`, new File(Paths.cache, safe(filename)), { headers, idempotent: true });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Aucune application pour ouvrir ce fichier.');
  await Sharing.shareAsync(out.uri, { mimeType: mime, dialogTitle: filename });
}
