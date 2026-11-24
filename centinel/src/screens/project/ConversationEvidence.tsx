import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { SavedConversationExplanation } from '../../check/conversationTypes';

function BrowserSnapshot({ projectId, runId, test }: { projectId: string; runId: string; test: string }) {
  const [image, setImage] = useState<string>();
  const [status, setStatus] = useState<'idle' | 'loading' | 'missing' | 'unavailable'>('idle');
  const mounted = useRef(false);
  const url = useRef<string>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  const load = async () => {
    setStatus('loading');
    try {
      const runs = await api.dynamicRuns(projectId);
      const run = runs.find(item => item.id === runId);
      const snapshot = run?.evidence.find(item => item.kind === 'screenshot');
      if (!snapshot) {
        if (mounted.current) setStatus(run ? 'missing' : 'unavailable');
        return;
      }
      const copies = await api.dynamicEvidenceCopies(projectId, runId).catch(() => []);
      const shared = copies.find(copy => copy.evidenceId === snapshot.id && copy.availability === 'available');
      const local = () => api.dynamicRecordedEvidenceBlob(projectId, runId, snapshot.id, 'local');
      const blob = shared ? await api.dynamicRecordedEvidenceBlob(projectId, runId, shared.id, 'shared').catch(local) : await local();
      if (!/^image\/(?:png|jpeg|webp)$/i.test(blob.type) || !blob.size) throw new Error('Unexpected screenshot response');
      if (!mounted.current) return;
      url.current = URL.createObjectURL(blob);
      setImage(url.current);
    } catch {
      if (mounted.current) setStatus('unavailable');
    }
  };
  if (image) return <figure className="pc-snapshot"><img src={image} alt={`Saved Browser snapshot for ${test}`} onError={() => { setImage(undefined); setStatus('unavailable'); if (url.current) URL.revokeObjectURL(url.current); url.current = undefined; }} /><figcaption>{test}</figcaption></figure>;
  if (status === 'missing') return <p className="pc-label">No snapshot was recorded for {test}.</p>;
  return <div>
    {status === 'unavailable' && <p role="status">The saved snapshot for {test} is unavailable on this device.</p>}
    <button type="button" className="ck-link" disabled={status === 'loading'} onClick={() => void load()}>
      {status === 'loading' ? 'Loading snapshot…' : `Show snapshot for ${test}`}
    </button>
  </div>;
}

export function ConversationEvidence({ explanation, projectId }: { explanation: SavedConversationExplanation; projectId: string }) {
  return <div className="pc-inline-evidence">
    {explanation.sections.map((section, index) => <section key={section.evidenceId ?? index} className="pc-evidence-section" aria-label={section.title}>
      <h3>{section.title}</h3>
      {section.summary && <p>{section.summary}</p>}
      {!!section.facts?.length && <div className="pc-table-scroll"><table aria-label={`Saved facts for ${section.title}`}><tbody>
        {section.facts.map(({ label, value }, index) => <tr key={index}><th scope="row">{label}</th><td>{value}</td></tr>)}
      </tbody></table></div>}
      {section.excerpt && <figure><figcaption>Saved source excerpt</figcaption><pre><code>{section.excerpt}</code></pre></figure>}
      {section.sourceWindow && <figure><figcaption>Frozen source near recorded line {section.sourceWindow.citedLine} · starts at line {section.sourceWindow.firstLine}</figcaption>
        <pre><code>{section.sourceWindow.text}</code></pre></figure>}
      {!!section.points?.length && <ul>{section.points.map((point, index) => <li key={index}>{point}</li>)}</ul>}
      {!!section.checks?.length && <>
        <div className="pc-table-scroll"><table aria-label={`Saved Browser assertions for ${section.title}`}>
          <thead><tr>{['Test', 'Assertion', 'Expected', 'Observed', 'Verdict'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{section.checks.map((check, index) => <tr key={index}><th scope="row">{check.test}</th><td>{check.check}</td>
            <td>{check.expected || 'Unavailable'}</td><td>{check.observed || 'Unavailable'}</td><td>{check.verdict}</td></tr>)}</tbody>
        </table></div>
        {[...new Map(section.checks.flatMap(check => check.runId ? [[check.runId, check.test]] : [])).entries()]
          .map(([runId, test]) => <BrowserSnapshot key={runId} projectId={projectId} runId={runId} test={test} />)}
      </>}
      {!!section.limitations?.length && <ul>{section.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul>}
    </section>)}
    {explanation.hasMore && <p>Select an individual attachment for more detail.</p>}
  </div>;
}
