import type { Metadata } from 'next';
import Link from 'next/link';
import { Eyebrow, SectionHead, Cta, NumberCard, Steps, CtaBand } from './_components/blocks';
import { Figure, HeroImage } from './_components/Figure';

export const metadata: Metadata = {
  title: 'JJD Consult | Maintenance, Rénovation et Projets',
  description:
    'Un seul partenaire pour entretenir, transformer et valoriser vos bâtiments à Bruxelles et dans le Brabant wallon.',
};

const SERVICES = [
  {
    n: '01', tag: 'JJD Maintenance', title: 'Maintenance',
    baseline: 'Préserver la valeur de vos bâtiments.',
    text: 'Un partenaire technique réactif pour entretenir, réparer et suivre vos immeubles dans la durée.',
    points: ['Syndics & copropriétés', 'SAV pour promoteurs', 'Entreprises & bureaux', 'Interventions multitechniques'],
    href: '/maintenance',
  },
  {
    n: '02', tag: 'JJD Rénovation', title: 'Rénovation',
    baseline: 'Transformer avec une vision d’ensemble.',
    text: 'Des rénovations complètes coordonnées de A à Z, avec une attention constante portée à la qualité des finitions.',
    points: ['Rénovation complète', 'Propriétés de standing', 'Intérieur & techniques', 'Terrasses, jardin & piscine'],
    href: '/renovation',
  },
  {
    n: '03', tag: 'JJD Projets', title: 'Projets',
    baseline: 'Donner une direction claire aux projets complexes.',
    text: 'De l’étude des possibilités à la réalisation, nous structurons les choix, le budget et les intervenants.',
    points: ['Étude & valorisation', 'Scénarios d’aménagement', 'Budget & planification', 'Coordination générale'],
    href: '/projets',
  },
];

