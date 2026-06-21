import fs from 'fs';
import path from 'path';
import { getProject } from './projects.js';
import { listStaticSessions, getStaticSession, listStaticFindings } from './staticSessions.js';
import { listDynamicSessions, getDynamicSession, listDynamicEvidence, type DynamicSession } from './dynamicSessions.js';
import type { Finding } from './staticSessions.js';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🔵';
    case 'info': return '⚪';
    default: return '⚪';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export async function exportProjectReport(projectId: string): Promise<{ reportPath: string; markdown: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');

  const staticSessions = await listStaticSessions(projectId);
  const dynamicSessions = await listDynamicSessions(projectId);

  // Get all findings across all static sessions
  const allStaticFindings: Finding[] = [];
  for (const session of staticSessions) {
    const findings = await listStaticFindings(projectId, session.id);
    allStaticFindings.push(...findings);
  }

  const lines: string[] = [];

  // Header
  lines.push(`# Centinel QA Report`);
  lines.push('');
  lines.push(`**Project:** ${project.name}`);
  if (project.description) lines.push(`**Description:** ${project.description}`);
  lines.push(`**Generated:** ${formatDate(new Date().toISOString())}`);
  lines.push(`**Workspace:** \`${project.workspacePath}\``);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  const totalFindings = allStaticFindings.length;
  const bySeverity = {
    critical: allStaticFindings.filter(f => f.severity === 'critical').length,
    high: allStaticFindings.filter(f => f.severity === 'high').length,
    medium: allStaticFindings.filter(f => f.severity === 'medium').length,
    low: allStaticFindings.filter(f => f.severity === 'low').length,
    info: allStaticFindings.filter(f => f.severity === 'info').length,
  };

  lines.push(`| Metric | Count |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| Total Findings | ${totalFindings} |`);
  lines.push(`| 🔴 Critical | ${bySeverity.critical} |`);
  lines.push(`| 🟠 High | ${bySeverity.high} |`);
  lines.push(`| 🟡 Medium | ${bySeverity.medium} |`);
  lines.push(`| 🔵 Low | ${bySeverity.low} |`);
  lines.push(`| ⚪ Info | ${bySeverity.info} |`);
  lines.push(`| Static Sessions | ${staticSessions.length} |`);
  lines.push('');

  // Static Review Sessions
  if (staticSessions.length > 0) {
    lines.push('## Static Review Sessions');
    lines.push('');

    for (const session of staticSessions) {
      const sessionFindings = await listStaticFindings(projectId, session.id);
      lines.push(`### ${session.name}`);
      lines.push('');
      lines.push(`- **Review Type:** ${session.reviewType.replace(/_/g, ' ')}`);
      lines.push(`- **Status:** ${session.status}`);
      lines.push(`- **Created:** ${formatDate(session.createdAt)}`);
      lines.push(`- **Findings:** ${sessionFindings.length}`);
      if (session.remarks) lines.push(`- **Remarks:** ${session.remarks}`);
      if (session.finalSummary) lines.push(`- **Summary:** ${session.finalSummary}`);
      if (session.failureReason) lines.push(`- **Failure:** ${session.failureReason}`);
      lines.push('');

      if (sessionFindings.length > 0) {
        const sorted = sortBySeverity(sessionFindings);
        lines.push('#### Findings');
        lines.push('');
        lines.push('| # | Severity | Title | Category | Status |');
        lines.push('| ---: | --- | --- | --- | --- |');
        sorted.forEach((f, i) => {
          lines.push(`| ${i + 1} | ${severityEmoji(f.severity)} ${f.severity} | ${f.title} | ${f.category} | ${f.status} |`);
        });
        lines.push('');

        lines.push('#### Finding Details');
        lines.push('');
        sorted.forEach((f, i) => {
          lines.push(`**${i + 1}. ${f.title}**`);
          lines.push('');
          lines.push(`- **Severity:** ${severityEmoji(f.severity)} ${f.severity}`);
          lines.push(`- **Category:** ${f.category}`);
          lines.push(`- **Confidence:** ${f.confidence}`);
          lines.push(`- **Status:** ${f.status}`);
          lines.push('');
          lines.push(`> ${f.description}`);
          lines.push('');
          if (f.evidenceText) {
            lines.push(`**Evidence:**`);
            lines.push('```');
            lines.push(f.evidenceText);
            lines.push('```');
            lines.push('');
          }
          if (f.recommendation) {
            lines.push(`**Recommendation:** ${f.recommendation}`);
            lines.push('');
          }
          lines.push('---');
          lines.push('');
        });
      } else {
        lines.push('*No findings generated.*');
        lines.push('');
      }
    }
  } else {
    lines.push('## Static Review Sessions');
    lines.push('');
    lines.push('*No static review sessions completed.*');
    lines.push('');
  }

  // Dynamic Test Sessions (summary only)
  if (dynamicSessions.length > 0) {
    lines.push('## Dynamic Test Sessions');
    lines.push('');
    lines.push('| Session | Target | Mission | Status | Created |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const s of dynamicSessions) {
      lines.push(`| ${s.name} | ${s.targetUrl} | ${s.missionType} | ${s.status} | ${formatDate(s.createdAt)} |`);
    }
    lines.push('');
  } else {
    lines.push('## Dynamic Test Sessions');
    lines.push('');
    lines.push('*No dynamic test sessions completed.*');
    lines.push('');
  }

  // Write report
  const markdown = lines.join('\n');
  const reportDir = path.join(project.workspacePath, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `centinel-report-${timestamp}.md`);
  fs.writeFileSync(reportPath, markdown);

  return { reportPath, markdown };
}

