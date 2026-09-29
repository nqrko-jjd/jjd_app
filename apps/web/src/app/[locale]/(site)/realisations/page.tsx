import type { Metadata } from 'next';
import { PageHero, SectionHead, CtaBand } from '../_components/blocks';
import { Figure } from '../_components/Figure';

export const metadata: Metadata = {
  title: 'Réalisations | JJD Consult',
  description: 'Une sélection de projets : rénovation complète, étude & valorisation, aménagements extérieurs et transformations.',
};

const PROJETS = [
  { img: 'real-1', tag: 'Rénovation complète • Rhode-Saint-Genèse', title: 'Propriété de standing', text: 'Transformation globale de la propriété : intérieur, techniques, terrasses, abords, jardin, pelouse et zone piscine.' },
  { img: 'real-2', tag: 'Étude & valorisation • Waterloo', title: 'Maison et ancien relais de poste', text: 'Analyse du potentiel, projections 3D, comparaison de scénarios et préparation du programme de rénovation.' },
  { img: 'real-3', tag: 'Aménagement extérieur • Projet JJD Consult', title: 'Terrasse et abords', text: 'Création d’un espace extérieur cohérent avec le bâtiment, des finitions jusqu’aux raccords avec le jardin.' },
  { img: 'real-4', tag: 'Transformation • Avant / après', title: 'Façade et enveloppe', text: 'Modernisation de l’aspect extérieur et amélioration durable de la protection du bâtiment.' },
  { img: 'real-5', tag: 'Rénovation intérieure • Avant / après', title: 'Escalier et circulation', text: 'Reprise complète d’un espace de passage pour retrouver une circulation plus claire et des finitions soignées.' },
  { img: 'real-6', tag: 'Aménagement extérieur • Avant / après', title: 'Accès et allées', text: 'Réorganisation des accès et remise en état des abords pour un ensemble plus propre, pratique et durable.' },
  { img: 'real-7', tag: 'Rénovation intérieure • Avant / après', title: 'Transformation des espaces', text: 'Redistribution, rénovation et finitions intérieures coordonnées dans une vision d’ensemble.' },
  { img: 'real-8', tag: 'Gros œuvre • Projet JJD Consult', title: 'Structure et toiture', text: 'Travaux de structure et de couverture réalisés avec une attention particulière portée à la stabilité et à l’étanchéité.' },
];

export default function RealisationsPage() {
  return (
    <>
      <PageHero
        eyebrow="Nos réalisations"
        title={<>Des réponses différentes. <span className="s-em">Une même exigence.</span></>}
        lead="Rénovation, maintenance ou projet : nous adaptons l’organisation et les équipes à la réalité de chaque bâtiment."
        image="/site/hero-realisations.jpg"
      />

      <section className="s-section">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Sélection de projets"
            title={<>Du projet d’exception <span className="s-em">à l’intervention quotidienne.</span></>}
          />
          <div className="s-grid cols-3">
            {PROJETS.map((p) => (
              <article key={p.title} className="s-real">
                <Figure src={`/site/${p.img}.jpg`} alt={p.title} ratio="4 / 3" label={p.title} className="s-real-fig" />
                <div className="bd">
                  <span className="tag">{p.tag}</span>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="s-form-note" style={{ marginTop: '2.5rem' }}>
            Certaines références sont présentées de manière anonymisée afin de respecter la confidentialité de nos clients et partenaires.
          </p>
        </div>
      </section>

      <CtaBand
        eyebrow="JJD Consult"
        title={<>Votre projet pourrait être <span className="s-em">le prochain.</span></>}
        text="Expliquez-nous votre besoin et le niveau d’accompagnement recherché. Nous vous proposerons une première approche adaptée."
        primary={{ href: '/contact', label: 'Nous contacter' }}
        secondary={{ href: 'tel:+3228879239', label: '+32 2 887 92 39' }}
      />
    </>
  );
}
