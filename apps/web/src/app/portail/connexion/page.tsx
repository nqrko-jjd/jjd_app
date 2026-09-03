'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { portalApi, setPortalToken } from '@/lib/portal';

function Verify() {
  const router = useRouter();
  const params = useSearchParams();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setErr('Lien invalide.'); return; }
    portalApi<{ token: string }>('/verify', { method: 'POST', body: { token } })
      .then((r) => {
        setPortalToken(r.token);
        // rechargement complet pour que le PortalProvider relise /me avec le token
        window.location.href = '/portail/accueil';
      })
      .catch((e) => setErr(e.message));
  }, [params, router]);

  return (
    <div className="p-login-wrap">
      <div className="p-login" style={{ textAlign: 'center' }}>
        {err ? (
          <>
            <h1 style={{ fontSize: '1.2rem' }}>Connexion impossible</h1>
            <p className="p-note" style={{ margin: '0.6rem 0 1rem' }}>{err}</p>
            <button className="p-btn-primary" onClick={() => router.push('/portail')}>Demander un nouveau lien</button>
          </>
        ) : (
          <p>Connexion en cours…</p>
        )}
      </div>
    </div>
  );
}

export default function ConnexionPage() {
  return <Suspense fallback={<div className="p-login-wrap">…</div>}><Verify /></Suspense>;
}
