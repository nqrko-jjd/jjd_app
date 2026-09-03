import './portal.css';
import { PortalProvider } from '@/lib/portal';

export const metadata = { title: 'Espace client — JJD Consult' };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal">
      <PortalProvider>{children}</PortalProvider>
    </div>
  );
}
