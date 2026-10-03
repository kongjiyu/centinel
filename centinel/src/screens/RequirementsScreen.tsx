import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit, ChevronDown, ChevronUp, Link, FileText, Activity, Check, X, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader, IconButton, StatusBadge, type StatusTone } from '../components/CommandUI';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
import type { Requirement, RequirementMapping, Artifact, RequirementCandidate, Screen, StandardRule } from '../types';
import { userFacingError } from '../utils/userFacingError';

type Props = { projectId: string; onNavigate: (screen: Screen) => void };

const CATEGORIES = ['functional', 'non-functional', 'security', 'performance', 'usability', 'other'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const COVERAGE_STATUSES = ['implemented', 'partial', 'missing', 'unknown'];

type EditingRequirement = { id: string; title: string; description: string; category: string; priority: string };

export function RequirementsScreen({ projectId, onNavigate }: Props) {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EditingRequirement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, RequirementMapping[]>>({});
  const [showMapForm, setShowMapForm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState('functional');
  const [formPriority, setFormPriority] = useState('medium');
  const [mapFileId, setMapFileId] = useState('');
  const [mapCoverage, setMapCoverage] = useState('unknown');
  const [mapConfidence, setMapConfidence] = useState(0);
  const [requirementToDelete, setRequirementToDelete] = useState<Requirement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [candidates, setCandidates] = useState<RequirementCandidate[]>([]);
  const [standardRules, setStandardRules] = useState<StandardRule[]>([]);
  const [candidateArtifactId, setCandidateArtifactId] = useState('');
  const [standardArtifactId, setStandardArtifactId] = useState('');
  const [groundingBusy, setGroundingBusy] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [reqs, arts, nextCandidates, nextRules] = await Promise.all([
        api.listRequirements(projectId), api.listArtifacts(projectId),
        api.listRequirementCandidates(projectId), api.listStandardRules(projectId),
      ]);
      setRequirements(reqs); setArtifacts(arts); setCandidates(nextCandidates); setStandardRules(nextRules); setError(null);
    }
    catch (e) { setError(userFacingError(e, 'Requirements could not be loaded. Try again.')); } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => { setFormTitle(''); setFormDesc(''); setFormCategory('functional'); setFormPriority('medium'); setEditing(null); setShowForm(false); setError(null); };

  const handleCreate = async () => {
    if (!formTitle.trim()) { setError('Title is required'); return; }
    setError(null);
    try { await api.createRequirement(projectId, { title: formTitle, description: formDesc, category: formCategory, priority: formPriority }); resetForm(); loadData(); }
    catch (e) { setError(userFacingError(e, 'The requirement could not be saved. Try again.')); }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!formTitle.trim()) { setError('Title is required'); return; }
    setError(null);
    try { await api.updateRequirement(projectId, editing.id, { title: formTitle, description: formDesc, category: formCategory, priority: formPriority }); resetForm(); loadData(); }
    catch (e) { setError(userFacingError(e, 'The requirement could not be updated. Try again.')); }
  };

  const handleDelete = async () => {
    if (!requirementToDelete) return;
    setDeleting(true);
    try {
      await api.deleteRequirement(projectId, requirementToDelete.id);
      setRequirementToDelete(null);
      await loadData();
    } catch (e) { setError(userFacingError(e, 'The requirement could not be removed. Try again.')); }
    finally { setDeleting(false); }
  };

  const handleEdit = (req: Requirement) => { setEditing(req); setFormTitle(req.title); setFormDesc(req.description); setFormCategory(req.category); setFormPriority(req.priority); setShowForm(true); };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!mappings[id]) {
      try {
        const data = await api.listRequirementMappings(projectId, id);
        setMappings(prev => ({ ...prev, [id]: data }));
      } catch {}
    }
  };

  const handleMap = async (reqId: string) => {
    setError(null);
    try {
      await api.mapRequirement(projectId, reqId, { fileId: mapFileId || undefined, coverageStatus: mapCoverage, confidence: mapConfidence });
      setShowMapForm(null); setMapFileId(''); setMapCoverage('unknown'); setMapConfidence(0);
      const data = await api.listRequirementMappings(projectId, reqId);
      setMappings(prev => ({ ...prev, [reqId]: data }));
    } catch (e) { setError(userFacingError(e, 'The requirement mapping could not be saved. Try again.')); }
  };

  const extractCandidates = async () => {
    if (!candidateArtifactId) { setError('Choose a requirements artifact to extract.'); return; }
    setGroundingBusy('extract'); setError(null);
    try { await api.extractRequirementCandidates(projectId, candidateArtifactId); await loadData(); }
    catch (cause) { setError(userFacingError(cause, 'Requirement candidates could not be extracted. Check the Model Provider and try again.')); }
    finally { setGroundingBusy(null); }
  };

  const decideCandidate = async (candidate: RequirementCandidate, action: 'confirm' | 'reject') => {
    setGroundingBusy(candidate.id); setError(null);
    try {
      if (action === 'confirm') await api.confirmRequirementCandidate(projectId, candidate.id);
      else await api.rejectRequirementCandidate(projectId, candidate.id);
      await loadData();
    } catch (cause) { setError(userFacingError(cause, `The candidate could not be ${action === 'confirm' ? 'confirmed' : 'rejected'}.`)); }
    finally { setGroundingBusy(null); }
  };

  const ingestStandards = async () => {
    if (!standardArtifactId) { setError('Choose a coding-standard artifact to parse.'); return; }
    setGroundingBusy('standards'); setError(null);
    try { await api.ingestStandardRules(projectId, standardArtifactId); await loadData(); }
    catch (cause) { setError(userFacingError(cause, 'Coding-standard rules could not be parsed.')); }
    finally { setGroundingBusy(null); }
  };

  const toggleStandardRule = async (rule: StandardRule) => {
    setGroundingBusy(rule.id); setError(null);
    try {
      const updated = await api.setStandardRuleEnabled(projectId, rule.id, !rule.enabled);
      setStandardRules(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (cause) { setError(userFacingError(cause, 'The standard rule could not be updated.')); }
    finally { setGroundingBusy(null); }
  };

  if (loading) return <div className="screen command-loading"><Activity size={20} /> Loading requirements...</div>;

  const priorityTone = (priority: string): StatusTone =>
    priority === 'critical' || priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'neutral';
  const coverageTone = (coverage: string): StatusTone =>
    coverage === 'implemented' ? 'success' : coverage === 'partial' ? 'warning' : coverage === 'missing' ? 'danger' : 'neutral';

  return (
    <div className="screen command-requirements animate-fade-in">
      <CommandPageHeader
        eyebrow="Review"
        title="Requirements"
        description="Maintain requirements and link them to source files with clear coverage."
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        meta={<><span>{requirements.length} requirements</span><span>{artifacts.length} source files available</span></>}
        actions={!showForm ? (
          <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus size={16} /> Add requirement
          </button>
        ) : undefined}
      />

      {showForm && (
        <div className="form-card requirement-form animate-slide-up">
          <h3>{editing ? 'Edit requirement' : 'New requirement'}</h3>
          <div className="form-field">
            <label>Title</label>
            <input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Requirement title" />
          </div>
          <div className="form-field">
            <label>Description</label>
            <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Detailed description" rows={3} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="requirement-category">Category</label>
              <Select
                id="requirement-category"
                value={formCategory}
                onChange={setFormCategory}
                options={CATEGORIES.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
              />
            </div>
            <div className="form-field">
              <label htmlFor="requirement-priority">Priority</label>
              <Select
                id="requirement-priority"
                value={formPriority}
                onChange={setFormPriority}
                options={PRIORITIES.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
              />
            </div>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn-primary" onClick={editing ? handleUpdate : handleCreate}>{editing ? 'Update' : 'Create'}</button>
            <button className="btn-secondary" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {!showForm && error && <p className="form-error" role="alert">{error}</p>}

      {!showForm && <div className="grounding-workspace">
        <section className="grounding-panel" aria-labelledby="requirement-candidates-heading">
          <div className="grounding-panel-heading">
            <div><span className="command-eyebrow"><Sparkles size={13} aria-hidden="true" /> Artifact verification</span><h2 id="requirement-candidates-heading">Requirement candidates</h2><p>Extracted statements remain non-authoritative until you confirm them.</p></div>
            <span className="grounding-count">{candidates.filter(item => item.status === 'pending_confirmation').length} pending</span>
          </div>
          <div className="grounding-import-row">
            <Select id="candidate-artifact" aria-label="Requirements artifact" value={candidateArtifactId} onChange={setCandidateArtifactId} placeholder="Choose a requirement document" options={artifacts.filter(item => item.type === 'requirement' || item.type === 'design' || item.type === 'other').map(item => ({ value: item.id, label: item.fileName }))} />
            <button type="button" className="btn-secondary" onClick={() => void extractCandidates()} disabled={groundingBusy !== null || !candidateArtifactId}>{groundingBusy === 'extract' ? 'Extracting…' : 'Extract candidates'}</button>
          </div>
          {candidates.length === 0 ? <p className="command-compact-empty">No candidates have been extracted. Choose a requirements artifact to begin.</p> : <div className="grounding-list" role="list" aria-label="Requirement candidates">
            {candidates.map(candidate => <article key={candidate.id} className="grounding-row" role="listitem">
              <div className="grounding-row-main"><div><strong>{candidate.title}</strong><StatusBadge label={candidate.status.replace('_', ' ')} tone={candidate.status === 'confirmed' ? 'success' : candidate.status === 'rejected' ? 'neutral' : 'warning'} /></div><p>{candidate.statement}</p><small>{candidate.sourceLocator.filePath}{candidate.sourceLocator.lineStart ? `:${candidate.sourceLocator.lineStart}` : ''} · {Math.round(candidate.confidence * 100)}% confidence · {candidate.kind.replace('_', ' ')}</small></div>
              {candidate.status === 'pending_confirmation' && <div className="grounding-row-actions"><button type="button" className="btn-secondary" onClick={() => void decideCandidate(candidate, 'reject')} disabled={groundingBusy !== null}><X size={14} aria-hidden="true" /> Reject</button><button type="button" className="btn-primary" onClick={() => void decideCandidate(candidate, 'confirm')} disabled={groundingBusy !== null}><Check size={14} aria-hidden="true" /> Confirm</button></div>}
            </article>)}
          </div>}
        </section>

        <section className="grounding-panel" aria-labelledby="standard-rules-heading">
          <div className="grounding-panel-heading"><div><span className="command-eyebrow"><ShieldCheck size={13} aria-hidden="true" /> Review policy</span><h2 id="standard-rules-heading">Coding-standard rules</h2><p>Only enabled, source-cited rules are supplied to static analysis.</p></div><span className="grounding-count">{standardRules.filter(item => item.enabled).length} enabled</span></div>
          <div className="grounding-import-row">
            <Select id="standard-artifact" aria-label="Coding-standard artifact" value={standardArtifactId} onChange={setStandardArtifactId} placeholder="Choose a coding-standard document" options={artifacts.filter(item => item.type === 'coding_standard').map(item => ({ value: item.id, label: item.fileName }))} />
            <button type="button" className="btn-secondary" onClick={() => void ingestStandards()} disabled={groundingBusy !== null || !standardArtifactId}>{groundingBusy === 'standards' ? 'Parsing…' : 'Parse standard'}</button>
          </div>
          {standardRules.length === 0 ? <p className="command-compact-empty">No structured rules are available. Add and parse a coding-standard artifact.</p> : <div className="grounding-list" role="list" aria-label="Coding-standard rules">
            {standardRules.map(rule => <article key={rule.id} className={`grounding-row${rule.enabled ? '' : ' is-disabled'}`} role="listitem"><div className="grounding-row-main"><div><strong>{rule.title}</strong><StatusBadge label={rule.severity} tone={priorityTone(rule.severity)} /></div><p>{rule.statement}</p><small>{rule.sourceLocator.filePath}{rule.sourceLocator.lineStart ? `:${rule.sourceLocator.lineStart}` : ''} · version {rule.standardVersion || rule.sourceVersion}</small></div><button type="button" className={rule.enabled ? 'btn-secondary' : 'btn-primary'} aria-pressed={rule.enabled} onClick={() => void toggleStandardRule(rule)} disabled={groundingBusy !== null}>{rule.enabled ? 'Disable' : 'Enable'}</button></article>)}
          </div>}
        </section>
      </div>}

      {requirements.length === 0 ? (
        <CommandEmptyState icon={FileText} title="No requirements yet" description="Add a requirement to map coverage against your source files." />
      ) : (
        <div className="requirements-list stagger-children">
          {requirements.map(req => (
            <div key={req.id} className="requirement-row">
              <div className="requirement-summary">
                <button type="button" className="requirement-summary-main" onClick={() => void toggleExpand(req.id)} aria-expanded={expandedId === req.id}>
                  <span className="requirement-primary">
                    <span className="requirement-title">{req.title}</span>
                    <span className="requirement-excerpt">{req.description || 'No description'}</span>
                  </span>
                  <StatusBadge label={req.priority} tone={priorityTone(req.priority)} />
                  {req.category && <span className="finding-category">{req.category}</span>}
                  {expandedId === req.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <div className="requirement-actions">
                  <IconButton icon={Edit} label="Edit requirement" onClick={() => handleEdit(req)} />
                  <IconButton icon={Trash2} label="Delete requirement" tone="danger" onClick={() => setRequirementToDelete(req)} />
                </div>
              </div>

              {expandedId === req.id && (
                <div className="requirement-detail animate-slide-up">
                  {req.description && <p className="requirement-description">{req.description}</p>}

                  <div className="requirement-mapping-header">
                    <h4><Link size={12} /> Code mappings</h4>
                    <button className="btn-secondary" onClick={() => setShowMapForm(showMapForm === req.id ? null : req.id)}>
                      {showMapForm === req.id ? 'Cancel' : 'Link to code'}
                    </button>
                  </div>

                  {showMapForm === req.id && (
                    <div className="requirement-map-form">
                      <div className="form-row">
                        <div className="form-field">
                          <label htmlFor={`requirement-map-file-${req.id}`}>Source file</label>
                          <Select
                            id={`requirement-map-file-${req.id}`}
                            value={mapFileId}
                            onChange={setMapFileId}
                            placeholder="Select source file"
                            options={artifacts.map(a => ({ value: a.id, label: a.fileName }))}
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor={`requirement-map-coverage-${req.id}`}>Coverage</label>
                          <Select
                            id={`requirement-map-coverage-${req.id}`}
                            value={mapCoverage}
                            onChange={setMapCoverage}
                            options={COVERAGE_STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                          />
                        </div>
                        <div className="form-field">
                          <label>Confidence (0-1)</label>
                          <input type="number" min={0} max={1} step={0.1} value={mapConfidence} onChange={e => setMapConfidence(Number(e.target.value))} />
                        </div>
                      </div>
                      <div className="form-actions">
                        <button className="btn-primary" onClick={() => handleMap(req.id)}>Add mapping</button>
                      </div>
                    </div>
                  )}

                  {mappings[req.id] && mappings[req.id].length > 0 ? (
                    <div className="requirement-mappings">
                      {mappings[req.id].map(m => {
                        const artifact = artifacts.find(a => a.id === m.fileId);
                        return (
                          <div key={m.id} className="requirement-mapping-row">
                            <span className="mapping-file">{artifact ? artifact.fileName : m.fileId ?? 'Unknown file'}</span>
                            <StatusBadge label={m.coverageStatus} tone={coverageTone(m.coverageStatus)} />
                            <span className="mapping-confidence">{Math.round(m.confidence * 100)}% confidence</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="command-compact-empty">No code mappings yet.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={requirementToDelete !== null}
        title="Delete requirement?"
        description={`Delete ${requirementToDelete?.title ?? 'this requirement'} and remove it from this project?`}
        confirmLabel="Delete requirement"
        onConfirm={handleDelete}
        onClose={() => setRequirementToDelete(null)}
        busy={deleting}
      />
    </div>
  );
}
