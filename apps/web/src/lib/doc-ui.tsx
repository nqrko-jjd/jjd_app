import { DOC_KIND_LABEL, DOC_STATUS_LABEL } from '@jjd/shared';

export { DOC_KIND_LABEL, DOC_STATUS_LABEL };

const STATUS_TONE: Record<string, string> = {
  draft: 'plain',
  sent: 'primary',
  accepted: 'ok',
  paid: 'ok',
  declined: 'crit',
  overdue: 'crit',
  expired: 'warn',
  partial: 'warn',
  credited: 'warn',
};

export function DocStatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? 'plain'}`}>{DOC_STATUS_LABEL[status] ?? status}</span>;
}

export interface DocLine {
  id?: string;
  kind: 'item' | 'section' | 'text';
  label: string;
  description?: string | null;
  qty: number;
  unit?: string | null;
  unitPriceHt: number;
  discountPct: number;
  vatRate: number;
  totalHt?: number;
  priceItemId?: string | null;
  optional?: boolean;
  costHt?: number | null;
}

export interface DocFull {
  id: string;
  kind: string;
  number: string | null;
  draftRef: string | null;
  status: string;
  source: string | null;
  title: string | null;
  intro: string | null;
  terms: string | null;
  note: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  validUntil: string | null;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  paidAmount: number;
  paidOn: string | null;
  hasBankMatch: boolean;
  payments?: { matchId: string; txId: string; date: string | null; amount: number; bank: string | null; counterparty: string | null }[];
  vatRate: number | null;
  structuredComm: string | null;
  peppolStatus: string | null;
  peppolId?: string | null;
  originalPdf: string | null;
  sentAt: string | null;
  acceptedOn: string | null;
  lockedAt: string | null;
  billingName: string | null;
  billingVat: string | null;
  billingAddress: string | null;
  /** adresse réellement imprimée : celle du document, sinon « c/o syndic + adresse » ou l'adresse du client (calculée par l'API) */
  billingAddressEffective?: string | null;
  billingEmail: string | null;
  customerRef: string | null;
  poNumber?: string | null;
  worksite: { id: string; ref: string; title: string } | null;
  contact: { id: string; name: string; kind?: string | null; vat: string | null; address: string | null; box: string | null; postalCode: string | null; city: string | null; email: string | null } | null;
  parent: { id: string; kind: string; number: string | null; draftRef: string | null; status?: string; totalTtc?: number; issuedOn?: string | null } | null;
  children: { id: string; kind: string; number: string | null; draftRef: string | null; status: string; totalTtc?: number; issuedOn?: string | null; lockedAt?: string | null }[];
  lines: DocLine[];
  depositPlan?: { id?: string; kind: 'pct' | 'amount'; value: number; trigger: string; label?: string | null; invoiceId?: string | null }[] | null;
  retentionPct?: number | null;
  eSignature?: { signerName: string | null; signedAt: string; pdfHash: string };
  margin?: { revenueHt: number; costHt: number; marginHt: number; marginPct: number | null; coverage: number; costedLines: number; itemLines: number };
  billing?: { totalHt: number; billedHt: number; remainingHt: number; billedPct: number; invoices: { id: string; number: string | null; draftRef: string | null; kind: string; status: string; netHt: number }[]; plan?: { id: string; kind: 'pct' | 'amount'; value: number; trigger: string; label: string | null; amountHt: number; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null }[] };
}

export interface Company {
  name: string; address: string; postalCode: string; city: string; vat: string;
  iban: string; bankDetails?: string; email: string; phone: string; website: string;
  quoteTerms: string; invoiceTerms: string;
  vatNote6: string; vatNote0: string;
}

/** Adresse en lignes, comme sur le PDF (voir addressLines côté API, lib/pdf.ts) : « c/o Syndic » / rue / code postal + ville. */
export function addressLines(raw: string | null | undefined): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  if (/\r?\n/.test(text)) return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const co = /^(c\/o\s[^,]+),\s*(.+)$/i.exec(text);
  const head = co ? [co[1]!.trim()] : [];
  const rest = co ? co[2]!.trim() : text;
  const m = /^(.*?)\s*[,\-–]?\s*(\d{4,5}\s+[^,]+?)\s*$/.exec(rest);
  if (m && m[1]!.trim()) return [...head, m[1]!.trim(), m[2]!.trim()];
  return [...head, ...rest.split(',').map((x) => x.trim()).filter(Boolean)];
}

/** Une ACP n'est pas assujettie à la TVA : son numéro est un numéro d'entreprise (BCE), pas un n° de TVA. */
export function clientIdLabel(kind: string | null | undefined): string {
  return kind === 'acp' ? 'N° BCE' : 'TVA';
}