export async function exportSessionReport(projectId: string, sessionId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');

  const session = await getStaticSession(projectId, sessionId);
  if (!session) throw new Error('Session not found');

  const findings = await listStaticFindings(projectId, sessionId);
  const lines: string[] = [];

  lines.push(`# Static Review Report: ${session.name}`);
  lines.push('');
  lines.push(`**Project:** ${project.name}`);
  lines.push(`**Review Type:** ${session.reviewType.replace(/_/g, ' ')}`);
  lines.push(`**Status:** ${session.status}`);
  lines.push(`**Created:** ${formatDate(session.createdAt)}`);
  if (session.remarks) lines.push(`**Remarks:** ${session.remarks}`);
  if (session.finalSummary) lines.push(`**Summary:** ${session.finalSummary}`);
  lines.push('');

  if (findings.length > 0) {
    const sorted = sortBySeverity(findings);
    lines.push('## Findings');
    lines.push('');
    lines.push('| # | Severity | Title | Category | Confidence | Status |');
    lines.push('| ---: | --- | --- | --- | --- | --- |');
    sorted.forEach((f, i) => {
      lines.push(`| ${i + 1} | ${severityEmoji(f.severity)} ${f.severity} | ${f.title} | ${f.category} | ${f.confidence} | ${f.status} |`);
    });
    lines.push('');

    lines.push('## Finding Details');
    lines.push('');
    sorted.forEach((f, i) => {
      lines.push(`### ${i + 1}. ${f.title}`);
      lines.push('');
      lines.push(`- **Severity:** ${severityEmoji(f.severity)} ${f.severity}`);
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **Confidence:** ${f.confidence}`);
      lines.push(`- **Status:** ${f.status}`);
      lines.push('');
      lines.push(f.description);
      lines.push('');
      if (f.evidenceText) {
        lines.push(`**Evidence:**`);
        lines.push('```');
        lines.push(f.evidenceText);
        lines.push('```');
        lines.push('');
      }
      if (f.recommendation) {
        lines.push(`**Recommendation:** ${f.recommendation}`);
        lines.push('');
      }
    });
  } else {
    lines.push('*No findings generated for this session.*');
    lines.push('');
  }

  const reportDir = path.join(project.workspacePath, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `static-review-${timestamp}.md`);
  fs.writeFileSync(reportPath, lines.join('\n'));

  return reportPath;
}

