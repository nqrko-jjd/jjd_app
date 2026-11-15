/**
 * Facture d'achat en XML UBL 2.1 (Peppol BIS Billing 3.0) pour l'export Fox — comme les fichiers que le comptable
 * recevait quand les factures passaient par Peppol : fournisseur (nom, TVA), JJD comme client, n°, dates, totaux
 * par taux de TVA, et le PDF original joint dans le XML. Pure : testée dans ubl-purchase.test.ts.
 * (Une facture reçue par Peppol garde, elle, son XML d'origine.)
 */
export interface UblParty { name: string; vat: string | null; street?: string | null; postalCode?: string | null; city?: string | null }
export interface UblPurchase {
  kind: 'invoice' | 'credit_note';
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  supplier: UblParty;
  customer: UblParty;
  ht: number; // positif
  vatRate: number; // 0.21, 0.06, 0
  vat: number; // positif
  description: string;
  pdf: { filename: string; bytes: Uint8Array } | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const d = (x: Date) => x.toISOString().slice(0, 10);
export const cleanVat = (v: string | null | undefined) => (v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase() || null;

function party(tag: 'AccountingSupplierParty' | 'AccountingCustomerParty', p: UblParty) {
  const vat = cleanVat(p.vat);
  const country = vat?.slice(0, 2).match(/^[A-Z]{2}$/) ? vat.slice(0, 2) : 'BE';
  const endpoint = vat && country === 'BE' ? `<cbc:EndpointID schemeID="0208">${esc(vat.slice(2))}</cbc:EndpointID>` : vat ? `<cbc:EndpointID schemeID="9925">${esc(vat)}</cbc:EndpointID>` : '';
  return `<cac:${tag}><cac:Party>${endpoint}
      <cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>${p.street ? `<cbc:StreetName>${esc(p.street)}</cbc:StreetName>` : ''}${p.city ? `<cbc:CityName>${esc(p.city)}</cbc:CityName>` : ''}${p.postalCode ? `<cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>` : ''}<cac:Country><cbc:IdentificationCode>${country}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      ${vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>${vat && country === 'BE' ? `<cbc:CompanyID schemeID="0208">${esc(vat.slice(2))}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>
    </cac:Party></cac:${tag}>`;
}

export function buildPurchaseUbl(u: UblPurchase): string {
  const credit = u.kind === 'credit_note';
  const root = credit ? 'CreditNote' : 'Invoice';
  const ns = credit ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2' : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  const pct = Math.round(u.vatRate * 10000) / 100;
  const cat = pct > 0 ? 'S' : 'Z';
  const ttc = u.ht + u.vat;
  const attachment = u.pdf
    ? `<cac:AdditionalDocumentReference><cbc:ID>${esc(u.number)}</cbc:ID><cbc:DocumentDescription>Facture originale (PDF)</cbc:DocumentDescription><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="${esc(u.pdf.filename)}">${Buffer.from(u.pdf.bytes).toString('base64')}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`
    : '';
  const line = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const qty = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(u.number)}</cbc:ID>
  <cbc:IssueDate>${d(u.issueDate)}</cbc:IssueDate>
  ${!credit && u.dueDate ? `<cbc:DueDate>${d(u.dueDate)}</cbc:DueDate>` : ''}
  <cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${credit ? '381' : '380'}</cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  ${attachment}
  ${party('AccountingSupplierParty', u.supplier)}
  ${party('AccountingCustomerParty', u.customer)}
  ${credit && u.dueDate ? '' : !credit && u.dueDate ? `<cac:PaymentTerms><cbc:Note>Échéance ${d(u.dueDate)}</cbc:Note></cac:PaymentTerms>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${amt(u.vat)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${amt(u.ht)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${amt(u.vat)}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${pct}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(u.ht)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${amt(u.ht)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${amt(ttc)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${amt(ttc)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:${line}>
    <cbc:ID>1</cbc:ID>
    <cbc:${qty} unitCode="C62">1</cbc:${qty}>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(u.ht)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${esc(u.description.slice(0, 200))}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${pct}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${amt(u.ht)}</cbc:PriceAmount></cac:Price>
  </cac:${line}>
</${root}>
`;
}

/** Montants d'une écriture d'achat : HT, TVA et taux, cohérents entre eux (HT + TVA = TTC). */
export function purchaseAmounts(e: { ht: number; ttc: number | null; vatRate: number | null }): { ht: number; vat: number; rate: number } {
  const ht = Math.abs(e.ht);
  const ttc = e.ttc != null ? Math.abs(e.ttc) : null;
  let vat = ttc != null ? Math.round((ttc - ht) * 100) / 100 : Math.round(ht * (e.vatRate ?? 0.21) * 100) / 100;
  if (vat < 0) vat = 0;
  const rate = e.vatRate ?? (ht > 0 ? [0.21, 0.12, 0.06, 0].reduce((best, r) => (Math.abs(ht * r - vat) < Math.abs(ht * best - vat) ? r : best), 0.21) : 0.21);
  return { ht, vat, rate };
}
