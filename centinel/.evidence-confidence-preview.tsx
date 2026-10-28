// Local visual QA fixture only. No saved records, model calls or source reads.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import './src/style.css';
import './src/App.css';
import './src/command.css';
import './src/workspace.css';
import { FindingEvidence } from './src/components/FindingEvidence';
import type { Finding } from './src/types';

const finding = { id: 'fixture', projectId: 'fixture', source: 'static', sessionId: null,
  artifactId: 'checkout', filePath: 'src/payments/checkout.ts', lineNumber: 12, evidenceText: 'await storeTransaction(payment);',
  location: { sourceVersion: 'frozen-fixture-v1', sourceLocator: { citationEvidence: { version: 1,
    verification: 'needs_verification', reason: 'support_unverified', unmatchedReferences: 0,
    candidates: [
      { artifactId: 'checkout', sourceVersion: 'frozen-fixture-v1', filePath: 'src/payments/checkout.ts', lineNumber: 12,
        excerpt: 'await storeTransaction(payment);', score: 100, confidence: 'high', match: 'exact', referenceIndex: 0 },
      { artifactId: 'worker', sourceVersion: 'frozen-fixture-v1', filePath: 'src/workers/reconcile-transactions.ts', lineNumber: 47,
        excerpt: 'await storeTransaction(reconciledPayment);', score: 80, confidence: 'medium', match: 'approximate', referenceIndex: 0 },
      { artifactId: 'reports', sourceVersion: 'frozen-fixture-v1', filePath: 'src/reports/summarise-transactions.ts', lineNumber: 82,
        excerpt: 'return transactions.map(formatTransaction);', score: 45, confidence: 'low', match: 'approximate', referenceIndex: 0 },
    ] } } } } as unknown as Finding;
createRoot(document.getElementById('root')!).render(<main className="workspace-mode" style={{ minHeight: '100vh', overflow: 'auto' }}>
  <div className="finding-document"><header><p>Visual QA fixture · no project data</p><h2>Transaction evidence</h2>
    <p>Test the best source match, alternative candidates, and verification state. These fixture observations are not assessment results.</p></header>
    <FindingEvidence finding={finding} headingLevel={4} />
  </div>
</main>);
