import React, { useEffect, useRef, useState } from 'react';

export function Btn({
  active,
  className = '',
  title,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      data-active={active ? 'true' : 'false'}
      className={`btn ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostBtn({
  active,
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button type="button" data-active={active ? 'true' : 'false'} className={`btn-ghost ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Square icon button; `label` is both the tooltip and the accessible name. */
export function IconBtn({
  icon,
  label,
  active,
  className = '',
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & { icon: IconName; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-active={active ? 'true' : 'false'}
      className={`btn-icon ${className}`}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/** A number with a small label underneath-the-eye: used for model scores. */
export function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'good' | 'warn' | 'bad';
  title?: string;
}) {
  const dot = tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : tone === 'bad' ? 'bg-danger' : null;
  return (
    <span title={title} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="inline-flex items-center gap-1 text-[14px] font-semibold text-fg">
        {dot && <span className={`inline-block h-[7px] w-[7px] rounded-full ${dot}`} aria-hidden />}
        {value}
      </span>
    </span>
  );
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`spin inline-block rounded-full border-2 border-line-strong border-t-fg ${className}`}
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: React.ReactNode; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex min-w-0 items-stretch gap-4">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          title={it.hint}
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`-mb-px whitespace-nowrap border-b-2 py-2.5 text-[13px] transition-colors ${
            value === it.id ? 'border-fg font-semibold text-fg' : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Segmented control: one choice among a few, all visible. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 items-center rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={`h-full whitespace-nowrap rounded-[4px] px-2 text-[12px] transition-colors ${
            value === o.value ? 'bg-fg text-on-fg' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  title?: string;
}) {
  return (
    <label
      title={title}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className="inline-flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-fg"
    >
      <span
        className={`relative inline-block h-[16px] w-[28px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-fg' : 'bg-line-strong'
        }`}
      >
        <span
          className="absolute top-[2px] block h-[12px] w-[12px] rounded-full bg-surface transition-all"
          style={{ left: checked ? 14 : 2 }}
        />
      </span>
      {label}
    </label>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  title,
  className = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  title?: string;
  className?: string;
}) {
  return (
    <select
      title={title}
      aria-label={title}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`field pr-1 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Button + floating panel. Closes on outside click and Escape. `align` picks the
 * edge of the trigger the panel hangs from; `up` opens above it (for bars at the
 * bottom of the screen).
 */
export function Popover({
  trigger,
  children,
  align = 'left',
  up = false,
  panelClassName = '',
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: 'left' | 'right';
  up?: boolean;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={box} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`popover absolute z-40 min-w-[13rem] p-1.5 ${align === 'right' ? 'right-0' : 'left-0'} ${
            up ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          } ${panelClassName}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** A row inside a Popover menu. */
export function MenuItem({
  icon,
  children,
  hint,
  onClick,
  href,
  disabled,
}: {
  icon?: IconName;
  children: React.ReactNode;
  hint?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const cls =
    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-fg hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent';
  const body = (
    <>
      {icon ? <span className="text-muted"><Icon name={icon} size={15} /></span> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {hint && <span className="shrink-0 text-[11.5px] text-muted">{hint}</span>}
    </>
  );
  if (href)
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {body}
      </a>
    );
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[11.5px] text-muted first:pt-1">{children}</div>;
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />;
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/40 px-3 py-2 text-[12.5px] text-danger">
      <span className="mt-[1px]"><Icon name="alert" size={15} /></span>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message}</div>
      {onClose && (
        <button className="hover:text-fg" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function KeyCap({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}

// ------------------------------------------------------------------- icons
/* Lucide-style 24px strokes, drawn inline so the app keeps zero icon deps. */
const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41',
  moon: 'M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6Z',
  link: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-2.6 7a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4m0 3h.01',
  settings:
    'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M16 4v4M10 10v4M18 16v4',
  more: 'M5 10.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm7 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm7 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
  focus: 'M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3m8-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  spin: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h4M6 22v-4H2',
  camera: 'M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm8 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  panels: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm11 0v16',
  x: 'M18 6 6 18M6 6l12 12',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3',
  external: 'M14 4h6v6m0-6-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm6 15 6-6 6 6',
  sequence: 'M4 7h16M4 12h10M4 17h13',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35M8 11h6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  image: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM21 15l-5-5L5 20',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01',
  check: 'm5 12 5 5 9-10',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M16 4v4M10 10v4M18 16v4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
