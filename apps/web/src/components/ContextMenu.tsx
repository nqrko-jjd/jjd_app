'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem =
  | { label: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; check?: boolean }
  | { label: ReactNode; items: MenuItem[]; disabled?: boolean }
  | 'separator';

function isSubmenu(i: MenuItem): i is { label: ReactNode; items: MenuItem[]; disabled?: boolean } {
  return typeof i === 'object' && 'items' in i;
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
    const close = () => onClose();
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
    return (
      <div className={`ctx-menu${sub ? ' ctx-sub' : ''}`} role="menu">
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
      </div>
    );
  }

  return (
    <div ref={ref} className="ctx-root" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {renderItems(items)}
    </div>
  );
}
