/**
 * PDF d'origine du fournisseur, joint À L'INTÉRIEUR du XML Peppol (UBL : AdditionalDocumentReference → Attachment →
 * EmbeddedDocumentBinaryObject mimeCode="application/pdf", en base64). C'est lui qui porte les remarques, conditions et
 * mentions du fournisseur ; la mise en page générée par le prestataire Peppol ne montre que les données structurées.
 * Plusieurs PDF joints : on préfère celui dont le nom évoque la facture (pas des conditions générales).
 */
export function extractEmbeddedPdf(xml:string):Buffer|null {
  const found:{name:string;bytes:Buffer}[]=[];
  const re=/<(?:[\w-]+:)?EmbeddedDocumentBinaryObject\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?EmbeddedDocumentBinaryObject>/g;
  for(let m;(m=re.exec(xml));) {
    const attrs=m[1]??'';
    const mime=/mimeCode\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]??'';
    const name=/filename\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]??'';
    if(!/pdf/i.test(mime) && !/\.pdf$/i.test(name)) continue;
    const b64=(m[2]??'').replace(/\s+/g,'');
    if(b64.length<100 || b64.length>40*1024*1024) continue;
    const bytes=Buffer.from(b64,'base64');
    if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) continue;
    found.push({name,bytes});
  }
  if(!found.length) return null;
  const notTerms=found.filter(f=>!/(cgv|conditions|voorwaarden|terms|agb)/i.test(f.name));
  return (notTerms[0]??found[0])!.bytes;
}
