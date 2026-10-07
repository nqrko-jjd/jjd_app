'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

export type MenuItem =
  | { label: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; check?: boolean }
  | { label: ReactNode; items: MenuItem[]; disabled?: boolean }
  | 'separator';

/** Gère l'état {x, y, row} d'un menu contextuel de tableau. */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<{ x: number; y: number; row: T } | null>(null);
  const open = useCallback((e: ReactMouseEvent, row: T) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, row });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  return { menu, open, close };
}

/** Actions « Ouvrir / Ouvrir dans un nouvel onglet » communes à toutes les listes. */
export function openActions(href: string, go: (href: string) => void): MenuItem[] {
  return [
    { label: 'Ouvrir', onClick: () => go(href) },
    { label: 'Ouvrir dans un nouvel onglet', onClick: () => window.open(href, '_blank') },
  ];
}

function isSubmenu(i: MenuItem): i is { label: ReactNode; items: MenuItem[]; disabled?: boolean } {
  return typeof i === 'object' && 'items' in i;
}

function MenuBox({ children }: { children: ReactNode }) {
  return <div className="ctx-menu" role="menu">{children}</div>;
}

/** Sous-menu : se replace dans la fenêtre (remonte s'il dépasse en bas, s'ouvre à gauche s'il dépasse à droite, défile s'il est plus haut que l'écran). */
function SubMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.maxHeight = `${window.innerHeight - 16}px`;
    el.style.overflowY = 'auto';
    let r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) {
      const shift = Math.min(r.bottom - (window.innerHeight - 8), Math.max(0, r.top - 8));
      el.style.top = `${-5 - shift}px`;
    }
    r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) {
      el.style.left = 'auto';
      el.style.right = '100%';
      el.style.marginLeft = '0';
      el.style.marginRight = '2px';
    }
  }, []);
  return <div ref={ref} className="ctx-menu ctx-sub" role="menu">{children}</div>;
}

/** Menu contextuel positionné au curseur. Se ferme au clic extérieur, Échap, scroll. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [openSub, setOpenSub] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - r.width - 8);
    if (y + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const close = (e?: Event) => {
      if (e && e.type === 'scroll' && ref.current?.contains(e.target as Node)) return; // défilement interne d'un sous-menu long
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  function renderItems(list: MenuItem[], sub = false) {
    const Wrapper = sub ? SubMenu : MenuBox;
    return (
      <Wrapper>
        {list.map((it, i) => {
          if (it === 'separator') return <div key={i} className="ctx-sep" />;
          if (isSubmenu(it)) {
            return (
              <div
                key={i}
                className={`ctx-item ctx-has-sub${it.disabled ? ' ctx-disabled' : ''}`}
                role="menuitem"
                onMouseEnter={() => !sub && setOpenSub(i)}
              >
                <span>{it.label}</span>
                <span className="ctx-arrow">›</span>
                {!sub && openSub === i && !it.disabled && renderItems(it.items, true)}
              </div>
            );
          }
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`ctx-item${it.danger ? ' ctx-danger' : ''}${it.disabled ? ' ctx-disabled' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                if (it.disabled) return;
                it.onClick();
                onClose();
              }}
            >
              <span className="ctx-check">{it.check ? '✓' : ''}</span>
              <span>{it.label}</span>
            </button>
          );
        })}
      </Wrapper>
    );
  }

  return (
    <div ref={ref} className="ctx-root" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {renderItems(items)}
    </div>
  );
}
