import type { Rule, Finding } from '../staticEngine.js';
import ts from 'typescript';

function findMatches(
  content: string,
  filePath: string,
  regex: RegExp,
  ruleId: string,
  severity: string,
  category: string,
  messageFn: (match: string) => string
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineRegex = new RegExp(regex.source, regex.flags);
    let m: RegExpExecArray | null;
    while ((m = lineRegex.exec(line)) !== null) {
      const evidence = m[0].length > 120 ? m[0].substring(0, 117) + '...' : m[0];
      findings.push({
        ruleId,
        filePath,
        lineNumber: i + 1,
        severity,
        category,
        message: messageFn(m[0]),
        evidence,
      });
    }
  }

  return findings;
}

const secretsRules: Rule[] = [
  {
    id: 'secrets-api-key',
    name: 'Hardcoded API Key',
    severity: 'critical',
    category: 'secrets',
    description: 'Detects hardcoded API keys, secrets, tokens, or passwords assigned to variables.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.env', '.yaml', '.yml', '.json', '.xml', '.cfg', '.ini', '.conf'],
    analyze(content: string, filePath: string): Finding[] {
      if (/\.[cm]?[jt]sx?$/i.test(filePath)) {
        const kind = /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX : /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX : /\.[cm]?js$/i.test(filePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
        const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
        const findings: Finding[] = [];
        const visit = (node: ts.Node) => {
          if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const name = ts.isBinaryExpression(node) ? node.left.getText(source) : node.name.getText(source);
            const value = ts.isBinaryExpression(node) ? node.right : node.initializer;
            const normalizedName = name.replace(/^['"]|['"]$/g, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2');
            if (/(?:^|[._])(?:api_?key|secret|token|password|passwd|secret_key|access_key|auth_token|private_key)$/i.test(normalizedName) && value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
              const literal = value.text;
              const symbolic = /^(?:access_token|refresh_token|csrf_token|id_token|authorization|your[_ -].*|example[_ -].*|placeholder|changeme|\$\{[^}]+\})$/i.test(literal);
              if (literal.length >= 8 && !symbolic) findings.push({ ruleId: 'secrets-api-key', filePath,
                lineNumber: source.getLineAndCharacterOfPosition(value.getStart(source)).line + 1, severity: 'high', category: 'secrets',
                message: `Possible hardcoded credential in "${name}". Verify whether this literal is sensitive and reachable before treating it as a leak.`, evidence: `${name} = [literal redacted]` });
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
        return findings;
      }
      // Match variable assignments with secret-like names and string values
      const pattern = /(?:(?:apiKey|api_key|secret|token|password|passwd|secret_key|access_key|auth_token|private_key)\s*[=:]\s*['"`][^'"`]{8,})/gi;
      return findMatches(content, filePath, pattern, 'secrets-api-key', 'critical', 'secrets', (match) => {
        const varName = match.split(/[=:]/)[0].trim();
        return `Hardcoded secret detected in variable "${varName}". Remove secrets from source code and use environment variables or a secrets manager.`;
      });
    },
  },
  {
    id: 'secrets-aws-key',
    name: 'AWS Access Key',
    severity: 'critical',
    category: 'secrets',
    description: 'Detects AWS access key IDs with the AKIA prefix.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.env', '.yaml', '.yml', '.json', '.xml', '.cfg', '.ini', '.conf'],
    analyze(content: string, filePath: string): Finding[] {
      const pattern = /AKIA[0-9A-Z]{16}/g;
      return findMatches(content, filePath, pattern, 'secrets-aws-key', 'critical', 'secrets', () => {
        return 'AWS access key detected. Rotate this key immediately and store credentials in AWS Secrets Manager or environment variables.';
      });
    },
  },
  {
    id: 'secrets-private-key',
    name: 'Private Key',
    severity: 'critical',
    category: 'secrets',
    description: 'Detects PEM-formatted private key headers.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.pem', '.key', '.env', '.yaml', '.yml'],
    analyze(content: string, filePath: string): Finding[] {
      const pattern = /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g;
      return findMatches(content, filePath, pattern, 'secrets-private-key', 'critical', 'secrets', () => {
        return 'Private key detected in source code. Never commit private keys to repositories. Use a secrets manager or vault.';
      });
    },
  },
  {
    id: 'secrets-connection-string',
    name: 'Connection String with Password',
    severity: 'critical',
    category: 'secrets',
    description: 'Detects database connection strings containing embedded passwords.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.env', '.yaml', '.yml', '.json', '.xml', '.cfg', '.ini', '.conf'],
    analyze(content: string, filePath: string): Finding[] {
      // Match patterns like: mongodb://user:password@host, mysql://user:pass@host, postgresql://user:pass@host, redis://user:pass@host
      const pattern = /(?:mongodb|mysql|postgres(?:ql)?|redis|amqp|mssql|oracle):\/\/[^\s'"`]+:[^\s'"`@]+@[^\s'"`]+/gi;
      return findMatches(content, filePath, pattern, 'secrets-connection-string', 'critical', 'secrets', () => {
        return 'Connection string with embedded credentials detected. Use environment variables or a secrets manager for database credentials.';
      });
    },
  },
  {
    id: 'secrets-jwt-token',
    name: 'JWT Token',
    severity: 'high',
    category: 'secrets',
    description: 'Detects hardcoded JWT tokens (base64 strings starting with eyJ).',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.env', '.yaml', '.yml', '.json', '.xml', '.cfg', '.ini', '.conf'],
    analyze(content: string, filePath: string): Finding[] {
      // JWTs are three base64 segments separated by dots, starting with eyJ
      const pattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
      return findMatches(content, filePath, pattern, 'secrets-jwt-token', 'high', 'secrets', () => {
        return 'Hardcoded JWT token detected. JWTs should not be committed to source code. Use environment variables or a secure token store.';
      });
    },
  },
  {
    id: 'secrets-bearer-token',
    name: 'Bearer Token in Code',
    severity: 'high',
    category: 'secrets',
    description: 'Detects hardcoded bearer tokens in authorization headers.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.env', '.yaml', '.yml'],
    analyze(content: string, filePath: string): Finding[] {
      const pattern = /(?:Authorization|authorization)\s*[:=]\s*['"`]Bearer\s+[A-Za-z0-9_\-\.]{20,}/g;
      return findMatches(content, filePath, pattern, 'secrets-bearer-token', 'high', 'secrets', () => {
        return 'Hardcoded bearer token detected. Move tokens to environment variables or a secrets manager.';
      });
    },
  },
];

export default secretsRules;
