/**
 * aiPrompt.test.ts — Live AI integration tests
 *
 * Skipped by default (CI-safe). Run with:
 *   AI_LIVE=true npx vitest run __tests__/integration/aiPrompt.test.ts
 *
 * Reads config from project-root .env (MIMO_API_KEY, MIMO_BASE_URL, MIMO_MODEL).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(import.meta.dirname, '../../../.env') });

const AI_LIVE = process.env.AI_LIVE === 'true';
const apiKey = process.env.MIMO_API_KEY;
const baseUrl = process.env.MIMO_BASE_URL;
const model = process.env.MIMO_MODEL;
const mode = 'anthropic'; // MiMo uses Anthropic-compatible API

const describeLive = AI_LIVE && apiKey && baseUrl && model ? describe : describe.skip;

// Pre-flight check
if (AI_LIVE && (!apiKey || !baseUrl || !model)) {
  console.warn('AI_LIVE=true but MIMO_API_KEY, MIMO_BASE_URL, or MIMO_MODEL missing from .env');
}

// ─── Sample artifacts ────────────────────────────────────────────────────────

const SAMPLE_REQUIREMENTS = `# E-Commerce Checkout Requirements

## REQ-001: Cart Display
The system shall display the shopping cart to the user. The page should be fast and user-friendly.

## REQ-002: Payment Processing
The system shall process payments. Users can pay with credit cards.

## REQ-003: Order Confirmation
After payment, the system shall show a confirmation. The order status should be "confirmed" or "pending".

## REQ-004: Inventory Check
Before checkout, the system shall verify inventory. If an item is out of stock, handle it appropriately.

## REQ-005: Shipping Calculation
The system shall calculate shipping costs. Free shipping for orders over $50. Shipping cost is always $5.99 regardless of order total.
`;

const SAMPLE_CODE = `import express from 'express';
import sqlite3 from 'sqlite3';

const app = express();
const db = new sqlite3.Database(':memory:');

// Get order by ID
app.get('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;
  const query = "SELECT * FROM orders WHERE id = '" + orderId + "'";
  db.get(query, (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    }
    res.json(row);
  });
});

// Create new order
app.post('/api/orders', (req, res) => {
  const { items, userId } = req.body;
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  db.run(
    'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)',
    [userId, total, 'confirmed'],
    function (err) {
      res.json({ id: this.lastID, total, status: 'confirmed' });
    }
  );
});

// Process refund
app.post('/api/orders/:id/refund', async (req, res) => {
  const orderId = req.params.id;
  await db.run('UPDATE orders SET status = "refunded" WHERE id = ?', orderId);
  // TODO: integrate with payment gateway
  res.json({ success: true });
});

// Admin: delete all orders
app.delete('/api/admin/orders', (req, res) => {
  db.run('DELETE FROM orders');
  res.json({ message: 'All orders deleted' });
});

const API_SECRET = 'sk-live-abc123xyz';
const PORT = process.env.PORT || 3000;
app.listen(PORT);
`;

// ─── Prompt configs (mirrors staticReview.ts) ────────────────────────────────

type ReviewType = 'requirement_review' | 'code_review' | 'requirement_to_code_traceability' | 'cross_artifact_consistency';

const REVIEW_PROMPTS: Record<ReviewType, { system: string; build: (artifacts: { name: string; type: string; content: string }[]) => string }> = {
  requirement_review: {
    system: `You are a senior software quality analyst specializing in requirement specification review. Your job is to analyze requirement documents and identify issues that could lead to poor implementation, ambiguity, or incomplete coverage.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "unclear_requirement", "missing_detail", "ambiguous_language", "unverifiable", "incomplete", "contradiction", "other"
- artifactReference: which file and section the finding relates to
- description: detailed explanation of the issue
- evidence: specific text or passage from the artifact that demonstrates the issue
- recommendation: concrete suggestion for fixing the issue
- confidence: one of "high", "medium", "low"

If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
      return `Analyze the following requirement document(s) for quality issues. Look for:\n- Unclear or ambiguous requirements\n- Missing details or specifications\n- Unverifiable or untestable requirements\n- Contradictions between requirements\n- Incomplete coverage\n\n${content}`;
    },
  },
  code_review: {
    system: `You are a senior software engineer performing code inspection. Your job is to analyze source code and identify potential defects, maintainability issues, missing validation, risky logic patterns, and code quality concerns.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "potential_bug", "missing_validation", "error_handling", "security_concern", "maintainability", "performance", "code_smell", "other"
- artifactReference: which file and function/section the finding relates to
- description: detailed explanation of the issue
- evidence: specific code snippet or pattern that demonstrates the issue
- recommendation: concrete suggestion for fixing the issue
- confidence: one of "high", "medium", "low"

If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
      return `Analyze the following source code for potential issues. Look for:\n- Potential bugs or logic errors\n- Missing input validation\n- Poor error handling\n- Security concerns\n- Maintainability issues\n- Risky patterns\n\n${content}`;
    },
  },
  requirement_to_code_traceability: {
    system: `You are a software quality analyst specializing in requirement-to-code traceability. Your job is to analyze requirement documents alongside source code to identify which requirements are implemented, partially implemented, or missing from the code.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "missing_implementation", "partial_implementation", "unclear_mapping", "extra_implementation", "well_covered"
- artifactReference: which requirement and/or code file the finding relates to
- description: detailed explanation of the traceability relationship
- evidence: specific requirement text and corresponding code (or lack thereof)
- recommendation: concrete suggestion for improving traceability
- confidence: one of "high", "medium", "low"

Focus especially on requirements that appear to have NO corresponding code implementation.
If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const reqs = artifacts.filter(a => a.type === 'requirement' || a.type === 'design');
      const code = artifacts.filter(a => a.type === 'source_code');
      const reqContent = reqs.map(a => `--- Requirement File: ${a.name} ---\n${a.content}`).join('\n\n');
      const codeContent = code.map(a => `--- Code File: ${a.name} ---\n${a.content}`).join('\n\n');
      return `Analyze the traceability between the following requirements and source code.\n\n## Requirements\n${reqContent}\n\n## Source Code\n${codeContent}\n\nFor each requirement, determine if it is implemented, partially implemented, or missing from the code. Identify any code that implements functionality not described in requirements.`;
    },
  },
  cross_artifact_consistency: {
    system: `You are a software quality analyst specializing in cross-artifact consistency checking. Your job is to compare different software artifacts (requirements, design documents, source code) and identify inconsistencies, mismatches, and conflicts.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "terminology_mismatch", "missing_entity", "conflicting_behavior", "naming_inconsistency", "missing_flow", "other"
- artifactReference: which files are involved in the inconsistency
- description: detailed explanation of the inconsistency
- evidence: specific text/code from each artifact that demonstrates the conflict
- recommendation: concrete suggestion for resolving the inconsistency
- confidence: one of "high", "medium", "low"

If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
      return `Analyze the following software artifacts for cross-artifact consistency. Look for:\n- Terminology mismatches between documents\n- Entities mentioned in requirements but missing in code/design\n- Conflicting behavior descriptions\n- Naming inconsistencies\n- Missing flows or features\n\n${content}`;
    },
  },
};

// ─── AI call helper ──────────────────────────────────────────────────────────

async function callAi(prompt: string, systemPrompt: string): Promise<string> {
  let body: string;
  let headers: Record<string, string>;

  if (mode === 'anthropic') {
    headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey! };
    body = JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
  } else {
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 4096,
    });
  }

  const res = await fetch(baseUrl!, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI API error: HTTP ${res.status} — ${text}`);
  }

  const json = await res.json();

  if (mode === 'anthropic') {
    const content = json.content;
    if (Array.isArray(content) && content.length > 0) return content[0].text ?? '';
    return json.completion ?? JSON.stringify(json);
  } else {
    return json.choices?.[0]?.message?.content ?? JSON.stringify(json);
  }
}

// ─── Parse findings (mirrors staticReview.ts) ────────────────────────────────

type ReviewFinding = {
  title: string;
  severity: string;
  category: string;
  artifactReference: string;
  description: string;
  evidence: string;
  recommendation: string;
  confidence: string;
};

function parseFindingsJson(raw: string): ReviewFinding[] {
  let jsonStr = raw.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) jsonStr = arrayMatch[0];

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      const obj = item as Record<string, unknown>;
      return typeof obj.title === 'string' && typeof obj.severity === 'string';
    }) as ReviewFinding[];
  } catch {
    return [];
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const VALID_SEVERITY = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

const artifacts = [
  { name: 'requirements.md', type: 'requirement', content: SAMPLE_REQUIREMENTS },
  { name: 'server.ts', type: 'source_code', content: SAMPLE_CODE },
];

async function callAndParse(type: ReviewType): Promise<{ raw: string; findings: ReviewFinding[] }> {
  const promptConfig = REVIEW_PROMPTS[type];
  const userPrompt = promptConfig.build(artifacts);
  const raw = await callAi(userPrompt, promptConfig.system);
  const findings = parseFindingsJson(raw);
  return { raw, findings };
}

describeLive('AI Prompt Quality (live)', () => {
  // 30s timeout for real API calls
  const TIMEOUT = 30_000;

  describe('requirement_review', () => {
    it('should return valid JSON findings', async () => {
      const { raw, findings } = await callAndParse('requirement_review');

      // Must parse to a non-empty array
      expect(findings.length).toBeGreaterThan(0);

      // Every finding must have required fields
      for (const f of findings) {
        expect(f.title).toBeTruthy();
        expect(f.description).toBeTruthy();
        expect(VALID_SEVERITY.has(f.severity)).toBe(true);
        expect(VALID_CONFIDENCE.has(f.confidence)).toBe(true);
      }
    }, TIMEOUT);

    it('should find at least one issue in the sample requirements', async () => {
      const { findings } = await callAndParse('requirement_review');

      // The sample has deliberate issues: vague "fast", contradictory shipping, unverifiable "user-friendly"
      const categories = new Set(findings.map(f => f.category));
      // Should catch at least some of: unclear_requirement, ambiguous_language, contradiction, unverifiable
      expect(categories.size).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  describe('code_review', () => {
    it('should return valid JSON findings', async () => {
      const { findings } = await callAndParse('code_review');

      expect(findings.length).toBeGreaterThan(0);

      for (const f of findings) {
        expect(f.title).toBeTruthy();
        expect(f.description).toBeTruthy();
        expect(VALID_SEVERITY.has(f.severity)).toBe(true);
        expect(VALID_CONFIDENCE.has(f.confidence)).toBe(true);
      }
    }, TIMEOUT);

    it('should detect SQL injection in the sample code', async () => {
      const { findings } = await callAndParse('code_review');

      // The sample has string concatenation SQL injection
      const allText = findings.map(f => `${f.title} ${f.description} ${f.evidence}`).join(' ').toLowerCase();
      const mentionsInjection = allText.includes('sql') || allText.includes('injection') || allText.includes('sanitiz') || allText.includes('parameteri');
      expect(mentionsInjection).toBe(true);
    }, TIMEOUT);
  });

  describe('requirement_to_code_traceability', () => {
    it('should return valid JSON findings', async () => {
      const { findings } = await callAndParse('requirement_to_code_traceability');

      expect(findings.length).toBeGreaterThan(0);

      for (const f of findings) {
        expect(f.title).toBeTruthy();
        expect(f.description).toBeTruthy();
        expect(VALID_SEVERITY.has(f.severity)).toBe(true);
        expect(VALID_CONFIDENCE.has(f.confidence)).toBe(true);
      }
    }, TIMEOUT);

    it('should identify requirements not implemented in code', async () => {
      const { findings } = await callAndParse('requirement_to_code_traceability');

      // Sample code doesn't implement inventory check or proper shipping calculation
      const categories = new Set(findings.map(f => f.category));
      expect(categories.has('missing_implementation') || categories.has('partial_implementation')).toBe(true);
    }, TIMEOUT);
  });

  describe('cross_artifact_consistency', () => {
    it('should return valid JSON findings', async () => {
      const { findings } = await callAndParse('cross_artifact_consistency');

      expect(findings.length).toBeGreaterThan(0);

      for (const f of findings) {
        expect(f.title).toBeTruthy();
        expect(f.description).toBeTruthy();
        expect(VALID_SEVERITY.has(f.severity)).toBe(true);
        expect(VALID_CONFIDENCE.has(f.confidence)).toBe(true);
      }
    }, TIMEOUT);

    it('should detect the shipping contradiction', async () => {
      const { findings } = await callAndParse('cross_artifact_consistency');

      // REQ-005 says "free shipping over $50" AND "always $5.99" — contradictory
      const allText = findings.map(f => `${f.title} ${f.description} ${f.evidence}`).join(' ').toLowerCase();
      const mentionsShipping = allText.includes('shipping') || allText.includes('contradict') || allText.includes('conflict');
      expect(mentionsShipping).toBe(true);
    }, TIMEOUT);
  });
});
