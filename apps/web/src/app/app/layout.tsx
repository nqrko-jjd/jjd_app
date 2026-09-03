'use client';
import { Shell } from '@/components/Shell';
import { useRequireAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth();

  if (loading) return <div className="empty">Chargement…</div>;
  if (!user) return <div className="empty">Redirection…</div>;

  return <Shell>{children}</Shell>;
}
