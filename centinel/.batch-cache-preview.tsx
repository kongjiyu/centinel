// Isolated responsive display fixture; synthetic values, no service/provider calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import './src/style.css';
import './src/App.css';
import './src/workspace.css';
import { api } from './src/api/client';
import { ReviewUsageDetails } from './src/components/ReviewUsageDetails';
api.getReviewModelUsage = async () => ({ totals: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, totalTokens: 0 }, byGroup: [], recent: [],
  reviewUsage: { status: 'available', totalProviderReportedTokens: 0, providerReportedCalls: 0, unknownProviderTotalCalls: 0,
    canonicalTotalTokens: 0, unknownCanonicalTotalCalls: 0, byStage: [],
    reusedAssessments: { status: 'available', batchCount: 3, minimumCallsAvoided: 6, originReviewIds: ['fixture'], uniqueFileCount: 12, files: [] },
    sourceInventory: { status: 'available', totalUniqueFiles: 0, knownUniqueFiles: 0, aiFileAppearances: 0, repeatedFileAppearances: 0,
      unknownAiFileAttempts: 0, files: [], physical: { status: 'available', readAttempts: 0, uniqueFiles: 0, unknownReadAttempts: 0, byStage: [] } },
  },
} as any);
createRoot(document.getElementById('root')!).render(<main className="workspace-mode" style={{ padding: 24 }}>
  <p>Visual QA fixture · synthetic values · no saved assessment</p><ReviewUsageDetails projectId="fixture" sessionId="fixture" />
</main>);