export async function exportDynamicSessionReport(projectId: string, sessionId: string): Promise<{ reportPath: string; markdown: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');

  const session = await getDynamicSession(projectId, sessionId);
  if (!session) throw new Error('Dynamic session not found');

  const evidence = await listDynamicEvidence(projectId, sessionId);

  const lines: string[] = [];

  // Header
  lines.push(`# Dynamic Test Report`);
  lines.push('');
  lines.push(`**Project:** ${project.name}`);
  lines.push(`**Session:** ${session.name}`);
  lines.push(`**Generated:** ${formatDate(new Date().toISOString())}`);
  lines.push('');

  // Test Configuration
  lines.push('## Test Configuration');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Target URL | \`${session.targetUrl}\` |`);
  lines.push(`| Goal | ${session.goal} |`);
  lines.push(`| Mission Type | ${session.missionType === 'smoke' ? 'Smoke Test' : 'User Journey'} |`);
  lines.push(`| Max Steps | ${session.maxSteps} |`);
  lines.push(`| Browser Mode | ${session.browserMode} |`);
  lines.push('');

  // Results
  lines.push('## Results');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| **Status** | **${session.status}** |`);
  lines.push(`| Started | ${formatDate(session.createdAt)} |`);
  lines.push(`| Completed | ${formatDate(session.updatedAt)} |`);
  lines.push('');

  if (session.finalSummary) {
    lines.push('### Summary');
    lines.push('');
    lines.push(session.finalSummary);
    lines.push('');
  }

  if (session.failureReason) {
    lines.push('### Failure Reason');
    lines.push('');
    lines.push(session.failureReason);
    lines.push('');
  }

  // Evidence Overview
  lines.push('## Evidence');
  lines.push('');
  lines.push(`| Type | Count |`);
  lines.push(`| --- | ---: |`);

  const evidenceCounts: Record<string, number> = {};
  evidence.forEach(e => {
    evidenceCounts[e.type] = (evidenceCounts[e.type] || 0) + 1;
  });

  const evidenceTypeLabels: Record<string, string> = {
    screenshot: '📸 Screenshots',
    action_trace: '📋 Action Trace',
    ai_request: '🤖 AI Requests',
    ai_response: '💬 AI Responses',
    console_log: '🖥️ Console Logs',
    debug_log: '🔍 Debug Logs',
    session_summary: '📄 Session Summary',
  };

  for (const [type, label] of Object.entries(evidenceTypeLabels)) {
    const count = evidenceCounts[type] || 0;
    if (count > 0) {
      lines.push(`| ${label} | ${count} |`);
    }
  }
  lines.push('');

  // Action Trace
  const actionTraces = evidence.filter(e => e.type === 'action_trace');
  if (actionTraces.length > 0) {
    lines.push('## Action Trace');
    lines.push('');

    // Try to read the action trace file
    const tracePath = actionTraces[0].filePath;
    try {
      if (fs.existsSync(tracePath)) {
        const traceData = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
        if (Array.isArray(traceData) && traceData.length > 0) {
          lines.push('| Step | Action | Target | Result | Reasoning |');
          lines.push('| ---: | --- | --- | --- | --- |');
          for (const entry of traceData) {
            const target = entry.targetDescription || entry.text || '';
            const result = entry.result === 'success' ? '✅' : entry.result === 'failure' ? '❌' : '⚠️';
            lines.push(`| ${entry.step} | ${entry.action} | ${target.slice(0, 40)} | ${result} | ${entry.reasoning.slice(0, 60)}... |`);
          }
          lines.push('');
        }
      }
    } catch {
      lines.push('*Could not read action trace data.*');
      lines.push('');
    }
  }

  // Screenshots
  const screenshots = evidence.filter(e => e.type === 'screenshot');
  if (screenshots.length > 0) {
    lines.push('## Screenshots');
    lines.push('');
    for (const s of screenshots) {
      lines.push(`- **${s.summary}** — \`${path.basename(s.filePath)}\``);
    }
    lines.push('');
  }

  // AI Requests/Responses Summary
  const aiRequests = evidence.filter(e => e.type === 'ai_request');
  const aiResponses = evidence.filter(e => e.type === 'ai_response');
  if (aiRequests.length > 0 || aiResponses.length > 0) {
    lines.push('## AI Communication');
    lines.push('');
    lines.push(`- AI Requests: ${aiRequests.length}`);
    lines.push(`- AI Responses: ${aiResponses.length}`);
    lines.push('');
  }

  // Console Logs Reference
  const consoleLogs = evidence.filter(e => e.type === 'console_log');
  if (consoleLogs.length > 0) {
    lines.push('## Console Logs');
    lines.push('');
    lines.push(`Console output saved to: \`${consoleLogs[0].filePath}\``);
    lines.push('');
  }

  // Debug Log Reference
  const debugLogs = evidence.filter(e => e.type === 'debug_log');
  if (debugLogs.length > 0) {
    lines.push('## Debug Log');
    lines.push('');
    lines.push(`Full debug log saved to: \`${debugLogs[0].filePath}\``);
    lines.push('');
  }

  // Write report
  const markdown = lines.join('\n');
  const reportDir = path.join(project.workspacePath, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `dynamic-test-${session.name.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.md`);
  fs.writeFileSync(reportPath, markdown);

  return { reportPath, markdown };
}
