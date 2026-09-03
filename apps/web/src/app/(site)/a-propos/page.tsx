import type { Metadata } from 'next';
import { PageHero, SectionHead, CtaBand, Eyebrow, NumberCard } from '../_components/blocks';

export const metadata: Metadata = {
  title: 'Qui sommes-nous ? | JJD Consult',
  description:
    'JJD Consult, entreprise familiale du bâtiment : organisation claire, relation directe et plus de 20 ans d’expérience.',
};

export default function AProposPage() {
  return (
    <>
      <PageHero
        eyebrow="Qui sommes-nous ?"
        title={<>Une entreprise familiale. <span className="s-em">Une culture du terrain.</span></>}
        lead="JJD Consult accompagne particuliers et professionnels avec une organisation claire, une relation directe et plus de 20 ans d’expérience du bâtiment."
      />

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Notre histoire</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Construire une relation <span className="s-em">aussi solide que les travaux.</span></h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>
                JJD Consult est née d’une conviction simple : les clients ont besoin d’un partenaire qui comprend
                le terrain et qui reste présent jusqu’à la fin.
              </p>
            </div>
            <div style={{ display: 'grid', gap: '1rem', color: 'var(--s-ink-soft)' }}>
              <p>
                La direction technique s’appuie sur plus de 20 ans d’expérience dans le bâtiment, les installations
                techniques, la rénovation et le suivi de projets. Cette expérience nous permet d’identifier les
                contraintes en amont et de proposer des solutions concrètes.
              </p>
              <p>
                Notre structure familiale conserve une communication directe. Vous savez qui contacter, ce qui a été
                décidé et comment le projet avance.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead eyebrow="Nos valeurs" title={<>Ce qui guide <span className="s-em">chaque mission.</span></>} />
          <div className="s-grid cols-4">
            <NumberCard n="01" title="Réactivité"><p>Répondre, organiser et tenir informé sans laisser les demandes se perdre.</p></NumberCard>
            <NumberCard n="02" title="Rigueur"><p>Préparer les interventions, contrôler l’exécution et soigner les finitions.</p></NumberCard>
            <NumberCard n="03" title="Transparence"><p>Expliquer les priorités, les limites et les conséquences des décisions.</p></NumberCard>
            <NumberCard n="04" title="Implication"><p>Suivre chaque mission avec la même attention, quelle que soit son ampleur.</p></NumberCard>
          </div>
        </div>
      </section>

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>Une structure complète</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>Maintenance. Rénovation. <span className="s-em">Projets.</span></h2>
            </div>
            <p className="s-lead">
              Ces trois expertises nous permettent d’accompagner un bâtiment à toutes les étapes de sa vie :
              entretien courant, transformation complète ou projet nécessitant une étude et une coordination plus large.
            </p>
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow="JJD Consult"
        title={<>Faisons <span className="s-em">connaissance.</span></>}
        text="Parlez-nous de votre bâtiment et de vos attentes. Nous vous dirons clairement comment JJD Consult peut vous accompagner."
        primary={{ href: '/contact', label: 'Nous contacter' }}
        secondary={{ href: 'tel:+3228879239', label: '+32 2 887 92 39' }}
      />
    </>
  );
}
