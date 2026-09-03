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
  vatRate: number | null;
  structuredComm: string | null;
  peppolStatus: string | null;
  originalPdf: string | null;
  sentAt: string | null;
  acceptedOn: string | null;
  lockedAt: string | null;
  billingName: string | null;
  billingVat: string | null;
  billingAddress: string | null;
  worksite: { id: string; ref: string; title: string } | null;
  contact: { id: string; name: string; vat: string | null; address: string | null; postalCode: string | null; city: string | null; email: string | null } | null;
  parent: { id: string; kind: string; number: string | null; draftRef: string | null } | null;
  children: { id: string; kind: string; number: string | null; draftRef: string | null; status: string }[];
  lines: DocLine[];
}

export interface Company {
  name: string; address: string; postalCode: string; city: string; vat: string;
  iban: string; email: string; phone: string; website: string;
  quoteTerms: string; invoiceTerms: string;
}
