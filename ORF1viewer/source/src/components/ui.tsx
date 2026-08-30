import React from 'react';

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
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn-ghost ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Badge({
  label,
  value,
  tone = 'default',
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info';
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: 'border-slate-700/70 bg-slate-900/60 text-slate-300',
    good: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-300',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    bad: 'border-rose-600/40 bg-rose-600/10 text-rose-300',
    info: 'border-sky-600/40 bg-sky-600/10 text-sky-300',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-baseline gap-1 whitespace-nowrap rounded-md border px-2 py-[3px] text-[11px] ${tones[tone]}`}
    >
      <span className="text-slate-500">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </span>
  );
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`spin inline-block rounded-full border-2 border-slate-600 border-t-sky-400 ${className}`}
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  );
}

export function PhaseIcon({ phase }: { phase: 'idle' | 'loading' | 'ready' | 'error' }) {
  if (phase === 'loading') return <Spinner size={11} />;
  if (phase === 'ready') return <span className="text-emerald-400">●</span>;
  if (phase === 'error') return <span className="text-rose-400">●</span>;
  return <span className="text-slate-600">○</span>;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: React.ReactNode; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  // wraps instead of scrolling so every tab (incl. “Reference tree”) stays visible
  // when the right panel is narrow or the split has been dragged
  return (
    <div role="tablist" className="flex min-w-0 flex-wrap items-center gap-1">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`relative whitespace-nowrap rounded-t-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
            value === it.id
              ? 'bg-slate-800/80 text-sky-200 shadow-inner shadow-black/20'
              : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {it.icon}
            {it.label}
          </span>
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
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-slate-300"
    >
      <span
        className={`relative inline-block h-[14px] w-[24px] rounded-full transition-colors ${
          checked ? 'bg-sky-500/70' : 'bg-slate-700'
        }`}
      >
        <span
          className="absolute top-[2px] block h-[10px] w-[10px] rounded-full bg-slate-100 transition-all"
          style={{ left: checked ? 12 : 2 }}
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
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`rounded-md border border-slate-700 bg-slate-900/80 px-1.5 py-1 text-[12px] text-slate-200 outline-none hover:border-slate-500 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Panel({
  title,
  right,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card flex min-h-0 flex-col ${className}`}>
      {(title || right) && (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
          <h3 className="truncate text-[12px] font-semibold text-slate-200">{title}</h3>
          <div className="flex shrink-0 items-center gap-1.5">{right}</div>
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2 border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-[12px] text-rose-200">
      <span className="mt-[2px]">⚠</span>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message}</div>
      {onClose && (
        <button className="text-rose-300 hover:text-white" onClick={onClose} aria-label="dismiss">
          ×
        </button>
      )}
    </div>
  );
}

export function KeyCap({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}

export function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
      <span
        className="inline-block h-2.5 w-2.5 rounded-[3px] border border-black/40"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
