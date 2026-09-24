export const ORDER_STATUS_LABEL: Record<string, string> = {
  to_prepare: 'À préparer', preparing: 'En préparation', prepared: 'Prête', cancelled: 'Annulée',
};
export const ORDER_STATUS_TONE: Record<string, string> = {
  to_prepare: 'warn', preparing: 'primary', prepared: 'ok', cancelled: 'plain',
};

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', ordered: 'Commandée', partial: 'Partiellement reçue', received: 'Reçue', cancelled: 'Annulée',
};
export const PO_STATUS_TONE: Record<string, string> = {
  draft: 'plain', ordered: 'warn', partial: 'primary', received: 'ok', cancelled: 'plain',
};
