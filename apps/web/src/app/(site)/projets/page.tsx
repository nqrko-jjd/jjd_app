import type { Metadata } from 'next';
import { PageHero, SectionHead, Steps, CtaBand, Eyebrow } from '../_components/blocks';

export const metadata: Metadata = {
  title: 'Étude et coordination de projets | JJD Consult',
  description:
    'De l’analyse du potentiel d’un bien à la coordination des travaux : une feuille de route réaliste, budgétée et coordonnée.',
};

export default function ProjetsPage() {
  return (
    <>
      <PageHero
        eyebrow="JJD Projets"
        title={<>Décider avec méthode. <span className="s-em">Réaliser avec maîtrise.</span></>}
        lead="Nous transformons un bâtiment à potentiel ou un projet complexe en une feuille de route réaliste, budgétée et coordonnée."
      />

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Avant les travaux</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Donner une direction claire <span className="s-em">aux bonnes décisions.</span></h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>
                Un projet solide commence avant le premier coup de marteau.
              </p>
            </div>
            <p style={{ color: 'var(--s-ink-soft)' }}>
              Nous analysons l’état du bien, confrontons les usages possibles, structurons les grands postes et
              identifions les études spécialisées nécessaires. Vous avancez avec une vision plus réaliste du projet
              et du budget.
            </p>
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Notre accompagnement"
            title={<>De l’idée au chantier, <span className="s-em">une progression structurée.</span></>}
          />
          <Steps
            items={[
              { title: 'Visite & analyse', text: 'Lecture générale du bâtiment, objectifs, contraintes visibles et priorités à approfondir.' },
              { title: 'Scénarios & valorisation', text: 'Comparaison de plusieurs organisations, usages ou niveaux de finition selon votre stratégie.' },
              { title: 'Budget & programme', text: 'Estimation structurée des grands postes et préparation d’un programme de rénovation cohérent.' },
              { title: 'Coordination & réalisation', text: 'Consultation des partenaires, planification, exécution et suivi des différents corps de métier.' },
            ]}
          />
        </div>
      </section>

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Étude de cas • Waterloo</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Deux bâtiments. <span className="s-em">Plusieurs scénarios.</span></h2>
              <p className="s-lead">
                Une maison familiale partiellement rénovée et un ancien relais de poste resté à l’état brut.
                L’étude a permis de confronter deux logiques d’exploitation et de définir le programme de travaux
                avant toute décision importante.
              </p>
            </div>
            <div className="s-panel">
              <div className="row"><b>150 m²</b><span>Maison familiale</span></div>
              <div className="row"><b>140 m²</b><span>Ancien relais</span></div>
              <div className="row"><b>2</b><span>Scénarios étudiés</span></div>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow="JJD Consult"
        title={<>Vous possédez <span className="s-em">un bien à transformer ?</span></>}
        text="Parlez-nous du bâtiment, de sa situation actuelle et de votre objectif. Nous vous aiderons à choisir le bon niveau d’étude."
        primary={{ href: '/contact', label: 'Demander une première analyse' }}
        secondary={{ href: 'tel:+3228879239', label: '+32 2 887 92 39' }}
      />
    </>
  );
}
