import type { Rule, Finding } from '../staticEngine.js';

const ALL_CODE_FILES = ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', '.rs', '.cpp', '.c', '.h'];

const codeQualityRules: Rule[] = [
  {
    id: 'cq-todo-comments',
    name: 'TODO/FIXME/HACK/XXX Comments',
    severity: 'info',
    category: 'code_quality',
    description: 'Detects TODO, FIXME, HACK, and XXX comments that indicate incomplete or problematic code.',
    filePatterns: ALL_CODE_FILES,
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      const pattern = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i;

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(pattern);
        if (m) {
          const tag = m[1].toUpperCase();
          const note = m[2].trim();
          findings.push({
            ruleId: 'cq-todo-comments',
            filePath,
            lineNumber: i + 1,
            severity: tag === 'FIXME' || tag === 'HACK' ? 'medium' : 'info',
            category: 'code_quality',
            message: `${tag} comment found${note ? ': ' + note.substring(0, 80) : ''}. Address before release.`,
            evidence: lines[i].trim().substring(0, 120),
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'cq-console-log',
    name: 'Console/Print Debug Statements',
    severity: 'low',
    category: 'code_quality',
    description: 'Detects console.log, print(), and other debug output statements left in production code.',
    filePatterns: ALL_CODE_FILES,
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      // Match console.log, console.warn, console.error, console.info, console.debug, print(), fmt.Println, System.out.println
      const pattern = /(?:console\.(?:log|warn|error|info|debug)\s*\(|(?:^|\s)print\s*\(|fmt\.Println\s*\(|System\.out\.print)/;

      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          findings.push({
            ruleId: 'cq-console-log',
            filePath,
            lineNumber: i + 1,
            severity: 'low',
            category: 'code_quality',
            message: 'Debug output statement found. Remove or replace with proper logging before deployment.',
            evidence: lines[i].trim().substring(0, 120),
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'cq-empty-catch',
    name: 'Empty Catch Block',
    severity: 'medium',
    category: 'code_quality',
    description: 'Detects empty catch blocks that silently swallow exceptions.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.java', '.cs', '.go'],
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        // catch (e) { } or catch { } — catch followed by empty or whitespace-only block
        const catchMatch = lines[i].match(/\bcatch\s*(?:\([^)]*\))?\s*\{/);
        if (catchMatch) {
          // Check if the rest of the line and possibly next lines contain only whitespace/braces/comments
          let isEmpty = true;
          const remainingOnLine = lines[i].substring(lines[i].indexOf('{') + 1).trim();
          if (remainingOnLine.length > 0 && remainingOnLine !== '}') {
            isEmpty = false;
          }
          // Check next few lines for actual code (skip comments and empty lines)
          if (isEmpty) {
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
              const nextLine = lines[j].trim();
              if (nextLine === '}' || nextLine === '') continue;
              if (nextLine.startsWith('//') || nextLine.startsWith('/*') || nextLine.startsWith('*')) continue;
              // Found actual code — not empty
              isEmpty = false;
              break;
            }
          }
          if (isEmpty) {
            findings.push({
              ruleId: 'cq-empty-catch',
              filePath,
              lineNumber: i + 1,
              severity: 'medium',
              category: 'code_quality',
              message: 'Empty catch block silently swallows exceptions. Add error handling or re-throw the error.',
              evidence: lines[i].trim().substring(0, 120),
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'cq-long-function',
    name: 'Very Long Function',
    severity: 'medium',
    category: 'code_quality',
    description: 'Detects functions longer than 100 lines, which are harder to maintain and test.',
    filePatterns: ALL_CODE_FILES,
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');

      // Simple heuristic: look for function/method declarations and count lines until matching indent level
      const funcPattern = /^\s*(?:(?:export\s+)?(?:async\s+)?function\s|const\s+\w+\s*=\s*(?:async\s+)?(?:function|\()|(?:public|private|protected|static)\s+(?:async\s+)?\w+|def\s+\w+|fn\s+\w+)/;

      for (let i = 0; i < lines.length; i++) {
        if (funcPattern.test(lines[i])) {
          const startLine = i;
          const baseIndent = lines[i].match(/^(\s*)/)?.[1]?.length ?? 0;
          let endLine = i;

          // Walk forward to find the end of the function (simplified: look for closing brace at same indent)
          for (let j = i + 1; j < lines.length && j < i + 500; j++) {
            const lineIndent = lines[j].match(/^(\s*)/)?.[1]?.length ?? 0;
            if (lineIndent <= baseIndent && lines[j].trim().startsWith('}') || lines[j].trim() === '}') {
              endLine = j;
              break;
            }
          }

          const funcLength = endLine - startLine;
          if (funcLength > 100) {
            // Extract function name
            const nameMatch = lines[i].match(/(?:function|const|def|fn)\s+(\w+)/);
            const funcName = nameMatch?.[1] ?? 'anonymous';
            findings.push({
              ruleId: 'cq-long-function',
              filePath,
              lineNumber: startLine + 1,
              severity: 'medium',
              category: 'code_quality',
              message: `Function "${funcName}" is ${funcLength} lines long. Consider breaking it into smaller functions.`,
              evidence: `Function starts at line ${startLine + 1}, ends at line ${endLine + 1} (${funcLength} lines)`,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'cq-deep-nesting',
    name: 'Deep Nesting',
    severity: 'medium',
    category: 'code_quality',
    description: 'Detects code nested more than 4 levels deep, which reduces readability.',
    filePatterns: ALL_CODE_FILES,
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      const NESTING_THRESHOLD = 4;
      const reportedDepths = new Set<number>();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length === 0) continue;

        // Count nesting depth by counting leading spaces / tabs
        const leadingWhitespace = line.match(/^(\s*)/)?.[1] ?? '';
        // Approximate: 2 spaces or 1 tab = 1 level
        const spaces = leadingWhitespace.replace(/\t/g, '  ').length;
        const depth = Math.floor(spaces / 2);

        if (depth > NESTING_THRESHOLD) {
          // Avoid reporting the same nesting block repeatedly — only report at transitions
          const prevDepth = i > 0
            ? Math.floor(((lines[i - 1].match(/^(\s*)/)?.[1] ?? '').replace(/\t/g, '  ').length) / 2)
            : 0;
          if (depth > prevDepth || depth > NESTING_THRESHOLD) {
            if (!reportedDepths.has(depth)) {
              findings.push({
                ruleId: 'cq-deep-nesting',
                filePath,
                lineNumber: i + 1,
                severity: 'medium',
                category: 'code_quality',
                message: `Code is nested ${depth} levels deep. Reduce nesting by extracting logic or using early returns.`,
                evidence: line.trim().substring(0, 120),
              });
              reportedDepths.add(depth);
            }
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'cq-debugger',
    name: 'Debugger Statement',
    severity: 'medium',
    category: 'code_quality',
    description: 'Detects debugger statements that pause execution in development tools.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx'],
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      const pattern = /^\s*debugger\s*;?\s*$/;

      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          findings.push({
            ruleId: 'cq-debugger',
            filePath,
            lineNumber: i + 1,
            severity: 'medium',
            category: 'code_quality',
            message: 'Debugger statement found. Remove before deploying to production.',
            evidence: lines[i].trim(),
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'cq-alert',
    name: 'alert() Call',
    severity: 'low',
    category: 'code_quality',
    description: 'Detects alert() calls which are inappropriate for production code.',
    filePatterns: ['.ts', '.js', '.jsx', '.tsx', '.html'],
    analyze(content: string, filePath: string): Finding[] {
      const findings: Finding[] = [];
      const lines = content.split('\n');
      const pattern = /\balert\s*\(/;

      for (let i = 0; i < lines.length; i++) {
        // Skip HTML alert patterns in actual HTML files (like in scripts within HTML)
        if (pattern.test(lines[i])) {
          findings.push({
            ruleId: 'cq-alert',
            filePath,
            lineNumber: i + 1,
            severity: 'low',
            category: 'code_quality',
            message: 'alert() call found. Replace with proper UI notifications or logging.',
            evidence: lines[i].trim().substring(0, 120),
          });
        }
      }
      return findings;
    },
  },
];

export default codeQualityRules;
