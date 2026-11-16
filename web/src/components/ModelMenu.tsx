import { useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import type { PublicSettings, SettingsUpdate } from '../../../shared/types.ts';
import { EFFORT_OPTIONS, STYLE_OPTIONS } from '../../../shared/preferences.ts';

/** 输入框内的统一选择菜单，所有选择即时保存到服务端。 */
export function ModelMenu({ settings, busy, onChange, onSettings }: {
  settings: PublicSettings | null; busy: boolean; onChange: (patch: SettingsUpdate) => Promise<boolean>; onSettings: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const effort = EFFORT_OPTIONS.find((item) => item.value === settings?.reasoningEffort)?.label ?? '默认';
  const models = [...new Set([settings?.solveModel, ...(settings?.models ?? [])].filter((m): m is string => !!m))];
  useLayoutEffect(() => {
    if (open && popup.current && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      Object.assign(popup.current.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`, bottom: `${window.innerHeight - rect.top + 10}px`, maxHeight: `${Math.max(180, rect.top - 24)}px` });
      popup.current.showPopover();
      popup.current.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    } else popup.current?.hidePopover();
  }, [open]);
  return <div className="model-menu">
    <button ref={trigger} className="model-menu-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} aria-label="模型与讲解设置" disabled={busy || !settings}
      onClick={() => { setQuery(''); setOpen(!open); }}>
      <span>{settings?.solveModel || '选择模型'}</span><small>{effort}</small><ChevronDown size={14} />
    </button>
    <div ref={popup} popover="auto" className="model-menu-popup" role="dialog" aria-label="模型与讲解设置" onToggle={(event) => { if (event.newState === 'closed') setOpen(false); }}>
      <div className="select-caption">选择模型</div>
      {models.length > 5 && <label className="select-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" aria-label="搜索模型" /></label>}
      <div className="model-options" role="group" aria-label="可用模型">
        {models.filter((model) => model.toLowerCase().includes(query.toLowerCase())).map((model) => <button key={model} className="select-option" disabled={busy} aria-pressed={model === settings?.solveModel}
          onClick={() => void onChange({ solveModel: model })}><span>{model}</span>{model === settings?.solveModel && <Check size={15} />}</button>)}
        {!models.length && <p className="select-empty">先在高级配置中获取模型列表</p>}
      </div>
      <div className="model-menu-section"><span>思考强度</span><div className="choice-grid" role="group" aria-label="思考强度">
        {EFFORT_OPTIONS.map((item) => <button key={item.value} disabled={busy} title={item.description} aria-pressed={item.value === settings?.reasoningEffort} onClick={() => void onChange({ reasoningEffort: item.value as PublicSettings['reasoningEffort'] })}>{item.label}</button>)}
      </div></div>
      <div className="model-menu-section"><span>讲解方式</span><div className="choice-grid teaching" role="group" aria-label="讲解方式">
        {STYLE_OPTIONS.map((item) => <button key={item.value} disabled={busy} title={item.description} aria-pressed={item.value === settings?.teachingStyle} onClick={() => void onChange({ teachingStyle: item.value as PublicSettings['teachingStyle'] })}>{item.label}</button>)}
      </div></div>
      <button className="model-settings-link" onClick={() => { setOpen(false); onSettings(); }}><SlidersHorizontal size={14} />管理模型与语音</button>
    </div>
  </div>;
}
