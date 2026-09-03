import type { Metadata } from 'next';
import { PageHero, SectionHead, CtaBand, Eyebrow, Cta } from '../_components/blocks';

export const metadata: Metadata = {
  title: 'Rénovation complète | JJD Consult',
  description:
    'Rénovations complètes coordonnées de A à Z : gros œuvre, techniques du bâtiment, aménagement intérieur, enveloppe et extérieurs.',
};

const POSTES = [
  { title: 'Transformation & gros œuvre', text: 'Démolitions, maçonnerie, ouvertures, structure et préparation des nouveaux volumes.' },
  { title: 'Techniques du bâtiment', text: 'Électricité, plomberie, chauffage, ventilation, égouttage et production d’eau chaude.' },
  { title: 'Aménagement intérieur', text: 'Cloisons, plafonnage, sols, cuisines, salles de bains, menuiseries, peinture et finitions.' },
  { title: 'Enveloppe & extérieurs', text: 'Toiture, étanchéité, isolation, façades, terrasses, allées, jardin, pelouse et zone piscine.' },
];

export default function RenovationPage() {
  return (
    <>
      <PageHero
        eyebrow="JJD Rénovation"
        title={<>Transformer un bâtiment. <span className="s-em">Préserver sa cohérence.</span></>}
        lead="Une rénovation complète coordonnée de A à Z, avec un seul interlocuteur pour les décisions, les métiers et les finitions."
      />

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Rénovation globale</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Bien plus qu’une succession <span className="s-em">de corps de métier.</span></h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>
                Nous pensons le chantier dans son ensemble : volumes, techniques, enveloppe, finitions et extérieurs.
              </p>
            </div>
            <p style={{ color: 'var(--s-ink-soft)' }}>
              Cette vision permet d’éviter les incohérences entre les postes, de mieux anticiper les contraintes
              et de garder une direction claire tout au long du projet.
            </p>
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead
            eyebrow="De A à Z"
            title={<>Tout ce qui compose <span className="s-em">une rénovation complète.</span></>}
          />
          <div className="s-grid cols-2">
            {POSTES.map((p, i) => (
              <div key={p.title} className="s-card">
                <span className="s-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Votre espace chantier</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Une rénovation qui dure ? <span className="s-em">Suivez-la en ligne.</span></h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>
                Un chantier complet s’étale sur des mois. Depuis votre espace privé, vous voyez où en est chaque poste,
                les photos de la semaine, le planning et les devis à valider — sans avoir à relancer pour savoir.
              </p>
              <div style={{ marginTop: '1.8rem' }}>
                <Cta href="/portail" variant="dark">Voir l’espace client</Cta>
              </div>
            </div>
            <ul className="s-list">
              <li>Avancement poste par poste</li>
              <li>Photos et comptes rendus datés</li>
              <li>Planning des interventions à venir</li>
              <li>Devis complémentaires validés d’un clic</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Projets de standing</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Le même niveau d’exigence, <span className="s-em">jusque dans les détails.</span></h2>
              <p className="s-lead">
                Pour une propriété d’exception, les raccords, les matériaux et la continuité entre l’intérieur et
                l’extérieur sont aussi importants que les grands postes. Notre rôle est de maintenir cette cohérence.
              </p>
            </div>
            <ul className="s-list">
              <li>Interlocuteur principal</li>
              <li>Coordination des artisans et fournisseurs</li>
              <li>Protection des espaces et matériaux</li>
              <li>Contrôle attentif des finitions</li>
            </ul>
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow="JJD Consult"
        title={<>Vous envisagez <span className="s-em">une rénovation complète ?</span></>}
        text="Envoyez-nous l’adresse, quelques photos, les plans disponibles et votre objectif afin d’organiser un premier échange."
        primary={{ href: '/contact', label: 'Nous contacter' }}
        secondary={{ href: 'tel:+3228879239', label: '+32 2 887 92 39' }}
      />
    </>
  );
}
