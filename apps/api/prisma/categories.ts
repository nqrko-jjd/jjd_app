/** Catégories comptables JJD, tirées des onglets Facture / Dashboard Général / légende. */
export const CATEGORY_SEED: { code: string; label: string; kind: string; entity?: string }[] = [
  // Revenus
  { code: 'ca_jjd', label: "Chiffre d'affaire - JJD", kind: 'revenue', entity: 'jjd' },
  { code: 'ca_tonton', label: "Chiffre d'affaire - Tonton", kind: 'revenue', entity: 'tonton' },
  { code: 'ca_m7', label: "Chiffre d'affaire - M7", kind: 'revenue', entity: 'm7' },
  { code: 'nc_vente', label: 'Note de crédit vente', kind: 'credit_note' },

  // Dépenses chantier
  { code: 'materiel', label: 'Matériel', kind: 'expense' },
  { code: 'materiel_tonton', label: 'Matériel - Tonton', kind: 'expense', entity: 'tonton' },
  { code: 'sous_traitance', label: 'Sous-traitance', kind: 'expense' },
  { code: 'location_materiel', label: 'Location Matériel', kind: 'expense' },
  { code: 'container', label: 'Container/Décheterie', kind: 'expense' },

  // Véhicules
  { code: 'carburant', label: 'Carburant', kind: 'expense' },
  { code: 'charges_vehicules', label: 'Charges véhicules', kind: 'expense' },
  { code: 'assurances_auto', label: 'Assurances Auto', kind: 'expense' },
  { code: 'achat_vehicule', label: 'Achat Véhicule', kind: 'expense' },
  { code: 'credit_auto', label: 'Crédit auto', kind: 'expense' },

  // Charges fixes
  { code: 'charges', label: 'Charges', kind: 'expense' },
  { code: 'loyer', label: 'Loyer', kind: 'expense' },
  { code: 'garantie_locative', label: 'Garantie Locative', kind: 'expense' },

  // Rémunérations
  { code: 'rem_ouvrier', label: 'Rémunération - Ouvrier', kind: 'salary' },
  { code: 'rem_tonton', label: 'Rémunération - Tonton', kind: 'salary', entity: 'tonton' },
  { code: 'rem_m7', label: 'Rémunération - M7', kind: 'salary', entity: 'm7' },
  { code: 'rem_julien', label: 'Rémunération - Julien', kind: 'salary', entity: 'jjd' },

  // Fiscal
  { code: 'tva', label: 'TVA', kind: 'vat' },
  { code: 'impot', label: 'Impot', kind: 'tax' },
  { code: 'nc_achat', label: 'Note de crédit', kind: 'credit_note' },

  // Codes E-xx (frais sans chantier, historiquement dans la colonne "projet")
  { code: 'E-0', label: 'Dépôt', kind: 'expense' },
  { code: 'E-01', label: 'Matériel sans chantier', kind: 'expense' },
  { code: 'E-02', label: 'Carburant', kind: 'expense' },
  { code: 'E-03', label: 'Achat Stock', kind: 'expense' },
  { code: 'E-04', label: 'Achat Bureau', kind: 'expense' },
  { code: 'E-05', label: 'Restaurant', kind: 'expense' },
  { code: 'E-06', label: 'Achat machine', kind: 'expense' },
  { code: 'E-08', label: 'Charges fixes dépôt', kind: 'expense' },
  { code: 'E-09', label: 'Assurance Dépôt', kind: 'expense' },
  { code: 'E-10', label: 'Charges véhicules', kind: 'expense' },
  { code: 'E-12', label: 'Crédit Auto', kind: 'expense' },
  { code: 'E-14', label: 'Réparation auto', kind: 'expense' },
  { code: 'E-17', label: 'Charges', kind: 'expense' },
  { code: 'E-18', label: 'Impôt', kind: 'tax' },
];
