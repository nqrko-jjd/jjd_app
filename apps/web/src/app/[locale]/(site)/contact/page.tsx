'use client';
import { useState } from 'react';
import { Eyebrow } from '../_components/blocks';

const TYPES = ['Maintenance', 'Rénovation', 'Projet / étude', 'SAV promoteur', 'Autre demande'];

export default function ContactPage() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setStatus('sending');
    try {
      const res = await fetch('/jjd-api/api/public/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: f.get('name'), company: f.get('company'), email: f.get('email'),
          phone: f.get('phone'), type: f.get('type'), location: f.get('location'),
          message: f.get('message'), website: f.get('website'),
        }),
      });
      setStatus(res.ok ? 'ok' : 'error');
      if (res.ok) e.currentTarget.reset();
    } catch {
      setStatus('error');
    }
  }

  return (
    <>
      <section className="s-hero">
        <div className="s-hero-inner" style={{ paddingBottom: 'clamp(3rem, 7vw, 5rem)' }}>
          <Eyebrow>Contact</Eyebrow>
          <h1 style={{ margin: '1.4rem 0 1.3rem', maxWidth: '16ch' }}>Parlons de <span className="s-em">votre bâtiment.</span></h1>
          <p className="s-lead">
            Une intervention, une rénovation ou un projet à structurer ? Donnez-nous les premières informations utiles
            afin que nous puissions vous orienter correctement.
          </p>
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-contact-grid">
            <div className="s-contact-info">
              <div className="item"><b>Téléphone</b><a href="tel:+3228879239">+32 2 887 92 39</a></div>
              <div className="item"><b>E-mail</b><a href="mailto:info@jjd-consult.be">info@jjd-consult.be</a></div>
              <div className="item"><b>Zone d’intervention</b>Bruxelles, Brabant wallon et périphérie</div>
              <div className="item"><b>Adresse</b>Gieterijstraat 49, 1601 Leeuw-Saint-Pierre</div>
              <div className="item"><b>Déjà client ?</b><a href="/portail">Accéder à l’espace client ↗</a></div>
            </div>

            <div>
              {status === 'ok' ? (
                <div className="s-form-ok">
                  Merci, votre demande est bien arrivée. Nous revenons vers vous rapidement pour convenir de la
                  meilleure manière d’intervenir.
                </div>
              ) : (
                <form className="s-form" onSubmit={submit}>
                  <div className="two">
                    <div className="s-field"><label htmlFor="name">Nom et prénom</label><input id="name" name="name" required /></div>
                    <div className="s-field"><label htmlFor="company">Société</label><input id="company" name="company" /></div>
                  </div>
                  <div className="two">
                    <div className="s-field"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" required /></div>
                    <div className="s-field"><label htmlFor="phone">Téléphone</label><input id="phone" name="phone" /></div>
                  </div>
                  <div className="two">
                    <div className="s-field">
                      <label htmlFor="type">Type de demande</label>
                      <select id="type" name="type" defaultValue="">
                        <option value="" disabled>Choisissez un service</option>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="s-field"><label htmlFor="location">Localisation du bâtiment</label><input id="location" name="location" /></div>
                  </div>
                  <div className="s-field"><label htmlFor="message">Votre demande</label><textarea id="message" name="message" required /></div>
                  {/* honeypot */}
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px' }} aria-hidden />
                  {status === 'error' && <div className="s-form-err">Une erreur est survenue. Réessayez ou écrivez-nous à info@jjd-consult.be.</div>}
                  <button className="s-btn" type="submit" disabled={status === 'sending'}>
                    {status === 'sending' ? 'Envoi…' : 'Envoyer ma demande'} <span className="arr">↗</span>
                  </button>
                  <p className="s-form-note">Vos informations sont utilisées uniquement pour traiter votre demande.</p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
