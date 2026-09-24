'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { useRequireAuth } from '@/lib/auth';

/** Espaces accessibles au magasinier : tout le reste (chantiers, devis, finances…) lui est fermé côté API. */
const STOREKEEPER_PREFIXES = ['/app/stock', '/app/materiel'];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth();
  const pathname = usePathname();
  const router = useRouter();
  const blocked = user?.role === 'storekeeper' && !STOREKEEPER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (blocked) router.replace('/app/stock/preparations');
  }, [blocked, router]);

  if (loading) return <div className="empty">Chargement…</div>;
  if (!user || blocked) return <div className="empty">Redirection…</div>;

  return <Shell>{children}</Shell>;
}
