import { describe, it, expect } from 'vitest';
import { calculateRisk, scoreFindings, type RiskInput } from '../../src/riskScore.js';

describe('riskScore', () => {
  describe('calculateRisk', () => {
    it('returns high risk for critical severity + high confidence', () => {
      const input: RiskInput = {
        severity: 'critical',
        confidence: 'high',
        category: 'security_concern',
        filePath: 'src/auth/login.ts',
      };
      const result = calculateRisk(input);
      expect(result.risk.score).toBeGreaterThanOrEqual(0.7);
      expect(result.risk.level).toMatch(/critical|high/);
    });

    it('returns low risk for info severity + low confidence', () => {
      const input: RiskInput = {
        severity: 'info',
        confidence: 'low',
        category: 'code_smell',
        filePath: 'src/utils/helpers.ts',
      };
      const result = calculateRisk(input);
      expect(result.risk.score).toBeLessThan(0.3);
      expect(result.risk.level).toBe('info');
    });

    it('boosts score for security-sensitive paths', () => {
      const securityInput: RiskInput = {
        severity: 'medium',
        confidence: 'medium',
        category: 'error_handling',
        filePath: 'src/auth/middleware.ts',
      };
      const normalInput: RiskInput = {
        severity: 'medium',
        confidence: 'medium',
        category: 'error_handling',
        filePath: 'src/utils/logger.ts',
      };
      const securityResult = calculateRisk(securityInput);
      const normalResult = calculateRisk(normalInput);
      expect(securityResult.risk.score).toBeGreaterThan(normalResult.risk.score);
    });

    it('boosts score for security categories', () => {
      const secInput: RiskInput = {
        severity: 'medium',
        confidence: 'medium',
        category: 'sec-eval',
        filePath: 'src/app.ts',
      };
      const normalInput: RiskInput = {
        severity: 'medium',
        confidence: 'medium',
        category: 'maintainability',
        filePath: 'src/app.ts',
      };
      expect(calculateRisk(secInput).risk.factors.securityBoost).toBe(1.0);
      expect(calculateRisk(normalInput).risk.factors.securityBoost).toBe(0.0);
    });

    it('accounts for module importance via dependencies', () => {
      const coreInput: RiskInput = {
        severity: 'medium',
        confidence: 'medium',
        category: 'error_handling',
        filePath: 'src/core/index.ts',
        dependencies: 15,
        totalFiles: 50,
      };
      const leafInput: RiskInput = {
        severity: 'medium',
        confidence: 'medium',
        category: 'error_handling',
        filePath: 'src/utils/leaf.ts',
        dependencies: 0,
        totalFiles: 50,
      };
      const coreResult = calculateRisk(coreInput);
      const leafResult = calculateRisk(leafInput);
      expect(coreResult.risk.factors.moduleImportance).toBeGreaterThan(leafResult.risk.factors.moduleImportance);
    });
  });

  describe('scoreFindings', () => {
    it('scores a batch of findings', () => {
      const findings: RiskInput[] = [
        { severity: 'critical', confidence: 'high', category: 'security_concern', filePath: 'a.ts' },
        { severity: 'low', confidence: 'low', category: 'code_smell', filePath: 'b.ts' },
      ];
      const scored = scoreFindings(findings, 100);
      expect(scored).toHaveLength(2);
      expect(scored[0].risk.score).toBeGreaterThan(scored[1].risk.score);
    });

    it('returns empty array for empty input', () => {
      const scored = scoreFindings([], 100);
      expect(scored).toHaveLength(0);
    });

    it('handles missing dependency counts gracefully', () => {
      const findings: RiskInput[] = [
        { severity: 'medium', confidence: 'medium', category: 'error_handling', filePath: 'x.ts' },
      ];
      const scored = scoreFindings(findings, 50);
      expect(scored[0].risk.factors.moduleImportance).toBeGreaterThanOrEqual(0.3);
    });
  });
});
