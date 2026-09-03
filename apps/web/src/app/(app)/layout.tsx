'use client';
import { Sidebar } from '@/components/Sidebar';
import { useRequireAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth();

  if (loading) return <div className="empty">Chargement…</div>;
  if (!user) return <div className="empty">Redirection…</div>;

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">{children}</main>
    </div>
  );
}