const AUDIENCES = [
  { title: 'Particuliers & propriétaires', text: 'Rénovation, transformation et entretien de maisons, appartements et propriétés de standing.' },
  { title: 'Syndics & copropriétés', text: 'Maintenance multitechnique, travaux dans les communs et projets de rénovation coordonnés.' },
  { title: 'Promoteurs & architectes', text: 'SAV après livraison, levée de réserves, reprises et exécution de projets techniques.' },
  { title: 'Entreprises & investisseurs', text: 'Entretien, aménagement, étude de potentiel et transformation de bâtiments professionnels ou résidentiels.' },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="s-hero">
        <HeroImage src="/site/jjd-villa-exterior.webp" alt="Propriété contemporaine rénovée avec terrasse et piscine" />
        <div className="s-hero-inner">
          <Eyebrow>Maintenance • Rénovation • Projets</Eyebrow>
          <h1>Nous prenons soin de vos bâtiments. <span className="s-em">À chaque étape.</span></h1>
          <p className="s-lead">
            Un seul partenaire pour entretenir, transformer et valoriser vos biens à Bruxelles et dans le Brabant wallon.
          </p>
          <div className="s-hero-actions">
            <Cta href="/contact">Échanger sur mon besoin</Cta>
            <a href="tel:+3228879239" className="tel">+32 2 887 92 39</a>
          </div>
          <div className="s-hero-stats">
            <div className="s-stat"><b>20+</b><span>ans d’expérience dans le bâtiment</span></div>
            <div className="s-stat"><b>01</b><span>interlocuteur pour vous répondre</span></div>
            <div className="s-stat"><b>360°</b><span>du constat à la réception</span></div>
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>JJD Consult</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>Trois expertises. <span className="s-em">Une même exigence.</span></h2>
              <p className="s-lead" style={{ maxWidth: '48ch' }}>
                Un bâtiment vit, évolue et demande des réponses différentes au fil du temps.
              </p>
            </div>
            <p style={{ color: 'var(--s-ink-soft)' }}>
              JJD Consult réunit la maintenance, la rénovation et la gestion de projets dans une seule structure.
              Vous bénéficiez d’une équipe de terrain, d’une communication claire et d’un suivi adapté à chaque mission.
            </p>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="s-section dark">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Nos trois services"
            title={<>À chaque besoin, <span className="s-em">le bon niveau d’accompagnement.</span></>}
          />
          <div className="s-grid cols-3">
            {SERVICES.map((s) => (
              <Link key={s.n} href={s.href} className="s-card s-service">
                <span className="s-num">{s.n}</span>
                <div className="tag">{s.tag}</div>
                <h3>{s.title}</h3>
                <p style={{ fontWeight: 500, color: '#f4f1e9' }}>{s.baseline}</p>
                <p>{s.text}</p>
                <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
                <span className="s-link">Découvrir ce service <span>↗</span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Reference — Rhode-Saint-Genèse */}
      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split middle">
            <Figure src="/site/jjd-interior-hall.webp" alt="Intérieur haut de gamme rénové avec matériaux naturels" ratio="16 / 11" label="Rhode-Saint-Genèse" />
            <div>
              <Eyebrow>Référence • Rhode-Saint-Genèse</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>Une propriété d’exception, <span className="s-em">pensée dans son ensemble.</span></h2>
              <p className="s-lead" style={{ marginBottom: '1.6rem' }}>
                Rénovation et valorisation globale d’une propriété de standing : espaces intérieurs, équipements techniques,
                terrasses, abords, jardin, pelouse et zone piscine.
              </p>
              <ul className="s-list">
                <li>Une cohérence du dedans au dehors</li>
                <li>Une coordination centralisée, un interlocuteur principal</li>
                <li>Des finitions suivies de près, raccord par raccord</li>
              </ul>
              <div style={{ marginTop: '2rem' }}>
                <Cta href="/contact" variant="dark">Parler de mon projet</Cta>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Méthode */}
      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Notre méthode"
            title={<>Une organisation claire, <span className="s-em">du premier contact à la réception.</span></>}
          />
          <Steps
            items={[
              { title: 'Comprendre', text: 'Votre bâtiment, votre besoin, vos priorités et les contraintes visibles.' },
              { title: 'Structurer', text: 'La solution, le devis, les intervenants et le planning adapté à la mission.' },
              { title: 'Réaliser', text: 'Les travaux avec une coordination quotidienne et un suivi régulier.' },
              { title: 'Contrôler', text: 'La qualité, les finitions et la clôture claire de l’intervention.' },
            ]}
          />
        </div>
      </section>

      {/* Audiences */}
      <section className="s-section">
        <div className="s-wrap">
          <SectionHead
            eyebrow="À vos côtés"
            title={<>Un service adapté <span className="s-em">à chaque interlocuteur.</span></>}
            lead="La structure JJD Consult permet d’accompagner aussi bien un propriétaire que le gestionnaire d’un portefeuille immobilier."
          />
          <div className="s-grid cols-2">
            {AUDIENCES.map((a) => (
              <div key={a.title} className="s-card">
                <h3>{a.title}</h3>
                <p>{a.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* JJD Projets — décider avant de construire */}
      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>JJD Projets</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>Décider <span className="s-em">avant de construire.</span></h2>
              <p className="s-lead">
                Vous envisagez un achat, une transformation ou plusieurs scénarios d’exploitation ? Nous analysons le
                potentiel du bien, les travaux à prévoir et le budget nécessaire avant les grandes décisions.
              </p>
              <div style={{ marginTop: '2rem' }}>
                <Cta href="/projets">Demander une première analyse</Cta>
              </div>
            </div>
            <Figure src="/site/jjd-project-team.webp" alt="Étude et préparation d’un projet de rénovation" ratio="4 / 3" label="Étude de projet" />
          </div>
        </div>
      </section>

      {/* Espace client */}
      <section className="s-section cream2">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>Votre espace client</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>Suivez vos chantiers <span className="s-em">en ligne, à tout moment.</span></h2>
              <p className="s-lead">
                Une rénovation qui dure des mois, un portefeuille d’immeubles à gérer, un SAV après livraison :
                chaque client dispose d’un espace privé pour suivre l’avancement sans multiplier les appels et les
                e-mails — un service que peu d’entrepreneurs proposent.
              </p>
              <div style={{ marginTop: '2rem' }}>
                <Cta href="/portail" variant="dark">Accéder à l’espace client</Cta>
              </div>
            </div>
            <ul className="s-list" style={{ fontSize: '1rem' }}>
              <li>Photos et rapports d’intervention datés</li>
              <li>Devis à valider en ligne, d’un clic</li>
              <li>Planning des interventions de la semaine</li>
              <li>Historique regroupé par immeuble / ACP</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Pourquoi */}
      <section className="s-section">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Pourquoi JJD Consult"
            title={<>Le regard du terrain. <span className="s-em">La maîtrise du suivi.</span></>}
          />
          <div className="s-grid cols-4">
            <NumberCard n="01" title="Entreprise familiale"><p>Une relation directe, engagée et accessible du premier contact à la réception.</p></NumberCard>
            <NumberCard n="02" title="20 ans d’expérience"><p>Une direction technique issue du terrain, au service de décisions réalistes.</p></NumberCard>
            <NumberCard n="03" title="Communication transparente"><p>Des priorités expliquées, des devis structurés et un suivi compréhensible.</p></NumberCard>
            <NumberCard n="04" title="Coordination complète"><p>Un seul partenaire pour préserver la continuité entre les différents métiers.</p></NumberCard>
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow="Parlons de votre besoin"
        title={<>Une intervention, une rénovation <span className="s-em">ou un projet à structurer ?</span></>}
        text="Décrivez-nous le bâtiment, sa localisation et votre objectif. Nous vous recontactons pour déterminer la meilleure manière d’intervenir."
        primary={{ href: '/contact', label: 'Présenter ma demande' }}
        secondary={{ href: 'tel:+3228879239', label: 'Appeler le +32 2 887 92 39' }}
      />
    </>
  );
}
