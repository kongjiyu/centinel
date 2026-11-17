import { Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';

export type ComposerNotice = { title: string; description: ReactNode; tone: 'critical' | 'warning' | 'info'; action?: { label: string; run: () => void } };

export function CheckComposerNotices({ notices, covered = false }: { notices: ComposerNotice[]; covered?: boolean }) {
  if (!notices.length) return null;
  return <aside className="ck-composer-notices" aria-label="Check setup notices" data-covered={covered || undefined}>
    {notices.map(({ title, description, tone, action }) => <div key={title} className={'ck-composer-notice is-' + tone}>
      <Icon icon={tone === 'critical' ? OctagonAlert : tone === 'warning' ? TriangleAlert : Info} />
      <div><strong>{title}</strong><p role="status">{description}</p></div>
      {action && <button type="button" className="ck-link" onClick={action.run}>{action.label}</button>}
    </div>)}
  </aside>;
}
