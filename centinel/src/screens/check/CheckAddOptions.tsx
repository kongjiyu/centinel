import { useLayoutEffect, useRef, useState } from 'react';
import { FileText, GitBranch, Plus } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { CheckSourceChoice } from './CheckSourceLibrary';

export function SourceActions({ onChoose, labelled = false }: { onChoose: (choice: CheckSourceChoice) => void; labelled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [fitBelow, setFitBelow] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || labelled) return;
    const fit = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (anchor && panel.current) setFitBelow(anchor.right + panel.current.offsetWidth > window.innerWidth - 8);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, labelled]);

  return <div className={'ck-source-actions' + (labelled ? ' is-labelled' : '')} onPointerEnter={event => {
    if (event.pointerType === 'mouse') setOpen(true);
  }} onPointerLeave={event => {
    if (event.pointerType === 'mouse' && !event.currentTarget.contains(document.activeElement)) setOpen(false);
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  }}>
    <button ref={trigger} type="button" className={labelled ? undefined : 'ck-round'} aria-label="Add source" aria-expanded={open} onClick={event => {
      if (event.detail) setOpen(true); else setOpen(value => !value);
    }}><Icon icon={Plus} />{labelled && 'Add source'}</button>
    {open && <div ref={panel} className="ck-source-actions-panel" data-fit-below={!labelled && fitBelow || undefined} role="group" aria-label="Source actions">
      <button type="button" onClick={() => { setOpen(false); onChoose('documents'); }}>Add documents</button>
      <button type="button" onClick={() => { setOpen(false); onChoose('repository'); }}>Add repository</button>
    </div>}
  </div>;
}

export function CheckAddOptions({ query, onDocument, onRepository, onSource }: {
  query: string;
  onDocument: () => void;
  onRepository?: () => void;
  onSource?: (choice: CheckSourceChoice) => void;
}) {
  const documents = 'add document'.includes(query);
  const repository = 'add repository'.includes(query);
  const sources = !!onSource && (repository || 'add source'.includes(query));
  if (!documents && !(repository && onRepository) && !sources) return null;
  return <section aria-label="Add">
    <h2>Add</h2>
    {documents && <button type="button" onClick={onDocument}><Icon icon={FileText} />Add Document</button>}
    {repository && onRepository && <button type="button" onClick={onRepository}><Icon icon={GitBranch} />Add Repository</button>}
    {sources && <SourceActions labelled onChoose={onSource} />}
  </section>;
}
