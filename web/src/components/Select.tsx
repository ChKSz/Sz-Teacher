import { useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface SelectOption { value: string; label: string; description?: string }

/** 统一选择菜单：顶层浮窗避免被滚动容器裁切，支持搜索和键盘选择。 */
export function Select({ label, value, options, onChange, disabled, compact = false, placeholder = '请选择' }: {
  label: string; value: string; options: SelectOption[]; onChange: (value: string) => void;
  disabled?: boolean; compact?: boolean; placeholder?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const filtered = options.filter((item) => `${item.label} ${item.value}`.toLowerCase().includes(query.toLowerCase()));
  const selected = options.find((item) => item.value === value);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (next: string) => { onChange(next); close(); };

  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, compact ? 280 : 240), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom;
    const above = below < Math.min(380, options.length * 58 + 48) && rect.top > below;
    setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      maxHeight: Math.min(380, (above ? rect.top : below) - 20) });
    popup.current?.showPopover();
    const field = popup.current?.querySelector<HTMLInputElement>('input');
    (field ?? popup.current)?.focus({ preventScroll: true });
    const hide = () => setOpen(false);
    window.addEventListener('resize', hide);
    return () => window.removeEventListener('resize', hide);
  }, [open, compact, options.length]);

  useEffect(() => { popup.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % Math.max(1, filtered.length));
    } else if (event.key === 'Home' && event.target === popup.current) { event.preventDefault(); setActive(0); }
    else if (event.key === 'End' && event.target === popup.current) { event.preventDefault(); setActive(filtered.length - 1); }
    else if (event.key === 'Enter' && filtered[active]) { event.preventDefault(); choose(filtered[active]!.value); }
    else if (event.key === 'Tab') setOpen(false);
  };
  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      className={`select-trigger ${compact ? 'compact' : ''}`} disabled={disabled}
      onClick={() => { setQuery(''); setActive(Math.max(0, options.findIndex((item) => item.value === value))); setOpen(!open); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setQuery(''); setActive(Math.max(0, options.findIndex((item) => item.value === value))); setOpen(true); } }}>
      <span>{selected?.label || value || placeholder}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popup} popover="auto" className="select-popup" style={position} tabIndex={-1} onKeyDown={onKey}
      onToggle={(event) => { if (event.newState === 'closed') setOpen(false); }}>
      <div className="select-caption">{label}</div>
      {options.length > 7 && <label className="select-search"><Search size={14} /><input aria-label={`搜索${label}`} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder="输入名称搜索" /></label>}
      <div role="listbox" aria-label={label} id={id} className="select-options" aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}>
        {filtered.map((item, index) => <button key={item.value} type="button" role="option" aria-selected={item.value === value} tabIndex={-1}
          id={`${id}-${index}`} data-index={index} className={`select-option ${index === active ? 'highlighted' : ''}`} onPointerMove={() => setActive(index)} onClick={() => choose(item.value)}>
          <span><span className="option-label">{item.label}</span>{item.description && <small>{item.description}</small>}</span>
          {item.value === value && <Check size={15} aria-hidden="true" />}
        </button>)}
        {!filtered.length && <p className="select-empty">没有匹配的选项</p>}
      </div>
    </div>, trigger.current?.closest('[popover], dialog') ?? document.body)}
  </>;
}
