import { useEffect, useRef, useState } from 'react';
import { Book, Lock, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import type { ConnectedSourceBrowsePage } from '../types';
import { userFacingError } from '../utils/userFacingError';

export function GitHubRepositoryPicker({ selection, onSelect }: {
  selection: string;
  onSelect: (url: string) => void;
}) {
  const [page, setPage] = useState<ConnectedSourceBrowsePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const results = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void api.browseConnectedSources('github', { pageSize: 50, cursor, query: query.trim() || undefined })
        .then(next => {
          if (!active) return;
          setPage(previous => cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
        })
        .catch(cause => {
          if (active) setError(userFacingError(cause, 'Could not load GitHub repositories. Check the GitHub connection in Settings.'));
        })
        .finally(() => { if (active) setLoading(false); });
    }, query && !cursor ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [cursor, query, refresh]);

  const resetResults = () => {
    setPage(null);
    setError(null);
    setCursor(undefined);
    setLoading(true);
    onSelect('');
    if (results.current) results.current.scrollTop = 0;
  };
  const repositories = page?.items.filter(item => item.kind === 'repository') ?? [];

  return (
    <div className="project-account-repositories">
      <div className="project-repository-tools">
        <input type="search" aria-label="Filter your repositories" placeholder="Filter your repositories" value={query}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => {
          resetResults();
          setQuery(event.target.value);
        }} />
        <button type="button" className="btn-secondary" aria-label="Refresh repositories" title="Refresh repositories" onClick={() => {
          resetResults();
          setRefresh(value => value + 1);
        }}><RefreshCw size={16} aria-hidden="true" /></button>
      </div>
      <strong>Your repositories</strong>
      <div className="project-repository-results" ref={results} aria-busy={loading}>
        {repositories.length > 0 && <ul aria-label="GitHub repositories">
          {repositories.map(item => {
            const url = item.remoteUrl ?? 'https://github.com/' + item.id;
            const privateRepo = item.metadata?.private === true;
            const ItemIcon = privateRepo ? Lock : Book;
            return <li key={item.id}><button type="button" aria-pressed={selection === url}
              aria-label={privateRepo ? item.name + ' (private)' : undefined} onClick={() => onSelect(url)}>
              <ItemIcon size={16} aria-hidden="true" />
              <span>{item.name}</span>
            </button></li>;
          })}
        </ul>}
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Loading GitHub repositories…</p>}
        {!loading && !error && !repositories.length && <p>{page?.nextCursor ? 'No matches on this page.' : query ? 'No matching repositories.' : 'No repositories found.'}</p>}
        {page?.nextCursor && !error && <button type="button" className="btn-secondary" disabled={loading} onClick={() => {
          setLoading(true);
          setCursor(page.nextCursor ?? undefined);
        }}>Load more repositories</button>}
      </div>
    </div>
  );
}
