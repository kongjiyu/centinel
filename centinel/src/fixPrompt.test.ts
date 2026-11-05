import { describe, expect, it } from 'vitest';
import { buildFixPrompt, redactSecrets } from './fixPrompt';
import type { Finding } from './types';

const base: Finding = {
  id: '3f2a9c10-1111-4222-8333-444455556666', projectId: '9d8c7b6a-1111-4222-8333-444455556666', sessionId: 'aaaaaaaa-1111-4222-8333-444455556666',
  source: 'static', verifier: 'model', severity: 'high', priority: 'High', riskLevel: 'critical',
  title: 'Order Ownership Check Missing',
  description: 'GET /orders/:id returns any order without checking that it belongs to the signed-in user.',
  recommendation: 'Compare order.userId with the authenticated user and return 404 when they differ.',
  status: 'new', createdAt: '2026-11-01T00:00:00Z', artifactId: 'bbbbbbbb-1111-4222-8333-444455556666', artifactVersionId: 'sha256:abc',
  category: 'security', evidenceText: 'const order = await db.orders.find(req.params.id);\nres.json(order);',
  confidence: 'high', fromRemarks: false, filePath: 'server/routes/orders.js', lineNumber: 42, requirementId: 'REQ-7',
  location: {
    domain: 'security',
    relatedLocations: [{ filePath: 'server/auth.js', lineNumber: 10, evidence: 'req.user = session.user;', sourceVersion: 'v1' }],
    sourceLocator: { filePath: 'docs/requirements.md', lineStart: 12, excerpt: 'Customers can only view\ntheir own orders.' },
  },
};

describe('buildFixPrompt', () => {
  it('includes the issue, risk, locations, evidence, explanation, remedy and requirement', () => {
    const prompt = buildFixPrompt(base);
    expect(prompt).toContain('Issue: Order Ownership Check Missing');
    expect(prompt).toContain('Risk: Critical, severity high, priority high');
    expect(prompt).toContain('Location: server/routes/orders.js:42');
    expect(prompt).toContain('Related locations:\n- server/auth.js:10');
    expect(prompt).toContain('Evidence (server/routes/orders.js):\n```js\nconst order = await db.orders.find(req.params.id);\nres.json(order);\n```');
    expect(prompt).toContain('What is wrong:\nGET /orders/:id returns any order');
    expect(prompt).toContain('What to do:\nCompare order.userId');
    expect(prompt).toContain('Requirement this code must satisfy:\n"Customers can only view their own orders."');
    expect(prompt.trimEnd().split('\n').slice(-4).join('\n')).toMatch(/smallest change[\s\S]*test that fails without the fix/);
  });

  it('never includes Centinel identifiers, provenance or other findings', () => {
    const prompt = buildFixPrompt({ ...base, description: `${base.description} (review aaaaaaaa-1111-4222-8333-444455556666)` });
    for (const secret of [base.id, base.projectId, base.sessionId!, base.artifactId!, 'sha256:abc', 'REQ-7', 'Finding ID', 'confidence']) expect(prompt).not.toContain(secret);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('omits sections that were not recorded and still asks for a test', () => {
    const prompt = buildFixPrompt({ ...base, filePath: '', lineNumber: null, evidenceText: '', recommendation: '', requirementId: null, priority: null, riskLevel: null, severity: 'low', location: null as never });
    expect(prompt).not.toContain('Location:');
    expect(prompt).not.toContain('Evidence');
    expect(prompt).not.toContain('What to do:');
    expect(prompt).not.toContain('Requirement');
    expect(prompt).toContain('Risk: Low, severity low');
    expect(prompt).toContain('add or update a test'.replace('add', 'Add'));
  });

  it('shortens long excerpts and keeps code fences intact', () => {
    const long = Array.from({ length: 40 }, (_, index) => `line ${index} \`\`\`nested\`\`\``).join('\n');
    const prompt = buildFixPrompt({ ...base, evidenceText: long });
    expect(prompt).toContain('line 19');
    expect(prompt).not.toContain('line 20 ');
    expect(prompt).toContain('````js\n');
    expect(prompt).toContain('\n…\n````');
  });

  it('redacts secret-looking values from evidence and prose', () => {
    const prompt = buildFixPrompt({ ...base, evidenceText: 'const API_KEY = "sk-live-abcdefghijklmnopqrstuvwxyz";\nfetch("https://admin:hunter2@example.com/api")', description: 'Token ghp_abcdefghijklmnopqrstuvwxyz0123456789 is hardcoded.' });
    expect(prompt).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(prompt).not.toContain('hunter2');
    expect(prompt).toContain('https://[redacted]@example.com');
    expect(redactSecrets('password: "correct horse"')).toBe('password: "[redacted]"');
  });

  it('uses the first related code excerpt when the finding has no own evidence', () => {
    const prompt = buildFixPrompt({ ...base, filePath: '', lineNumber: null, evidenceText: '' });
    expect(prompt).toContain('Evidence (server/auth.js):\n```js\nreq.user = session.user;\n```');
  });
});
