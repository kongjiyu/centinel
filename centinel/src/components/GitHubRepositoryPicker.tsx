import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ConnectedSourceBrowsePage } from '../types';
import { userFacingError } from '../utils/userFacingError';

export function GitHubRepositoryPicker({ onSelect }: { onSelect: (url: string) => void }) {
  const [page, setPage] = useState<ConnectedSourceBrowsePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setError(null);
    void api.browseConnectedSources('github', { pageSize: 50, cursor })
      .then(next => { if (active) setPage(previous => ({ ...next, items: [...(previous?.items ?? []), ...next.items] })); })
      .catch(cause => { if (active) setError(userFacingError(cause, 'Could not load GitHub repositories. Check the GitHub connection in Settings.')); });
    return () => { active = false; };
  }, [cursor]);

  return (
    <div className="project-account-repositories">
      {error ? <p role="alert">{error}</p> : !page ? <p role="status">Loading GitHub repositories…</p> : (
        <>
          <ul className="project-source-list">
            {page.items.filter(item => item.kind === 'repository').map(item => (
              <li key={item.id}><button type="button" className="btn-link" onClick={() => onSelect(item.remoteUrl ?? `https://github.com/${item.id}`)}>{item.name}</button></li>
            ))}
          </ul>
          {!page.items.length && <p>No repositories found.</p>}
          {page.nextCursor && <button type="button" className="btn-secondary" disabled={cursor === page.nextCursor} onClick={() => setCursor(page.nextCursor ?? undefined)}>Load more repositories</button>}
        </>
      )}
    </div>
  );
}
