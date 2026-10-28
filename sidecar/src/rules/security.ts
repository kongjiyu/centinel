import type { Rule, Finding } from '../staticEngine.js';
import ts from 'typescript';

const ALL_CODE_FILES = ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.cpp', '.c', '.h'];

const securityRules: Rule[] = [
  {
    id: 'sec-eval',
    name: 'eval() Usage',
    severity: 'critical',
    category: 'security',
    description: 'Detects use of eval() which can lead to code injection vulnerabilities.',
    filePatterns: ALL_CODE_FILES,
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      // Match eval( but not things like evaluate(
      const pattern = /\beval\s*\(/;

      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          findings.push({
            ruleId: 'sec-eval',
            filePath,
            lineNumber: i + 1,
            severity: 'critical',
            category: 'security',
            message: 'eval() usage detected. This can lead to code injection attacks. Use safer alternatives like JSON.parse() or Function constructor with input validation.',
            evidence: lines[i].trim().substring(0, 120),
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'sec-innerhtml',
    name: 'innerHTML Usage',
    severity: 'high',
    category: 'security',
    description: 'Detects innerHTML assignments which can lead to XSS (Cross-Site Scripting) vulnerabilities.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.html'],
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      const pattern = /\.innerHTML\s*=/;

      if (/\.[cm]?[jt]sx?$/i.test(filePath)) {
        const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true,
          /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX : /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX : /\.[cm]?js$/i.test(filePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
        const visit = (node: ts.Node) => {
          if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind)
            && ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'innerHTML')
              || ts.isElementAccessExpression(node.left) && ts.isStringLiteralLike(node.left.argumentExpression) && node.left.argumentExpression.text === 'innerHTML')
            && !ts.isStringLiteralLike(node.right)) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
            findings.push({ ruleId: 'sec-innerhtml', filePath, lineNumber: line + 1, severity: 'info', category: 'security',
              message: 'HTML injection sink needs flow verification. This assignment alone does not establish an exploitable XSS vulnerability.',
              evidence: lines[line].trim().slice(0, 120), confidence: 'low',
              recommendation: 'Trace the assigned value to its caller or input source. Verify the trust boundary, escaping and sanitization before promoting this observation to a vulnerability.' });
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
        return findings;
      }

      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          findings.push({
            ruleId: 'sec-innerhtml',
            filePath,
            lineNumber: i + 1,
            severity: 'info',
            category: 'security',
            message: 'Possible HTML injection sink. Verify executable context, input provenance and sanitization before reporting a vulnerability.',
            evidence: lines[i].trim().substring(0, 120),
            confidence: 'low',
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'sec-sql-injection',
    name: 'SQL String Concatenation',
    severity: 'critical',
    category: 'security',
    description: 'Detects SQL queries built via string concatenation, which are vulnerable to SQL injection.',
    filePatterns: ALL_CODE_FILES,
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');

      // Pattern 1: "SELECT..." + variable  or "INSERT..." + variable, etc.
      const concatPattern = /['"`]\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+[^'"`]*['"`]\s*\+\s*\w+/gi;

      // Pattern 2: Template literal with SQL keywords: `SELECT...${variable}`
      const templatePattern = /`[^`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+[^`]*\$\{[^}]+\}[^`]*`/gi;

      // Pattern 3: Query building with concatenation: query = "..." + variable
      const buildPattern = /=\s*['"`]\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+/gi;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let matched = false;

        if (concatPattern.test(line)) matched = true;
        concatPattern.lastIndex = 0;

        if (templatePattern.test(line)) matched = true;
        templatePattern.lastIndex = 0;

        if (buildPattern.test(line)) matched = true;
        buildPattern.lastIndex = 0;

        if (matched) {
          findings.push({
            ruleId: 'sec-sql-injection',
            filePath,
            lineNumber: i + 1,
            severity: 'critical',
            category: 'security',
            message: 'SQL query constructed via string concatenation or template literal. Use parameterized queries to prevent SQL injection.',
            evidence: line.trim().substring(0, 120),
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'sec-disabled-headers',
    name: 'Disabled Security Headers',
    severity: 'high',
    category: 'security',
    description: 'Detects disabled or overridden security headers like CSP, HSTS, or X-Frame-Options.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php'],
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');

      // Patterns for disabled security headers
      const disabledPatterns = [
        /(?:Content-Security-Policy|CSP)\s*[=:]\s*['"`]?(?:none|unsafe-inline|unsafe-eval|\*)/gi,
        /(?:Strict-Transport-Security|HSTS)\s*[=:]\s*['"`]?(?:off|false|0)/gi,
        /(?:X-Frame-Options)\s*[=:]\s*['"`]?(?:DENY|SAMEORIGIN|ALLOWALL)/gi,
        /(?:X-Content-Type-Options)\s*[=:]\s*['"`]?(?:none|false)/gi,
        /(?:helmet|csurf)\s*\(\s*\{[^}]*disabled\s*:\s*true/gi,
      ];

      for (let i = 0; i < lines.length; i++) {
        for (const pattern of disabledPatterns) {
          if (pattern.test(lines[i])) {
            findings.push({
              ruleId: 'sec-disabled-headers',
              filePath,
              lineNumber: i + 1,
              severity: 'high',
              category: 'security',
              message: 'Security header appears to be disabled or misconfigured. Enable proper security headers to protect against common attacks.',
              evidence: lines[i].trim().substring(0, 120),
            });
            break;
          }
          pattern.lastIndex = 0;
        }
      }
      return findings;
    },
  },
  {
    id: 'sec-hardcoded-url-creds',
    name: 'Hardcoded URL with Credentials',
    severity: 'critical',
    category: 'security',
    description: 'Detects URLs containing embedded usernames and passwords.',
    filePatterns: ALL_CODE_FILES,
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      // Match URLs like: https://user:password@host.com
      const pattern = /https?:\/\/[^\s'"`]+:[^\s'"`@]+@[^\s'"`]+/gi;

      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          findings.push({
            ruleId: 'sec-hardcoded-url-creds',
            filePath,
            lineNumber: i + 1,
            severity: 'critical',
            category: 'security',
            message: 'URL with embedded credentials detected. Use environment variables for authentication credentials.',
            evidence: lines[i].trim().substring(0, 120),
          });
        }
        pattern.lastIndex = 0;
      }
      return findings;
    },
  },
  {
    id: 'sec-math-random',
    name: 'Math.random() for Security',
    severity: 'high',
    category: 'security',
    description: 'Detects Math.random() used in security-sensitive contexts like tokens, passwords, or session IDs.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx'],
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      // Match Math.random() on lines with security-related variable names
      const securityContext = /(?:token|session|password|secret|nonce|salt|key|otp|code|verify|auth|csrf|uuid|guid)/i;
      const mathRandom = /Math\.random\s*\(/;

      for (let i = 0; i < lines.length; i++) {
        if (mathRandom.test(lines[i]) && securityContext.test(lines[i])) {
          findings.push({
            ruleId: 'sec-math-random',
            filePath,
            lineNumber: i + 1,
            severity: 'high',
            category: 'security',
            message: 'Math.random() used in security context. Math.random() is not cryptographically secure. Use crypto.randomBytes() or crypto.randomUUID() instead.',
            evidence: lines[i].trim().substring(0, 120),
          });
        }
      }
      return findings;
    },
  },
];

export default securityRules;
