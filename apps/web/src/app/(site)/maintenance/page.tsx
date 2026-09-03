import type { Metadata } from 'next';
import { PageHero, SectionHead, Steps, CtaBand, Eyebrow, Cta } from '../_components/blocks';

export const metadata: Metadata = {
  title: 'Maintenance de bâtiments | JJD Consult',
  description:
    'Interventions, réparations et suivi technique multitechnique pour syndics, promoteurs et entreprises à Bruxelles et dans le Brabant wallon.',
};

const INTERVENTIONS = [
  { title: 'Syndics & copropriétés', text: 'Parties communes, infiltrations, plomberie, électricité, peinture, égouttage et coordination de travaux.' },
  { title: 'SAV pour promoteurs', text: 'Rendez-vous occupants, reprises de finitions, petites réparations multitechniques et clôture des dossiers.' },
  { title: 'Entreprises & bureaux', text: 'Réparations, adaptations et entretien pour conserver des espaces fonctionnels et soignés.' },
  { title: 'Contrats d’entretien', text: 'Visites planifiées, contrôle d’équipements, entretien des abords et rapports de suivi adaptés au bâtiment.' },
];

export default function MaintenancePage() {
  return (
    <>
      <PageHero
        eyebrow="JJD Maintenance"
        title={<>Des bâtiments suivis. <span className="s-em">Des demandes maîtrisées.</span></>}
        lead="Interventions, réparations et suivi technique avec un partenaire réactif qui connaît la réalité des immeubles."
      />

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Maintenance multitechnique</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Un interlocuteur de terrain <span className="s-em">pour vos bâtiments.</span></h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>
                Centralisez davantage d’interventions sans multiplier les entreprises et les relances.
              </p>
            </div>
            <p style={{ color: 'var(--s-ink-soft)' }}>
              JJD Consult accompagne les gestionnaires et propriétaires pour les demandes ponctuelles comme pour
              l’entretien régulier. Chaque intervention est qualifiée, organisée et suivie jusqu’à sa clôture.
            </p>
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Nos interventions"
            title={<>Une réponse structurée, <span className="s-em">du signalement à la résolution.</span></>}
          />
          <div className="s-grid cols-2">
            {INTERVENTIONS.map((it, i) => (
              <div key={it.title} className="s-card">
                <span className="s-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{it.title}</h3>
                <p>{it.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Notre méthode"
            title={<>Clair pour le gestionnaire. <span className="s-em">Concret sur le terrain.</span></>}
          />
          <ul className="s-list" style={{ fontSize: '1.05rem' }}>
            <li>Qualification précise de la demande</li>
            <li>Visite et constat lorsque nécessaire</li>
            <li>Devis structuré ou intervention en régie</li>
            <li>Coordination avec occupants et fournisseurs</li>
            <li>Retour clair après intervention</li>
          </ul>
        </div>
      </section>

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Espace syndic & copropriété</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Un portail dédié <span className="s-em">à vos immeubles.</span></h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>
                Vos gestionnaires suivent chaque intervention en ligne, par immeuble : photos, rapports signés, devis à
                valider et planning de la semaine. Vos copropriétaires y accèdent en lecture pour les infos qui les
                concernent.
              </p>
              <div style={{ marginTop: '1.8rem' }}>
                <Cta href="/portail">Voir l’espace client</Cta>
              </div>
            </div>
            <div className="s-panel">
              <div className="row"><b>·</b><div><strong>Vue par immeuble / ACP</strong><br />Interventions en cours et historique regroupés par bâtiment.</div></div>
              <div className="row"><b>·</b><div><strong>Rapports d’intervention</strong><br />Datés, illustrés et signés sur place par l’équipe.</div></div>
              <div className="row"><b>·</b><div><strong>Accès résident en lecture</strong><br />Les habitants voient le suivi, sans les données financières.</div></div>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow="JJD Consult"
        title={<>Un immeuble ou un portefeuille <span className="s-em">à entretenir ?</span></>}
        text="Présentez-nous vos bâtiments et vos besoins récurrents. Nous déterminerons ensemble la formule la plus adaptée."
        primary={{ href: '/contact', label: 'Nous contacter' }}
        secondary={{ href: 'tel:+3228879239', label: '+32 2 887 92 39' }}
      />
    </>
  );
}
