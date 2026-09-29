'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eyebrow } from '../_components/blocks';

export default function ContactPage() {
  const t = useTranslations('contact');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');

  const TYPES = [t('type1'), t('type2'), t('type3'), t('type4'), t('type5')];
  const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

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

            <div>
              {status === 'ok' ? (
                <div className="s-form-ok">{t('formOk')}</div>
              ) : (
                <form className="s-form" onSubmit={submit}>
                  <div className="two">
                    <div className="s-field"><label htmlFor="name">{t('labelName')}</label><input id="name" name="name" required /></div>
                    <div className="s-field"><label htmlFor="company">{t('labelCompany')}</label><input id="company" name="company" /></div>
                  </div>
                  <div className="two">
                    <div className="s-field"><label htmlFor="email">{t('labelEmail')}</label><input id="email" name="email" type="email" required /></div>
                    <div className="s-field"><label htmlFor="phone">{t('labelPhone')}</label><input id="phone" name="phone" /></div>
                  </div>
                  <div className="two">
                    <div className="s-field">
                      <label htmlFor="type">{t('labelType')}</label>
                      <select id="type" name="type" defaultValue="">
                        <option value="" disabled>{t('typePlaceholder')}</option>
                        {TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
                      </select>
                    </div>
                    <div className="s-field"><label htmlFor="location">{t('labelLocation')}</label><input id="location" name="location" /></div>
                  </div>
                  <div className="s-field"><label htmlFor="message">{t('labelMessage')}</label><textarea id="message" name="message" required /></div>
                  {/* honeypot */}
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px' }} aria-hidden />
                  {status === 'error' && <div className="s-form-err">{t('errorMsg')}</div>}
                  <button className="s-btn" type="submit" disabled={status === 'sending'}>
                    {status === 'sending' ? t('sending') : t('submit')} <span className="arr">↗</span>
                  </button>
                  <p className="s-form-note">{t('note')}</p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
