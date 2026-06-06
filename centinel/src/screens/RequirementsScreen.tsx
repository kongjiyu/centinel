import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { Requirement, RequirementMapping, Artifact, Screen } from '../types';

type Props = {
  projectId: string;
  onNavigate: (screen: Screen) => void;
};

const CATEGORIES = ['functional', 'non-functional', 'security', 'performance', 'usability', 'other'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const COVERAGE_STATUSES = ['implemented', 'partial', 'missing', 'unknown'];

const COVERAGE_COLORS: Record<string, string> = {
  implemented: '#22c55e',
  partial: '#f59e0b',
  missing: '#ef4444',
  unknown: '#9ca3af',
};

type EditingRequirement = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
};

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

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState('functional');
  const [formPriority, setFormPriority] = useState('medium');

  // Map form state
  const [mapFileId, setMapFileId] = useState('');
  const [mapCoverage, setMapCoverage] = useState('unknown');
  const [mapConfidence, setMapConfidence] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const [reqs, arts] = await Promise.all([
        api.listRequirements(projectId),
        api.listArtifacts(projectId),
      ]);
      setRequirements(reqs);
      setArtifacts(arts);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setFormTitle('');
    setFormDesc('');
    setFormCategory('functional');
    setFormPriority('medium');
    setEditing(null);
    setShowForm(false);
    setError(null);
  };

  const handleCreate = async () => {
    if (!formTitle.trim()) {
      setError('Title is required');
      return;
    }
    setError(null);
    try {
      await api.createRequirement(projectId, {
        title: formTitle,
        description: formDesc,
        category: formCategory,
        priority: formPriority,
      });
      resetForm();
      loadData();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!formTitle.trim()) {
      setError('Title is required');
      return;
    }
    setError(null);
    try {
      await api.updateRequirement(projectId, editing.id, {
        title: formTitle,
        description: formDesc,
        category: formCategory,
        priority: formPriority,
      });
      resetForm();
      loadData();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this requirement?')) return;
    try {
      await api.deleteRequirement(projectId, id);
      loadData();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleEdit = (req: Requirement) => {
    setEditing(req);
    setFormTitle(req.title);
    setFormDesc(req.description);
    setFormCategory(req.category);
    setFormPriority(req.priority);
    setShowForm(true);
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!mappings[id]) {
      try {
        const data = await api.listRequirementMappings(projectId, id);
        setMappings(prev => ({ ...prev, [id]: data }));
      } catch {
        // ignore
      }
    }
  };

  const handleMap = async (reqId: string) => {
    setError(null);
    try {
      await api.mapRequirement(projectId, reqId, {
        fileId: mapFileId || undefined,
        coverageStatus: mapCoverage,
        confidence: mapConfidence,
      });
      setShowMapForm(null);
      setMapFileId('');
      setMapCoverage('unknown');
      setMapConfidence(0);
      // Reload mappings
      const data = await api.listRequirementMappings(projectId, reqId);
      setMappings(prev => ({ ...prev, [reqId]: data }));
    } catch (e) {
      setError(String(e));
    }
  };

  if (loading) {
    return (
      <div className="screen">
        <p className="panel-loading">Loading requirements...</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn-back" onClick={() => onNavigate({ name: 'project-detail', projectId })}>
          Back
        </button>
        <h1>Requirements</h1>
        {!showForm && (
          <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            Add Requirement
          </button>
        )}
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editing ? 'Edit Requirement' : 'New Requirement'}</h3>
          <div className="form-field">
            <label>Title</label>
            <input
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Requirement title"
            />
          </div>
          <div className="form-field">
            <label>Description</label>
            <textarea
              value={formDesc}
              onChange={e => setFormDesc(e.target.value)}
              placeholder="Detailed description"
              rows={3}
            />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label>Category</label>
              <select value={formCategory} onChange={e => setFormCategory(e.target.value)}>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Priority</label>
              <select value={formPriority} onChange={e => setFormPriority(e.target.value)}>
                {PRIORITIES.map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="btn-primary" onClick={editing ? handleUpdate : handleCreate}>
              {editing ? 'Update' : 'Create'}
            </button>
            <button className="btn-secondary" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {!showForm && error && <p className="form-error">{error}</p>}

      {requirements.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="card-empty">No requirements yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="section" style={{ marginTop: 16 }}>
          <div className="project-list">
            {requirements.map(req => (
              <div key={req.id}>
                <div
                  className="project-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleExpand(req.id)}
                >
                  <div className="project-info" style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="project-name">{req.title}</span>
                      <span className={`badge badge-${req.priority === 'critical' || req.priority === 'high' ? 'failure' : req.priority === 'medium' ? 'running' : 'queued'}`}>
                        {req.priority}
                      </span>
                      {req.category && (
                        <span className="finding-category">{req.category}</span>
                      )}
                    </div>
                    <span className="project-desc">
                      {req.description.length > 100 ? req.description.slice(0, 100) + '...' : req.description || 'No description'}
                    </span>
                  </div>
                  <div className="project-meta">
                    <span className="project-date">{new Date(req.createdAt).toLocaleDateString()}</span>
                    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                      <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleEdit(req)}>
                        Edit
                      </button>
                      <button className="btn-delete" style={{ fontSize: 12 }} onClick={() => handleDelete(req.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                {expandedId === req.id && (
                  <div style={{ background: '#f9fafb', padding: '12px 16px', borderBottom: '1px solid #e0e0e0' }}>
                    {req.description && (
                      <p style={{ fontSize: 13, color: '#444', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{req.description}</p>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#333' }}>Code Mappings</h4>
                      <button
                        className="btn-primary"
                        style={{ padding: '3px 10px', fontSize: 12 }}
                        onClick={() => setShowMapForm(showMapForm === req.id ? null : req.id)}
                      >
                        {showMapForm === req.id ? 'Cancel' : 'Link to Code'}
                      </button>
                    </div>

                    {showMapForm === req.id && (
                      <div className="form-card" style={{ marginBottom: 8, background: '#fff' }}>
                        <div className="form-row">
                          <div className="form-field">
                            <label>Artifact File</label>
                            <select value={mapFileId} onChange={e => setMapFileId(e.target.value)}>
                              <option value="">-- Select artifact --</option>
                              {artifacts.map(a => (
                                <option key={a.id} value={a.id}>{a.fileName}</option>
                              ))}
                            </select>
                          </div>
                          <div className="form-field">
                            <label>Coverage Status</label>
                            <select value={mapCoverage} onChange={e => setMapCoverage(e.target.value)}>
                              {COVERAGE_STATUSES.map(s => (
                                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                              ))}
                            </select>
                          </div>
                          <div className="form-field">
                            <label>Confidence (0-1)</label>
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.1}
                              value={mapConfidence}
                              onChange={e => setMapConfidence(Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div className="form-actions">
                          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => handleMap(req.id)}>
                            Add Mapping
                          </button>
                        </div>
                      </div>
                    )}

                    {mappings[req.id] && mappings[req.id].length > 0 ? (
                      <div className="project-list" style={{ marginTop: 4 }}>
                        {mappings[req.id].map(m => {
                          const artifact = artifacts.find(a => a.id === m.fileId);
                          return (
                            <div key={m.id} className="project-row" style={{ cursor: 'default' }}>
                              <div className="project-info">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
                                    {artifact ? artifact.fileName : m.fileId ?? 'Unknown file'}
                                  </span>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '2px 8px',
                                      borderRadius: 4,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: '#fff',
                                      background: COVERAGE_COLORS[m.coverageStatus] || COVERAGE_COLORS.unknown,
                                    }}
                                  >
                                    {m.coverageStatus}
                                  </span>
                                  <span style={{ fontSize: 12, color: '#888' }}>
                                    {Math.round(m.confidence * 100)}% confidence
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p style={{ fontSize: 13, color: '#999', margin: 0 }}>No code mappings yet.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
