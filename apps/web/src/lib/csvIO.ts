import { apiBlobUrl, apiUpload } from './api';

/** Déclenche le téléchargement d'un export CSV (ex. `/api/finance/expenses/export.csv?...`). */
export async function downloadCsv(path: string, filename: string) {
  const url = await apiBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

export interface ImportResult {
  created: number;
  updated: number;
  warnings: { row: number; message: string }[];
}

/** Ouvre un sélecteur de fichier (.csv/.xlsx) et l'envoie à la route d'import donnée. */
export function pickAndImportCsv(path: string, onDone: (result: ImportResult) => void, onError: (message: string) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.xlsx,.tsv';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const result = await apiUpload<ImportResult>(path, form);
      onDone(result);
    } catch (e) {
      onError((e as Error).message ?? 'Échec de l’import');
    }
  };
  input.click();
}

/** Résumé lisible d'un import (à afficher dans une alerte). */
export function summarizeImport(r: ImportResult): string {
  const lines = [`${r.created} créée(s), ${r.updated} mise(s) à jour.`];
  if (r.warnings.length) {
    lines.push('', `${r.warnings.length} avertissement(s) :`);
    for (const w of r.warnings.slice(0, 20)) lines.push(`ligne ${w.row} : ${w.message}`);
    if (r.warnings.length > 20) lines.push(`… et ${r.warnings.length - 20} de plus.`);
  }
  return lines.join('\n');
}
