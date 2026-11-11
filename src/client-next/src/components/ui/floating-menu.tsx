'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface FloatingMenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface FloatingMenuProps {
  open: boolean;
  /** Anchor coordinates (viewport pixels), typically from the cursor. */
  x: number;
  y: number;
  items: FloatingMenuItem[];
  onClose: () => void;
}

/**
 * A fixed-position context menu (legacy `.tree-node-menu`): opens at the
 * given viewport point, clamped to the window edge, closes on outside
 * click or Escape. No shadcn equivalent exists, hence custom.
 */
export function FloatingMenu({ open, x, y, items, onClose }: FloatingMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let nx = x;
    let ny = y;
    if (nx + mw > window.innerWidth - 8) nx = window.innerWidth - mw - 8;
    if (ny + mh > window.innerHeight - 8) ny = window.innerHeight - mh - 8;
    setPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
  }, [open, x, y]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      data-floating-menu
      className="fixed z-[90] min-w-36 rounded-md border border-border/60 bg-popover p-1 text-sm text-popover-foreground shadow-lg"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          className={
            'block w-full rounded px-3 py-1.5 text-left transition-colors disabled:opacity-50 ' +
            (item.danger
              ? 'text-red-400 hover:bg-accent'
              : 'hover:bg-accent')
          }
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Hook: track outside pointer-downs + Escape to close an open menu. */
export function useMenuDismiss(open: boolean, onClose: () => void) {
  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-floating-menu]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
}
