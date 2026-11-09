'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eyebrow } from '../_components/blocks';

type Answers = {
  profile: string; need: string; when: string; location: string; message: string;
  name: string; company: string; email: string; phone: string; website: string;
};
const EMPTY: Answers = { profile: '', need: '', when: '', location: '', message: '', name: '', company: '', email: '', phone: '', website: '' };
const TOTAL = 6;

export default function ContactPage() {
  const t = useTranslations('contact');
  const f = (k: string, v?: Record<string, string | number>) => t(`flow.${k}`, v);
  const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

  const [step, setStep] = useState(1);
  const [a, setA] = useState<Answers>(EMPTY);
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [missing, setMissing] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const PROFILES = ['p1', 'p2', 'p3', 'p4'].map((k) => ({ k, label: f(k) }));
  const NEEDS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((k) => ({ k, label: f(k), desc: k === 'b6' ? '' : f(`${k}d`) }));
  const WHENS = ['d1', 'd2', 'd3', 'd4'].map((k) => ({ k, label: f(k) }));
  const urgent = a.need === 'b1' || a.when === 'd1';
  const pro = a.profile !== '' && a.profile !== 'p2';

  useEffect(() => { if (step > 1) titleRef.current?.focus(); }, [step]);

  const set = (k: keyof Answers, v: string) => { setA((s) => ({ ...s, [k]: v })); setMissing(false); };
  const pick = (k: 'profile' | 'need' | 'when', v: string) => {
    set(k, v);
    window.setTimeout(() => setStep((s) => Math.min(s + 1, TOTAL)), 180);
  };
  const back = () => { setMissing(false); setStep((s) => Math.max(1, s - 1)); };
  const next = () => {
    if (step === 4 && a.location.trim().length < 2) return setMissing(true);
    if (step === 5 && a.message.trim().length < 5) return setMissing(true);
    setStep((s) => s + 1);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    const label = (list: { k: string; label: string }[], k: string) => list.find((x) => x.k === k)?.label ?? '';
    const profile = label(PROFILES, a.profile), need = label(NEEDS, a.need), when = label(WHENS, a.when);
    const message = [
      `${f('q1')} ${profile}`, `${f('q2')} ${need}`, `${f('q3')} ${when}`, '', a.message.trim(),
    ].join('\n');
    setStatus('sending');
    try {
      const res = await fetch('/jjd-api/api/public/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: a.name.trim(), company: pro ? a.company.trim() : '', email: a.email.trim(), phone: a.phone.trim(),
          type: `${profile} · ${need}`.slice(0, 60), location: a.location.trim(),
          message: message.slice(0, 4000), website: a.website,
        }),
      });
      setStatus(res.ok ? 'ok' : 'error');
    } catch {
      setStatus('error');
    }
  }

  const Choice = ({ on, label, desc, onClick }: { on: boolean; label: string; desc?: string; onClick: () => void }) => (
    <button type="button" className={`s-choice${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span className="s-choice-t">{label}</span>
      {desc ? <span className="s-choice-d">{desc}</span> : null}
      <span className="s-choice-arr" aria-hidden>→</span>
    </button>
  );

  return (
    <>
      <section className="s-hero">
        <div className="s-hero-inner" style={{ paddingBottom: 'clamp(3rem, 7vw, 5rem)' }}>
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 style={{ margin: '1.4rem 0 1.3rem', maxWidth: '16ch' }}>{t.rich('heroTitle', { em })}</h1>
          <p className="s-lead">{t('heroLead')}</p>
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-contact-grid">
            <div className="s-contact-info">
              <div className="item"><b>{t('infoPhoneLabel')}</b><a href="tel:+3228879239">+32 2 887 92 39</a></div>
              <div className="item"><b>{t('infoEmailLabel')}</b><a href="mailto:info@jjd-consult.be">info@jjd-consult.be</a></div>
              <div className="item"><b>{t('infoZoneLabel')}</b>{t('infoZoneText')}</div>
              <div className="item"><b>{t('infoAddressLabel')}</b>{t('infoAddressText')}</div>
              <div className="item"><b>{t('infoClientLabel')}</b><a href="/portail">{t('infoClientLink')}</a></div>
            </div>

            <div className="s-flow">
              {status === 'ok' ? (
                <div className="s-flow-done" role="status">
                  <span className="s-flow-check" aria-hidden>✓</span>
                  <h2>{f('okTitle')}</h2>
                  <p>{f('okText')}</p>
                  {urgent && <p className="s-flow-urgent">{f('okUrgent')} <a href="tel:+3228879239" style={{ whiteSpace: 'nowrap' }}>+32 2 887 92 39</a>.</p>}
                </div>
              ) : (
                <form onSubmit={submit} noValidate={step < TOTAL}>
                  <div className="s-flow-top">
                    {step > 1 ? (
                      <button type="button" className="s-flow-back" onClick={back}>← {f('back')}</button>
                    ) : <span />}
                    <span className="s-flow-count">{f('stepOf', { n: step, total: TOTAL })}</span>
                  </div>
                  <div className="s-flow-bar" aria-hidden><span style={{ width: `${(step / TOTAL) * 100}%` }} /></div>

                  <div className="s-flow-step" key={step}>
                    {step === 1 && (<>
                      <h2 ref={titleRef} tabIndex={-1}>{f('q1')}</h2>
                      <div className="s-choices">
                        {PROFILES.map((o) => <Choice key={o.k} on={a.profile === o.k} label={o.label} onClick={() => pick('profile', o.k)} />)}
                      </div>
                    </>)}

                    {step === 2 && (<>
                      <h2 ref={titleRef} tabIndex={-1}>{f('q2')}</h2>
                      <div className="s-choices">
                        {NEEDS.map((o) => <Choice key={o.k} on={a.need === o.k} label={o.label} desc={o.desc} onClick={() => pick('need', o.k)} />)}
                      </div>
                    </>)}

                    {step === 3 && (<>
                      <h2 ref={titleRef} tabIndex={-1}>{f('q3')}</h2>
                      <div className="s-choices">
                        {WHENS.map((o) => <Choice key={o.k} on={a.when === o.k} label={o.label} onClick={() => pick('when', o.k)} />)}
                      </div>
                    </>)}

                    {step === 4 && (<>
                      <h2 ref={titleRef} tabIndex={-1}><label htmlFor="location">{f('q4')}</label></h2>
                      <p className="s-flow-hint">{f('h4')}</p>
                      <div className="s-field">
                        <input id="location" autoComplete="street-address" value={a.location} placeholder={f('ph4')}
                          onChange={(e) => set('location', e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }} />
                      </div>
                      <p className="s-form-note">{f('zone')}</p>
                    </>)}

                    {step === 5 && (<>
                      <h2 ref={titleRef} tabIndex={-1}><label htmlFor="message">{f('q5')}</label></h2>
                      <p className="s-flow-hint">{f('h5')}</p>
                      <div className="s-field">
                        <textarea id="message" value={a.message} placeholder={f('ph5')} maxLength={3500}
                          onChange={(e) => set('message', e.target.value)} />
                      </div>
                    </>)}

                    {step === 6 && (<>
                      <h2 ref={titleRef} tabIndex={-1}>{f('q6')}</h2>
                      <div className="s-form">
                        <div className="two">
                          <div className="s-field"><label htmlFor="name">{f('name')}</label>
                            <input id="name" autoComplete="name" required minLength={2} value={a.name} onChange={(e) => set('name', e.target.value)} /></div>
                          {pro && <div className="s-field"><label htmlFor="company">{f('company')}</label>
                            <input id="company" autoComplete="organization" value={a.company} onChange={(e) => set('company', e.target.value)} /></div>}
                        </div>
                        <div className="two">
                          <div className="s-field"><label htmlFor="email">{f('email')}</label>
                            <input id="email" type="email" autoComplete="email" required value={a.email} onChange={(e) => set('email', e.target.value)} /></div>
                          <div className="s-field"><label htmlFor="phone">{urgent ? f('phoneReq') : f('phone')}</label>
                            <input id="phone" type="tel" autoComplete="tel" required={urgent} value={a.phone} onChange={(e) => set('phone', e.target.value)} /></div>
                        </div>
                      </div>
                    </>)}
                  </div>

                  {/* honeypot */}
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" value={a.website}
                    onChange={(e) => set('website', e.target.value)} style={{ position: 'absolute', left: '-9999px' }} aria-hidden />

                  {missing && <div className="s-form-err">{f('errField')}</div>}
                  {status === 'error' && <div className="s-form-err">{f('err')}</div>}

                  {(step === 4 || step === 5) && (
                    <button type="button" className="s-btn s-flow-next" onClick={next}>{f('next')} <span className="arr">→</span></button>
                  )}
                  {step === TOTAL && (<>
                    <button type="submit" className="s-btn s-flow-next" disabled={status === 'sending'}>
                      {status === 'sending' ? f('sending') : f('submit')} <span className="arr">↗</span>
                    </button>
                    <p className="s-form-note">{f('note')}</p>
                  </>)}
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
