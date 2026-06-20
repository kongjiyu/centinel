import { useEffect, useState } from 'react';
import {
  FolderOpen, CheckCircle2, Circle, ArrowRight,
  Zap, Eye, BarChart3, Shield, Play, Settings, TrendingUp,
  Activity, ExternalLink
} from 'lucide-react';
import { api } from '../api/client';
import type { Project, AiProviderSetting, DynamicSession, Screen } from '../types';

type Props = {
  projects: Project[];
  aiSettings: AiProviderSetting[];
  sidecarOnline: boolean;
  onNavigate: (screen: Screen) => void;
};

export function DashboardScreen({ projects, aiSettings, sidecarOnline, onNavigate }: Props) {
  const [latestDynamic, setLatestDynamic] = useState<DynamicSession | null>(null);
  const textOk = aiSettings.some(s => s.id === 'text' && s.hasApiKey);
  const visionOk = aiSettings.some(s => s.id === 'vision' && s.hasApiKey);

  useEffect(() => {
    let cancelled = false;

    const loadLatestDynamic = async () => {
      if (projects.length === 0) {
        setLatestDynamic(null);
        return;
      }

      const sessionGroups = await Promise.all(
        projects.map(project => api.listDynamicSessions(project.id).catch(() => []))
      );
      const latest = sessionGroups
        .flat()
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;

      if (!cancelled) setLatestDynamic(latest);
    };

    void loadLatestDynamic();
    return () => { cancelled = true; };
  }, [projects]);

  const dynamicValidated = latestDynamic?.status === 'success';
  const dynamicRunning = latestDynamic?.status === 'running' || latestDynamic?.status === 'queued';
  const dynamicFailed = latestDynamic?.status === 'failure' || latestDynamic?.status === 'blocked';
  const operational = sidecarOnline && textOk && visionOk;

  const readiness = [
    { label: 'Project created', done: projects.length > 0, icon: FolderOpen },
    { label: 'Text AI configured', done: textOk, icon: Zap },
    { label: 'Vision AI configured', done: visionOk, icon: Eye },
    { label: 'Static review available', done: false, icon: BarChart3 },
    { label: 'Dynamic test validated', done: dynamicValidated, icon: Play },
    { label: 'Report exported', done: false, icon: Shield },
  ];

  const completedCount = readiness.filter(r => r.done).length;
  const allReady = readiness.every(r => r.done);
  const dynamicTitle = dynamicValidated
    ? 'Dynamic Test Validated'
    : dynamicRunning
      ? 'Dynamic Test Running'
      : dynamicFailed
        ? 'Dynamic Test Requires Review'
        : 'Dynamic Test Not Yet Validated';
  const dynamicSubtitle = latestDynamic
    ? latestDynamic.finalSummary || latestDynamic.goal
    : 'Run a dynamic test to validate an end-to-end user journey.';
  const dynamicStages = [
    { label: 'Prepare', detail: projects.length > 0 ? 'Ready' : 'Waiting', done: projects.length > 0 },
    { label: 'Vision', detail: visionOk ? 'Ready' : 'Missing', done: visionOk },
    { label: 'Execute', detail: latestDynamic ? 'Recorded' : 'Pending', done: Boolean(latestDynamic) },
    { label: 'Validate', detail: dynamicValidated ? 'Passed' : dynamicFailed ? 'Review' : dynamicRunning ? 'Running' : 'Waiting', done: dynamicValidated },
    { label: 'Complete', detail: dynamicValidated && latestDynamic ? new Date(latestDynamic.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending', done: dynamicValidated },
  ];

  return (
    <div className="screen dashboard-console animate-fade-in">
      {/* Hero Header */}
      <div className="dashboard-hero">
        <div className="hero-content">
          <div className="hero-badge">
            <Shield size={12} />
            <span>QA Workstation</span>
          </div>
          <h1 className="hero-title">Centinel Dashboard</h1>
          <p className="hero-subtitle">
            AI-powered software quality assurance platform for autonomous testing and validation.
          </p>
        </div>
        <div className={`hero-operational ${operational ? 'online' : 'attention'}`}>
          <span className="hero-operational-dot" />
          <span>{operational ? 'Operational' : 'Attention'}</span>
          <span className="hero-operational-meta">{completedCount}/{readiness.length} ready</span>
        </div>
        <div className="hero-decoration">
          <div className="hero-ring ring-1" />
          <div className="hero-ring ring-2" />
          <div className="hero-ring ring-3" />
        </div>
      </div>

      {/* Operational Stats */}
      <div className="dashboard-stats stagger-children">
        <div className="stat-card">
          <div className="stat-icon">
            <FolderOpen size={22} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{projects.length}</span>
            <span className="stat-label">Projects</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon text">
            <Zap size={22} />
          </div>
          <div className="stat-content">
            <span className={`stat-value ${textOk ? 'ok' : 'err'}`}>
              {textOk ? 'Ready' : '—'}
            </span>
            <span className="stat-label">Text AI</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon vision">
            <Eye size={22} />
          </div>
          <div className="stat-content">
            <span className={`stat-value ${visionOk ? 'ok' : 'err'}`}>
              {visionOk ? 'Ready' : '—'}
            </span>
            <span className="stat-label">Vision AI</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon readiness">
            <TrendingUp size={22} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{completedCount}/{readiness.length}</span>
            <span className="stat-label">Readiness</span>
          </div>
        </div>
      </div>

      <section className={`dynamic-validation-strip ${dynamicValidated ? 'validated' : dynamicFailed ? 'failed' : dynamicRunning ? 'running' : 'idle'}`}>
        <div className="dynamic-validation-summary">
          <div className="dynamic-validation-mark">
            {dynamicValidated ? <CheckCircle2 size={25} /> : <Activity size={25} />}
          </div>
          <div className="dynamic-validation-copy">
            <h2>{dynamicTitle}</h2>
            <p>{dynamicSubtitle}</p>
            {latestDynamic && (
              <span>{new Date(latestDynamic.updatedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
        <div className="dynamic-validation-track">
          {dynamicStages.map((stage, index) => (
            <div key={stage.label} className={`validation-stage ${stage.done ? 'done' : ''} ${index === 3 && dynamicRunning ? 'active' : ''}`}>
              <span className="validation-node">
                {stage.done ? <CheckCircle2 size={13} /> : <Circle size={9} fill="currentColor" />}
              </span>
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </div>
          ))}
        </div>
        {latestDynamic && (
          <button
            className="dynamic-validation-link"
            onClick={() => onNavigate({ name: 'dynamic-session', projectId: latestDynamic.projectId, sessionId: latestDynamic.id })}
            aria-label={`Open dynamic test ${latestDynamic.name}`}
          >
            <ExternalLink size={15} />
          </button>
        )}
      </section>

      {/* Two-column layout */}
      <div className="dashboard-columns stagger-children">
        {/* Left: Readiness */}
        <div className="panel">
          <div className="panel-header">
            <h3>System Readiness</h3>
            <span className="readiness-progress">{completedCount}/{readiness.length}</span>
          </div>
          <div className="readiness-list">
            {readiness.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="readiness-item" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className={`readiness-icon ${item.done ? 'done' : 'pending'}`}>
                    <Icon size={14} />
                  </div>
                  <span className={`readiness-label ${item.done ? 'done' : 'pending'}`}>
                    {item.label}
                  </span>
                  {item.done ? (
                    <CheckCircle2 size={14} className="readiness-status done" />
                  ) : (
                    <Circle size={14} className="readiness-status pending" />
                  )}
                </div>
              );
            })}
          </div>
          {!allReady && (
            <div className="panel-footer">
              <span className="readiness-hint">
                {completedCount === 0
                  ? 'Get started by creating a project and configuring AI providers.'
                  : `${readiness.length - completedCount} step${readiness.length - completedCount > 1 ? 's' : ''} remaining. Configure in Settings.`}
              </span>
            </div>
          )}
        </div>

        {/* Right: Quick Actions */}
        <div className="panel">
          <div className="panel-header">
            <h3>Quick Actions</h3>
          </div>
          <div className="quick-actions">
            <button className="quick-action" onClick={() => onNavigate({ name: 'projects' })}>
              <div className="quick-action-icon projects">
                <FolderOpen size={16} />
              </div>
              <div className="quick-action-text">
                <span className="quick-action-title">View Projects</span>
                <span className="quick-action-desc">Browse and manage your test projects</span>
              </div>
              <ArrowRight size={14} className="quick-action-arrow" />
            </button>
            <button className="quick-action" onClick={() => onNavigate({ name: 'settings' })}>
              <div className="quick-action-icon settings">
                <Settings size={16} />
              </div>
              <div className="quick-action-text">
                <span className="quick-action-title">AI Settings</span>
                <span className="quick-action-desc">Configure text and vision AI providers</span>
              </div>
              <ArrowRight size={14} className="quick-action-arrow" />
            </button>
            <button className="quick-action" onClick={() => onNavigate({ name: 'projects' })}>
              <div className="quick-action-icon dynamic">
                <Play size={16} />
              </div>
              <div className="quick-action-text">
                <span className="quick-action-title">Run Dynamic Test</span>
                <span className="quick-action-desc">Start an autonomous UI test session</span>
              </div>
              <ArrowRight size={14} className="quick-action-arrow" />
            </button>
          </div>
        </div>
      </div>

      {/* Recent Projects */}
      {projects.length > 0 && (
        <div className="panel recent-projects-panel">
          <div className="panel-header">
            <h3>Recent Projects</h3>
            <button className="btn-link" onClick={() => onNavigate({ name: 'projects' })}>
              View all →
            </button>
          </div>
          <div className="project-list stagger-children">
            {projects.slice(0, 5).map(p => (
              <div
                key={p.id}
                className="project-row"
                onClick={() => onNavigate({ name: 'project-detail', projectId: p.id })}
              >
                <div className="project-icon">
                  <FolderOpen size={16} />
                </div>
                <div className="project-info">
                  <span className="project-name">{p.name}</span>
                  {p.description && (
                    <span className="project-desc">{p.description}</span>
                  )}
                </div>
                <span className="project-date">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
                <ArrowRight size={14} style={{ color: 'var(--text-faint)' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="empty-state animate-fade-in">
          <div className="empty-state-icon">
            <FolderOpen size={48} strokeWidth={1} />
          </div>
          <h3>No projects yet</h3>
          <p>Create your first project to start testing with AI-powered analysis.</p>
          <button className="btn-primary" onClick={() => onNavigate({ name: 'projects' })}>
            Create Project
          </button>
        </div>
      )}

      <footer className="dashboard-telemetry" aria-label="Dashboard telemetry">
        <div className="telemetry-identity">
          <span className="telemetry-code">SYS-CN</span>
          <span>{projects.length} project{projects.length === 1 ? '' : 's'}</span>
          <span>{completedCount}/{readiness.length} readiness checks</span>
        </div>
        <div className="telemetry-bars" aria-hidden="true">
          {readiness.map((item, index) => (
            <span key={item.label} className={item.done ? 'active' : ''} style={{ height: `${8 + (index % 3) * 4}px` }} />
          ))}
        </div>
      </footer>
    </div>
  );
}
