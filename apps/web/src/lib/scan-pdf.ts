/** Assemble des pages JPEG en un PDF (une image par page, aucune dépendance). `w`/`h` en pixels ; la page est dimensionnée à 150 dpi. */
export function jpegsToPdf(pages: { data: Uint8Array; w: number; h: number }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
  const obj = (n: number, fn: () => void) => { offsets[n] = len; push(`${n} 0 obj\n`); fn(); push('\nendobj\n'); };
  const n = pages.length;
  push('%PDF-1.4\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`));
  pages.forEach((p, i) => {
    const wpt = ((p.w * 72) / 150).toFixed(2);
    const hpt = ((p.h * 72) / 150).toFixed(2);
    const content = `q ${wpt} 0 0 ${hpt} 0 0 cm /Im0 Do Q`;
    obj(3 + 3 * i, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wpt} ${hpt}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`));
    obj(4 + 3 * i, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(5 + 3 * i, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.data.length} >>\nstream\n`);
      push(p.data);
      push('\nendstream');
    });
  });
  const size = 3 + 3 * n;
  const xref = len;
  push(`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1, size).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
