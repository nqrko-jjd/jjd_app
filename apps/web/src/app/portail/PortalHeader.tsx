'use client';
import Link from 'next/link';
import { usePortal } from '@/lib/portal';

export function PortalHeader() {
  const { me, signOut } = usePortal();
  return (
    <header className="p-header">
      <div className="inner">
        <Link href="/portail/accueil" className="brand">
          <span className="mark">J</span> JJD Consult
        </Link>
        <span className="who">
          {me?.label}
          <button onClick={signOut}>Se déconnecter</button>
        </span>
      </div>
    </header>
  );
}
