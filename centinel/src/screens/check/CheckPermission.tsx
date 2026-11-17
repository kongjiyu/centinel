import { useEffect, useId, useRef, useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { MODE_LABEL, type PermissionMode } from '../../check/projectPrefs';

const options = [
  { value: 'ask', label: MODE_LABEL.ask, description: 'Asks before running or changing anything' },
  { value: 'auto', label: MODE_LABEL.auto, description: 'Runs and saves tests; asks before changing settings' },
  { value: 'bypass', label: MODE_LABEL.bypass, description: 'Does everything except deleting' },
] as const;

export function CheckPermission({ value, onChange }: { value: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const clearTimer = () => clearTimeout(timer.current);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) { clearTimer(); setOpen(false); }
    };
    document.addEventListener('pointerdown', outside);
    return () => { clearTimer(); document.removeEventListener('pointerdown', outside); };
  }, []);
  return <div className="ck-project-permission" ref={wrapper}
    onPointerEnter={event => {
      if (event.pointerType === 'mouse') { clearTimer(); timer.current = setTimeout(() => setOpen(true), 100); }
    }}
    onPointerLeave={() => { clearTimer(); timer.current = setTimeout(() => setOpen(false), 130); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { clearTimer(); setOpen(false); } }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); clearTimer(); setOpen(false); trigger.current?.focus(); }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      if (!open) { clearTimer(); setOpen(true); return; }
      const items = Array.from(wrapper.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    <button type="button" className="select-trigger" role="combobox" aria-label="Project conversation permission"
      aria-controls={listId} aria-expanded={open} aria-haspopup="listbox" ref={trigger}
      onClick={() => { clearTimer(); setOpen(true); }}>
      <Icon icon={ShieldCheck} />{MODE_LABEL[value]}
    </button>
    {open && <div className="ck-permission-menu" id={listId} role="listbox" aria-label="Permission mode">
      {options.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.value}
        onClick={() => { clearTimer(); onChange(option.value); setOpen(false); trigger.current?.focus(); }}>
        <span className="ck-permission-mark">{option.value === value && <Icon icon={Check} />}</span>
        <span><strong>{option.label}</strong><small>{option.description}</small></span>
      </button>)}
    </div>}
  </div>;
}
