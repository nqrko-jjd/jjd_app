import type { Metadata } from 'next';
import Link from 'next/link';
import { Eyebrow, SectionHead, Cta, NumberCard, Steps, CtaBand } from './_components/blocks';
import { Figure, HeroImage, Band } from './_components/Figure';

export const metadata: Metadata = {
  title: 'JJD Consult | Maintenance, Rénovation et Projets',
  description:
    'Un seul partenaire pour entretenir, transformer et valoriser vos bâtiments à Bruxelles et dans le Brabant wallon.',
};

const SERVICES = [
  {
    n: '01', tag: 'JJD Maintenance', title: 'Maintenance', img: '/site/service-maintenance.jpg',
    baseline: 'Préserver la valeur de vos bâtiments.',
    text: 'Un partenaire technique réactif pour entretenir, réparer et suivre vos immeubles dans la durée.',
    points: ['Syndics & copropriétés', 'SAV pour promoteurs', 'Entreprises & bureaux', 'Interventions multitechniques'],
    href: '/maintenance',
  },
  {
    n: '02', tag: 'JJD Rénovation', title: 'Rénovation', img: '/site/service-renovation.jpg',
    baseline: 'Transformer avec une vision d’ensemble.',
    text: 'Des rénovations complètes coordonnées de A à Z, avec une attention constante portée à la qualité des finitions.',
    points: ['Rénovation complète', 'Propriétés de standing', 'Intérieur & techniques', 'Terrasses, jardin & piscine'],
    href: '/renovation',
  },
  {
    n: '03', tag: 'JJD Projets', title: 'Projets', img: '/site/service-projets.jpg',
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
        <HeroImage src="/site/hero.jpg" alt="Chantier JJD Consult" />
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
              <p className="s-lead" style={{ maxWidth: '48ch', marginBottom: '1.1rem' }}>
                Un bâtiment vit, évolue et demande des réponses différentes au fil du temps.
              </p>
              <p style={{ color: 'var(--s-ink-soft)' }}>
                JJD Consult réunit la maintenance, la rénovation et la gestion de projets dans une seule structure.
                Vous bénéficiez d’une équipe de terrain, d’une communication claire et d’un suivi adapté à chaque mission.
              </p>
            </div>
            <Figure src="/site/equipe.jpg" alt="L’équipe JJD Consult sur le terrain" ratio="5 / 4" label="Équipe / terrain" />
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead
            eyebrow="Nos trois services"
            title={<>À chaque besoin, <span className="s-em">le bon niveau d’accompagnement.</span></>}
          />
          <div className="s-grid cols-3">
            {SERVICES.map((s) => (
              <Link key={s.n} href={s.href} className="s-card s-service">
                <Figure src={s.img} alt={s.title} ratio="16 / 10" label={s.title} className="s-service-fig" />
                <div className="tag">{s.tag}</div>
                <h3>{s.title}</h3>
                <p style={{ fontWeight: 500, color: 'var(--s-ink)' }}>{s.baseline}</p>
                <p>{s.text}</p>
                <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
                <span className="s-link">Découvrir ce service <span>↗</span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Reference */}
      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split middle reverse">
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
                <Cta href="/contact">Parler de mon projet</Cta>
              </div>
            </div>
            <Figure src="/site/reference-rhode.jpg" alt="Propriété rénovée à Rhode-Saint-Genèse" ratio="4 / 5" label="Rhode-Saint-Genèse" />
          </div>
        </div>
      </section>

      {/* Méthode */}
      <section className="s-section">
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

      {/* Bande image */}
      <Band src="/site/band-chantier.jpg" alt="Intervention sur chantier" />

      {/* Espace client */}
      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Votre espace client</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>Suivez vos chantiers <span className="s-em">en ligne, à tout moment.</span></h2>
              <p className="s-lead">
                Une rénovation qui dure des mois, un portefeuille d’immeubles à gérer, un SAV après livraison :
                chaque client dispose d’un espace privé pour suivre l’avancement sans multiplier les appels et les
                e-mails — un service que peu d’entrepreneurs proposent.
              </p>
              <div style={{ marginTop: '2rem' }}>
                <Cta href="/portail">Accéder à l’espace client</Cta>
              </div>
            </div>
            <div className="s-panel">
              <div className="row"><b>·</b><div><strong>Photos et rapports d’intervention</strong><br />Le suivi du terrain, daté et illustré, dossier par dossier.</div></div>
              <div className="row"><b>·</b><div><strong>Devis à valider en ligne</strong><br />Acceptez un devis d’un clic, sans échange de papier.</div></div>
              <div className="row"><b>·</b><div><strong>Planning des interventions</strong><br />Ce qui est prévu cette semaine sur vos immeubles.</div></div>
              <div className="row"><b>·</b><div><strong>Historique par immeuble</strong><br />Toutes les interventions passées regroupées par bâtiment / ACP.</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* Audiences */}
      <section className="s-section cream2">
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
