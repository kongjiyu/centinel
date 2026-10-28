// Isolated visual QA fixture: synthetic status only, no HTTP or provider calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import './src/style.css';
import './src/App.css';
import './src/command.css';
import './src/workspace.css';
import './src/components/ArtifactsPanel.css';
import { api } from './src/api/client';
import { SourceIndexStatus } from './src/components/SourceIndexStatus';
let resumed = false;
api.getSourceIndexStatus = async () => ({ state: resumed ? 'running' : 'paused' });
api.resumeSourceIndex = async () => { resumed = true; return { state: 'queued' }; };
createRoot(document.getElementById('root')!).render(<main className="workspace-mode" style={{ minHeight: '100vh', padding: '24px', boxSizing: 'border-box' }}>
  <div className="source-workspace" style={{ width: '100%', maxWidth: '1100px', margin: '0 auto' }}>
    <p>Visual QA fixture · synthetic status · no project data</p><h2>Sources</h2>
    <SourceIndexStatus projectId="fixture" sourceVersionKey="v1" />
    <div className="source-table-shell"><div className="source-import-summary">Repository and document sources</div></div>
  </div>
</main>);
