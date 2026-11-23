import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Code, FileText, Folder, GitBranch, LoaderCircle, Minus, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { SourceIndexStatus } from '../../components/SourceIndexStatus';
import { readCheckDocuments } from '../check/CheckDocumentPicker';

const DOCUMENT_ACCEPT = '.md,.markdown,.txt,.pdf,.json,.csv,.yaml,.yml,.doc,.docx';
import { documentType, folderName } from '../../check/runner';
import type { RequirementTally } from '../../check/result';
import type { Artifact, ConnectedSource, Project, Requirement, RequirementCandidate } from '../../types';
import { userFacingError } from '../../utils/userFacingError';

/**
 * Managing a project from the expanded side panel (user decision, 16 Nov 2026),
 * in place of the older project and requirements pages: sources can be added,
 * synced and removed, and requirements come only from the project's documents.
 */

/** Asks the model to list requirements in each document; nothing is kept until a person keeps it. */
async function findRequirements(projectId: string, documents: Artifact[]): Promise<number> {
  let failed = 0;
  for (const document of documents) {
    try { await api.extractRequirementCandidates(projectId, document.id); } catch { failed += 1; }
  }
  return failed;
}

export function SourcesSection({ project, artifacts, onChanged }: { project: Project; artifacts: Artifact[]; onChanged(): void }) {
  const [connected, setConnected] = useState<ConnectedSource[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const documents = artifacts.filter(artifact => artifact.source === 'documents');
  const codeFiles = artifacts.filter(artifact => artifact.source === 'repository').length;
  const versionKey = artifacts.map(artifact => artifact.contentHash).sort().join(',');

  const loadConnected = useCallback(() => {
    if (typeof api.listConnectedSources !== 'function') return;
    api.listConnectedSources(project.id).then(setConnected).catch(() => undefined);
  }, [project.id]);
  useEffect(() => { loadConnected(); }, [loadConnected]);

  const run = async (key: string, work: () => Promise<string | null>, fallback: string) => {
    setBusy(key);
    setMessage(null);
    try { setMessage(await work()); onChanged(); }
    catch (cause) { setMessage(userFacingError(cause, fallback)); }
    finally { setBusy(null); }
  };

  const refreshFolder = () => run('folder', async () => {
    const result = await api.importRepoArtifacts(project.id, project.workspacePath!);
    return result.imported.length ? `${result.imported.length} file${result.imported.length === 1 ? '' : 's'} updated from the folder.` : 'The folder has no changes.';
  }, 'The folder could not be read. Check that it still exists.');

  const syncSource = (source: ConnectedSource) => run(`sync:${source.id}`, async () => {
    await api.syncConnectedSource(project.id, source.id, {});
    loadConnected();
    return `${source.name} is up to date.`;
  }, `${source.name} could not be synced. Try again.`);

  const addDocuments = (files: FileList) => run('add', async () => {
    const { accepted, message: notAdded } = await readCheckDocuments(Array.from(files, file => ({ file, path: file.webkitRelativePath || file.name })));
    const added: Artifact[] = [];
    for (const document of accepted) {
      added.push(await api.uploadArtifact(project.id, { fileName: document.name, content: document.base64, type: documentType(document.name) }));
    }
    const failed = added.length ? await findRequirements(project.id, added) : 0;
    const parts = [
      added.length ? `Added ${added.map(item => item.fileName).join(', ')}.` : '',
      added.length && !failed ? 'Requirements found in them are listed under Requirements.' : '',
      failed ? 'Requirements could not be read from every document. Use Find requirements to try again.' : '',
      notAdded ?? '',
    ];
    return parts.filter(Boolean).join(' ') || null;
  }, 'The documents could not be added. Try again.');

  const remove = (document: Artifact) => run(`remove:${document.id}`, async () => {
    await api.deleteArtifact(project.id, document.id);
    setConfirming(null);
    return `${document.fileName} was removed.`;
  }, `${document.fileName} could not be removed. Try again.`);

  return (
    <section aria-label="Sources" className="pc-manage">
      <h3>Sources</h3>
      <ul>
        {project.workspacePath
          ? <li><Icon icon={Folder} /><span title={project.workspacePath}>{folderName(project.workspacePath)}{codeFiles ? ` · ${codeFiles} files` : ''}</span>
              <button type="button" className="pc-unpin" disabled={!!busy} onClick={() => void refreshFolder()} aria-label="Look for changes in the folder" title="Look for changes in the folder"><Icon icon={busy === 'folder' ? LoaderCircle : RefreshCw} className={busy === 'folder' ? 'ci-spin' : undefined} /></button></li>
          : !connected.length && <li><Icon icon={Code} /><span>{codeFiles} code files</span></li>}
        {connected.map(source => (
          <li key={source.id}><Icon icon={GitBranch} /><span title={source.lastError ?? source.name}>{source.name}{source.syncStatus === 'error' ? ' · could not sync' : ''}</span>
            <button type="button" className="pc-unpin" disabled={!!busy} onClick={() => void syncSource(source)} aria-label={`Sync ${source.name}`} title={`Sync ${source.name}`}><Icon icon={busy === `sync:${source.id}` ? LoaderCircle : RefreshCw} className={busy === `sync:${source.id}` ? 'ci-spin' : undefined} /></button></li>
        ))}
        {documents.map(document => (
          <li key={document.id}>
            <Icon icon={FileText} /><span title={document.fileName}>{document.fileName}</span>
            {confirming === document.id ? (
              <span className="pc-confirm">
                <button type="button" className="ck-link is-danger" disabled={!!busy} onClick={() => void remove(document)}>Remove</button>
                <button type="button" className="ck-link" onClick={() => setConfirming(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="pc-unpin" disabled={!!busy} onClick={() => setConfirming(document.id)} aria-label={`Remove ${document.fileName}`} title={`Remove ${document.fileName}`}><Icon icon={Trash2} /></button>
            )}
          </li>
        ))}
      </ul>
      {confirming && <p className="pc-empty pc-manage-note">Removing a document deletes it from this project. Earlier reviews keep what they recorded.</p>}
      <input ref={fileInput} type="file" multiple hidden accept={DOCUMENT_ACCEPT} onChange={event => { if (event.target.files?.length) void addDocuments(event.target.files); event.target.value = ''; }} />
      <button type="button" className="ck-link pc-manage-add" disabled={!!busy} onClick={() => fileInput.current?.click()}><Icon icon={busy === 'add' ? LoaderCircle : Plus} className={busy === 'add' ? 'ci-spin' : undefined} />{busy === 'add' ? 'Adding…' : 'Add documents'}</button>
      <SourceIndexStatus projectId={project.id} sourceVersionKey={versionKey} />
      {message && <p className="pc-empty pc-manage-note" role="status">{message}</p>}
    </section>
  );
}

type Draft = { id: string; title: string; description: string };

/** What a requirement says and what checked it, shown when the row is hovered or focused. */
function RequirementDetail({ text, source, checkedBy }: { text?: string; source?: string; checkedBy: Array<{ name: string; state: string }> }) {
  if (!text && !source && !checkedBy.length) return null;
  return (
    <div className="pc-req-detail" role="tooltip">
      {text && <p>{text}</p>}
      {source && <p className="pc-req-source">From {source}</p>}
      {checkedBy.length > 0 && <p className="pc-req-source">Checked in the browser by {checkedBy.map(test => `“${test.name}” (${test.state})`).join(', ')}</p>}
    </div>
  );
}

export function RequirementsSection({ projectId, requirements, tally, documents, tests = [], onChanged }: {
  projectId: string; requirements: Requirement[]; tally: RequirementTally | null; documents: Artifact[];
  /** The latest full check's browser tests, to say which ones checked a requirement. */
  tests?: Array<{ name: string; state: string; requirementRef?: string | null }>; onChanged(): void;
}) {
  const [candidates, setCandidates] = useState<RequirementCandidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadCandidates = useCallback(() => {
    if (typeof api.listRequirementCandidates !== 'function') return;
    api.listRequirementCandidates(projectId, 'pending_confirmation').then(setCandidates).catch(() => undefined);
  }, [projectId]);
  useEffect(() => { loadCandidates(); }, [loadCandidates, documents.length]);

  const run = async (key: string, work: () => Promise<string | null>, fallback: string) => {
    setBusy(key);
    setMessage(null);
    try { setMessage(await work()); onChanged(); loadCandidates(); }
    catch (cause) { setMessage(userFacingError(cause, fallback)); }
    finally { setBusy(null); }
  };

  const find = () => run('find', async () => {
    const failed = await findRequirements(projectId, documents);
    return failed ? `Requirements could not be read from ${failed} of ${documents.length} documents.` : null;
  }, 'Requirements could not be read from the documents. Try again.');
  const keep = (candidate: RequirementCandidate) => run(`keep:${candidate.id}`, async () => { await api.confirmRequirementCandidate(projectId, candidate.id); return null; }, 'The requirement could not be kept. Try again.');
  const drop = (candidate: RequirementCandidate) => run(`drop:${candidate.id}`, async () => { await api.rejectRequirementCandidate(projectId, candidate.id); return null; }, 'The requirement could not be dropped. Try again.');
  const save = (value: Draft) => run(`save:${value.id}`, async () => {
    await api.updateRequirement(projectId, value.id, { title: value.title.trim(), description: value.description.trim() });
    setDraft(null);
    return null;
  }, 'The requirement could not be saved. Try again.');
  const remove = (requirement: Requirement) => run(`remove:${requirement.id}`, async () => {
    await api.deleteRequirement(projectId, requirement.id);
    setConfirming(null);
    return `${requirement.title} was removed.`;
  }, 'The requirement could not be removed. Try again.');

  const norm = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const checkedBy = (title: string) => tests.filter(test => test.requirementRef && (norm(title) === norm(test.requirementRef) || norm(title).startsWith(norm(test.requirementRef))) && ['passed', 'failed'].includes(test.state))
    .map(test => ({ name: test.name, state: test.state }));
  const tested = tally ? [...tally.notMetNames, ...(tally.metNames ?? [])] : [];
  const stateOf = (title: string) => tally?.notMetNames.includes(title) ? 'not met' : tally?.metNames?.includes(title) ? 'met' : 'not checked';
  const heading = tally && tally.total > 0 ? `Requirements · ${tally.notMet} of ${tally.total} not met` : 'Requirements';

  return (
    <section aria-label="Requirements" className="pc-manage">
      <h3>{heading}</h3>
      {requirements.length > 0 && (
        <ul>
          {requirements.map(requirement => {
            if (draft?.id === requirement.id) {
              return (
                <li key={requirement.id} className="pc-manage-edit">
                  <form onSubmit={event => { event.preventDefault(); if (draft.title.trim()) void save(draft); }}>
                    <label className="ck-visually-hidden" htmlFor={`req-title-${requirement.id}`}>Requirement</label>
                    <input id={`req-title-${requirement.id}`} value={draft.title} maxLength={240} autoFocus onChange={event => setDraft({ ...draft, title: event.target.value })} />
                    <label className="ck-visually-hidden" htmlFor={`req-text-${requirement.id}`}>Details</label>
                    <textarea id={`req-text-${requirement.id}`} rows={3} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
                    <span className="pc-confirm">
                      <button type="submit" className="ck-button is-small is-primary" disabled={!draft.title.trim() || !!busy}>Save</button>
                      <button type="button" className="ck-button is-small" onClick={() => setDraft(null)}>Cancel</button>
                    </span>
                  </form>
                </li>
              );
            }
            const state = stateOf(requirement.title);
            return (
              <li key={requirement.id} className="pc-req" tabIndex={0} aria-label={`${requirement.title}: ${state}`}>
                {state === 'not met' ? <Icon icon={X} className="pc-bad" /> : state === 'met' ? <Icon icon={Check} /> : <Icon icon={Minus} />}
                <span>{requirement.title}</span>
                <RequirementDetail text={requirement.description || `${state[0].toUpperCase()}${state.slice(1)}.`} checkedBy={checkedBy(requirement.title)} />
                {confirming === requirement.id ? (
                  <span className="pc-confirm">
                    <button type="button" className="ck-link is-danger" disabled={!!busy} onClick={() => void remove(requirement)}>Remove</button>
                    <button type="button" className="ck-link" onClick={() => setConfirming(null)}>Keep</button>
                  </span>
                ) : <>
                  <button type="button" className="pc-unpin" onClick={() => { setConfirming(null); setDraft({ id: requirement.id, title: requirement.title, description: requirement.description }); }} aria-label={`Edit ${requirement.title}`} title="Edit"><Icon icon={Pencil} /></button>
                  <button type="button" className="pc-unpin" onClick={() => { setDraft(null); setConfirming(requirement.id); }} aria-label={`Remove ${requirement.title}`} title="Remove"><Icon icon={Trash2} /></button>
                </>}
              </li>
            );
          })}
        </ul>
      )}
      {!requirements.length && tested.length > 0 && <>
        {/* No saved records: these IDs were named by browser tests that read the project folder's own documents. */}
        <ul>
          {tested.map(name => (
            <li key={name} className="pc-req" tabIndex={0} aria-label={`${name}: ${tally?.notMetNames.includes(name) ? 'not met' : 'met'}`}>{tally?.notMetNames.includes(name) ? <Icon icon={X} className="pc-bad" /> : <Icon icon={Check} />}<span>{name}</span>
              <RequirementDetail text={tally?.notMetNames.includes(name) ? 'Not met.' : 'Met.'} checkedBy={checkedBy(name)} /></li>
          ))}
        </ul>
        <p className="pc-empty pc-manage-note">Named in the project folder's documents and checked by browser tests. Add the document under Sources to keep and edit them.</p>
      </>}
      {candidates.length > 0 && <>
        <p className="pc-manage-sub">Found in your documents · {candidates.length}</p>
        <ul>
          {candidates.map(candidate => (
            <li key={candidate.id} className="pc-req" tabIndex={0} aria-label={candidate.title}>
              <Icon icon={FileText} />
              <span>{candidate.title}</span>
              <RequirementDetail text={candidate.statement} source={candidate.sourceLocator?.filePath ? `${candidate.sourceLocator.filePath}${candidate.sourceLocator.lineStart ? `, line ${candidate.sourceLocator.lineStart}` : ''}` : undefined} checkedBy={[]} />
              <button type="button" className="pc-unpin" disabled={!!busy} onClick={() => void keep(candidate)} aria-label={`Keep ${candidate.title}`} title="Keep"><Icon icon={Check} /></button>
              <button type="button" className="pc-unpin" disabled={!!busy} onClick={() => void drop(candidate)} aria-label={`Drop ${candidate.title}`} title="Drop"><Icon icon={X} /></button>
            </li>
          ))}
        </ul>
      </>}
      {!requirements.length && !candidates.length && !tested.length && (
        <p className="pc-empty">{documents.length ? 'No requirements kept from your documents.' : 'No document lists requirements, so there are none. Add a document under Sources.'}</p>
      )}
      {documents.length > 0 && (
        <button type="button" className="ck-link pc-manage-add" disabled={!!busy} onClick={() => void find()}>
          <Icon icon={busy === 'find' ? LoaderCircle : Search} className={busy === 'find' ? 'ci-spin' : undefined} />{busy === 'find' ? 'Reading the documents…' : 'Find requirements in the documents'}
        </button>
      )}
      {message && <p className="pc-empty pc-manage-note" role="status">{message}</p>}
    </section>
  );
}
