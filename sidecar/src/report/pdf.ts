import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import type { RiskLevel } from '../riskPolicy.js';
import { RISK_LABELS, RISK_MEANINGS, RISK_ORDER, friendlyDate, summarizeReport, type SummaryTone } from './summary.js';
import type { ProjectReportFinding, ProjectReportSnapshot, ReportCurrentFinding, ReportUsage } from './types.js';

/*
 * Two-part project report.
 *   Part 1 "Summary" is written for anyone: a verdict, a few numbers, a risk
 *   chart and plain next steps, all derived from the snapshot.
 *   Part 2 "Technical details" keeps the complete, exact record for
 *   developers and auditors (IDs, versions, timestamps, history, usage).
 */

const require = createRequire(import.meta.url);

const MARGIN = 48;
const TOP = 70;
const BOTTOM = 66;

const C = {
  ink: '#1c1917',
  muted: '#57534e',
  subtle: '#78716c',
  line: '#e7e5e4',
  track: '#f5f5f4',
  surface: '#ffffff',
  surfaceSubtle: '#fafaf9',
  primary: '#166534',
  primarySubtle: '#dcfce7',
  warning: '#b45309',
};

const TONES: Record<SummaryTone, { fg: string; bg: string; border: string }> = {
  critical: { fg: '#b91c1c', bg: '#fef2f2', border: '#f3c4c4' },
  warning: { fg: '#b45309', bg: '#fffbeb', border: '#f1d6a2' },
  good: { fg: '#15803d', bg: '#f0fdf4', border: '#b8e2c5' },
  neutral: { fg: '#57534e', bg: '#fafaf9', border: '#e7e5e4' },
};

const LEVELS: Record<RiskLevel | 'unclassified', { fg: string; bg: string; border: string }> = {
  critical: { fg: '#b91c1c', bg: '#fef2f2', border: '#f3c4c4' },
  high: { fg: '#c2410c', bg: '#fff7ed', border: '#f6cfb3' },
  medium: { fg: '#a16207', bg: '#fefce8', border: '#ecdca0' },
  low: { fg: '#57534e', bg: '#f5f5f4', border: '#e7e5e4' },
  unclassified: { fg: '#78716c', bg: '#fafaf9', border: '#e7e5e4' },
};

type Fonts = { regular: string; medium: string; semibold: string; bold: string; mono: string; embedded: boolean };

/** Prefer the app's IBM Plex Sans; fall back to the built-in Helvetica if it cannot be loaded. */
function registerFonts(doc: PDFKit.PDFDocument): Fonts {
  try {
    const file = (weight: number) => require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-' + weight + '-normal.woff');
    doc.registerFont('Plex', file(400));
    doc.registerFont('Plex-Medium', file(500));
    doc.registerFont('Plex-SemiBold', file(600));
    doc.registerFont('Plex-Bold', file(700));
    doc.font('Plex');
    return { regular: 'Plex', medium: 'Plex-Medium', semibold: 'Plex-SemiBold', bold: 'Plex-Bold', mono: 'Courier', embedded: true };
  } catch {
    return { regular: 'Helvetica', medium: 'Helvetica', semibold: 'Helvetica-Bold', bold: 'Helvetica-Bold', mono: 'Courier', embedded: false };
  }
}

/** Standard PDF fonts only cover ASCII: normalise punctuation and replace the rest. */
function asciiText(value: unknown): string {
  const input = String(value ?? '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2022\u00b7]/g, '-')
    .replace(/\u2026/g, '...');
  const normalized = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return Array.from(normalized, char => char === '\n' || char.charCodeAt(0) <= 126 ? char : '?').join('');
}

function isoDate(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: 'New', carryover: 'Carryover', accepted: 'Accepted', dismissed: 'Dismissed', fixed: 'Fixed',
    success: 'Completed', failure: 'Failed', failed: 'Failed', blocked: 'Needs attention',
    cancelled: 'Cancelled', pending_approval: 'Need approval', completed: 'Completed',
    approved: 'Completed', changes_requested: 'Changes requested', queued: 'Queued', running: 'In progress',
  };
  return labels[status] ?? status;
}

function executionBasisLabel(basis: 'completed_at' | 'progress.completedAt' | 'created_at' | 'unavailable' | undefined): string {
  switch (basis) {
    case 'completed_at': return 'saved completion time';
    case 'progress.completedAt': return 'frozen progress completion time';
    case 'created_at': return 'creation-time fallback';
    default: return 'unavailable';
  }
}

function currentDisposition(finding: ReportCurrentFinding): string {
  return finding.effectiveDisposition === 'resolved' ? 'Resolved' : statusLabel(finding.effectiveStatus);
}

function clip(text: string | null | undefined, max: number): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

export function renderProjectReportPdf(snapshot: ProjectReportSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: TOP, right: MARGIN, bottom: BOTTOM, left: MARGIN },
      bufferPages: true,
      info: {
        Title: 'Centinel quality report - ' + asciiText(snapshot.project.name),
        Author: snapshot.metadata.actorId ? 'Centinel user ' + snapshot.metadata.actorId : 'Centinel',
        Subject: 'Project quality report',
        Creator: 'Centinel ' + snapshot.metadata.generatorVersion,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      const fonts = registerFonts(doc);
      doc.font(fonts.regular);
      const face = (doc as unknown as { _font?: { font?: { hasGlyphForCodePoint?: (code: number) => boolean } } })._font?.font;
      /** Keep every character the embedded face can draw; replace the rest. */
      const clean = (value: unknown): string => {
        if (!fonts.embedded || !face?.hasGlyphForCodePoint) return asciiText(value);
        return Array.from(String(value ?? '').normalize('NFC'), char => {
          const code = char.codePointAt(0) ?? 0;
          if (char === '\n' || face.hasGlyphForCodePoint!(code)) return char;
          const stripped = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
          return stripped && Array.from(stripped).every(part => face.hasGlyphForCodePoint!(part.codePointAt(0) ?? 0)) ? stripped : '?';
        }).join('');
      };

      const summary = summarizeReport(snapshot);
      const X = MARGIN;
      const W = doc.page.width - MARGIN * 2;
      const bodyBottom = () => doc.page.height - BOTTOM;
      const ensure = (height: number) => {
        if (doc.y + height > bodyBottom()) doc.addPage();
      };
      const write = (text: string, x: number, y: number, options: { font?: string; size?: number; color?: string; width?: number; align?: 'left' | 'right' | 'center'; lineGap?: number; spacing?: number; mono?: boolean } = {}) => {
        doc.font(options.mono ? fonts.mono : options.font ?? fonts.regular).fontSize(options.size ?? 9.5).fillColor(options.color ?? C.ink);
        doc.text(options.mono ? asciiText(text) : clean(text), x, y, { width: options.width, align: options.align, lineGap: options.lineGap ?? 1.5, characterSpacing: options.spacing });
        return doc.y;
      };
      const measure = (text: string, font: string, size: number, width: number, lineGap = 1.5, mono = false) => {
        doc.font(mono ? fonts.mono : font).fontSize(size);
        return doc.heightOfString(mono ? asciiText(text) : clean(text), { width, lineGap });
      };
      const pill = (text: string, x: number, y: number, colors: { fg: string; bg: string; border: string }) => {
        doc.font(fonts.semibold).fontSize(8);
        const label = clean(text);
        const width = doc.widthOfString(label) + 14;
        doc.lineWidth(0.8).roundedRect(x, y, width, 16, 8).fillAndStroke(colors.bg, colors.border);
        doc.fillColor(colors.fg).text(label, x + 7, y + 3.6, { lineBreak: false });
        return width;
      };
      const pillWidth = (text: string) => {
        doc.font(fonts.semibold).fontSize(8);
        return doc.widthOfString(clean(text)) + 14;
      };
      const statusIcon = (tone: SummaryTone, cx: number, cy: number, radius: number) => {
        doc.circle(cx, cy, radius).fill(TONES[tone].fg);
        doc.save().strokeColor('#ffffff').lineWidth(radius / 6).lineCap('round').lineJoin('round');
        if (tone === 'good') {
          doc.moveTo(cx - radius * 0.42, cy + radius * 0.02).lineTo(cx - radius * 0.1, cy + radius * 0.34).lineTo(cx + radius * 0.44, cy - radius * 0.3).stroke();
        } else if (tone === 'neutral') {
          doc.moveTo(cx - radius * 0.4, cy).lineTo(cx + radius * 0.4, cy).stroke();
        } else {
          doc.moveTo(cx, cy - radius * 0.45).lineTo(cx, cy + radius * 0.1).stroke();
          doc.circle(cx, cy + radius * 0.42, radius / 11).fill('#ffffff');
        }
        doc.restore();
      };
      const sectionTitle = (text: string, intro?: string) => {
        ensure(intro ? 64 : 46);
        doc.y += 10;
        write(text, X, doc.y, { font: fonts.bold, size: 14 });
        if (intro) {
          doc.y += 1;
          write(intro, X, doc.y, { size: 9.5, color: C.muted, width: W });
        }
        doc.y += 10;
      };

      /* ───────────────────────────── Part 1: Summary ───────────────────────────── */

      doc.y = TOP;
      write(snapshot.metadata.reviewId ? 'REVIEW REPORT' : 'QUALITY REPORT', X, doc.y, { font: fonts.semibold, size: 8.5, color: C.primary, spacing: 1.2 });
      doc.y += 4;
      write(snapshot.project.name, X, doc.y, { font: fonts.bold, size: 24, width: W, lineGap: 1 });
      doc.y += 3;
      write('Generated ' + friendlyDate(snapshot.metadata.generatedAt) + '   ·   Prepared for ' + (snapshot.metadata.actorEmail ?? 'your team'), X, doc.y, { size: 9.5, color: C.muted, width: W });
      if (snapshot.project.description) {
        doc.y += 2;
        write(snapshot.project.description, X, doc.y, { size: 9.5, color: C.subtle, width: W });
      }
      doc.y += 16;

      // Verdict banner.
      {
        const tone = TONES[summary.tone];
        const textX = X + 22 + 40 + 14;
        const textW = W - (textX - X) - 22;
        const height = Math.max(76, measure(summary.headline, fonts.bold, 18, textW) + 6 + measure(summary.explanation, fonts.regular, 10.5, textW, 2) + 32);
        const top = doc.y;
        doc.lineWidth(1).roundedRect(X, top, W, height, 12).fillAndStroke(tone.bg, tone.border);
        statusIcon(summary.tone, X + 22 + 20, top + height / 2, 20);
        let y = top + 16;
        y = write(summary.headline, textX, y, { font: fonts.bold, size: 18, color: tone.fg, width: textW });
        write(summary.explanation, textX, y + 4, { size: 10.5, color: C.ink, width: textW, lineGap: 2 });
        doc.y = top + height + 14;
      }

      // Key numbers.
      {
        const nothingRan = !snapshot.latestReview && !snapshot.latestDynamicTest;
        const tiles: Array<{ label: string; value: string; caption: string; tone: SummaryTone; word: boolean }> = [
          { label: 'Open issues', value: String(summary.openIssues), caption: nothingRan ? 'no checks yet' : summary.openIssues ? 'still to look at' : 'nothing open', tone: nothingRan ? 'neutral' : summary.openIssues ? 'warning' : 'good', word: false },
          { label: 'Serious issues', value: String(summary.seriousIssues), caption: 'critical or high risk', tone: nothingRan ? 'neutral' : summary.seriousIssues ? 'critical' : 'good', word: false },
          { label: 'Code review', value: summary.codeReview.label, caption: snapshot.latestReview ? friendlyDate(snapshot.latestReview.session.executionTimestamp ?? snapshot.latestReview.session.updatedAt).replace(/,.*$/, '') : 'not run yet', tone: summary.codeReview.tone, word: true },
          { label: 'Browser test', value: summary.browserTest.label, caption: snapshot.latestDynamicTest ? friendlyDate(snapshot.latestDynamicTest.session.updatedAt).replace(/,.*$/, '') : 'not run yet', tone: summary.browserTest.tone, word: true },
        ];
        const gap = 10;
        const tileW = (W - gap * 3) / 4;
        const tileH = 80;
        ensure(tileH + 10);
        const top = doc.y;
        tiles.forEach((tile, index) => {
          const x = X + index * (tileW + gap);
          doc.lineWidth(0.8).roundedRect(x, top, tileW, tileH, 10).fillAndStroke(C.surface, C.line);
          doc.circle(x + 15, top + 18.5, 3.2).fill(TONES[tile.tone].fg);
          write(tile.label, x + 24, top + 12, { font: fonts.semibold, size: 8.5, color: C.muted, width: tileW - 32 });
          const valueColor = tile.tone === 'neutral' ? C.ink : TONES[tile.tone].fg;
          write(tile.value, x + 12, top + (tile.word ? 34 : 28), { font: fonts.bold, size: tile.word ? 13 : 24, color: valueColor, width: tileW - 20 });
          write(tile.caption, x + 12, top + tileH - 20, { size: 8, color: C.subtle, width: tileW - 20 });
        });
        doc.y = top + tileH + 6;
      }

      // Risk chart.
      sectionTitle('Open issues by risk level');
      if (!summary.openIssues) {
        write(snapshot.latestReview || snapshot.latestDynamicTest ? 'No open issues were found in the latest checks.' : 'Nothing to chart yet. Run a code review or browser test first.', X, doc.y, { size: 10, color: C.muted, width: W });
        doc.y += 4;
      } else {
        const levels = RISK_ORDER.filter(level => level !== 'unclassified' || summary.riskCounts.unclassified > 0);
        const max = Math.max(1, ...levels.map(level => summary.riskCounts[level]));
        const labelW = 72;
        const countW = 34;
        const trackX = X + labelW;
        const trackW = W - labelW - countW;
        ensure(levels.length * 24 + 24);
        levels.forEach(level => {
          const y = doc.y;
          const count = summary.riskCounts[level];
          write(RISK_LABELS[level], X, y + 2, { font: fonts.medium, size: 9.5, color: C.ink, width: labelW - 8 });
          doc.roundedRect(trackX, y + 4, trackW, 11, 5.5).fill(C.track);
          if (count > 0) doc.roundedRect(trackX, y + 4, Math.max(11, (trackW * count) / max), 11, 5.5).fill(LEVELS[level].fg);
          write(String(count), trackX + trackW, y + 2, { font: fonts.semibold, size: 10, color: count ? LEVELS[level].fg : C.subtle, width: countW, align: 'right' });
          doc.y = y + 24;
        });
        write('Critical and high issues should be fixed before you release. Medium and low issues can be planned.', X, doc.y + 2, { size: 8.5, color: C.subtle, width: W });
        doc.y += 4;
      }

      // What was checked.
      sectionTitle('What Centinel checked');
      {
        const rows: Array<{ title: string; status: { label: string; tone: SummaryTone }; lines: string[] }> = [
          {
            title: 'Code review',
            status: summary.codeReview,
            lines: [
              snapshot.latestReview ? '"' + snapshot.latestReview.session.name + '". ' + summary.codeReview.detail : summary.codeReview.detail,
            ],
          },
          {
            title: 'Browser test',
            status: summary.browserTest,
            lines: snapshot.latestDynamicTest
              ? ['"' + snapshot.latestDynamicTest.session.name + '". ' + summary.browserTest.detail, 'Website: ' + snapshot.latestDynamicTest.session.targetUrl]
              : [summary.browserTest.detail],
          },
        ];
        rows.forEach(row => {
          const textW = W - 120;
          const height = 6 + row.lines.reduce((sum, text) => sum + measure(text, fonts.regular, 9.5, textW, 2) + 2, 0);
          ensure(Math.max(height, 22) + 10);
          const top = doc.y;
          write(row.title, X, top + 1, { font: fonts.semibold, size: 10, width: 108 });
          let y = top;
          row.lines.forEach((text, index) => {
            y = write(text, X + 120, y, { size: 9.5, color: index ? C.subtle : C.ink, width: textW - 96, lineGap: 2 }) + 2;
          });
          pill(row.status.label, X + W - pillWidth(row.status.label), top, TONES[row.status.tone]);
          doc.y = Math.max(y, top + 20) + 8;
          doc.lineWidth(0.6).strokeColor(C.line).moveTo(X, doc.y - 4).lineTo(X + W, doc.y - 4).stroke();
        });

        // Requirements traceability as a stacked bar.
        ensure(52);
        const top = doc.y;
        write('Requirements', X, top + 1, { font: fonts.semibold, size: 10, width: 108 });
        if (!summary.requirements) {
          write('No requirements were linked to the latest code review, so Centinel could not check that each one is implemented.', X + 120, top, { size: 9.5, color: C.ink, width: W - 120, lineGap: 2 });
          doc.y += 8;
        } else {
          const { complete, incomplete, missing } = summary.requirements;
          const total = Math.max(1, complete + incomplete + missing);
          const barX = X + 120;
          const barW = W - 120;
          const parts: Array<[number, string, string]> = [
            [complete, TONES.good.fg, plural(complete, 'requirement') + ' implemented'],
            [incomplete, TONES.warning.fg, incomplete + ' partly implemented'],
            [missing, '#a8a29e', missing + ' not linked to code yet'],
          ];
          doc.save().roundedRect(barX, top + 3, barW, 12, 6).clip();
          doc.rect(barX, top + 3, barW, 12).fill(C.track);
          let x = barX;
          parts.forEach(([count, color]) => {
            if (!count) return;
            const width = (barW * count) / total;
            doc.rect(x, top + 3, width, 12).fill(color);
            x += width;
          });
          doc.restore();
          let legendX = barX;
          parts.forEach(([, color, label]) => {
            doc.circle(legendX + 4, top + 28, 3.5).fill(color);
            write(label, legendX + 11, top + 23, { size: 8.5, color: C.muted });
            doc.font(fonts.regular).fontSize(8.5);
            legendX += doc.widthOfString(clean(label)) + 26;
          });
          doc.y = top + 42;
        }
      }

      // Next steps, kept together with their heading.
      ensure(56 + summary.nextSteps.reduce((sum, step) => sum + measure(step, fonts.regular, 10, W - 30, 2.5) + 14, 0));
      sectionTitle('What to do next');
      summary.nextSteps.forEach((step, index) => {
        const textW = W - 30;
        const height = measure(step, fonts.regular, 10, textW, 2.5);
        ensure(height + 10);
        const top = doc.y;
        doc.circle(X + 10, top + 7.5, 9).fill(C.primary);
        write(String(index + 1), X + 1, top + 1.6, { font: fonts.bold, size: 9.5, color: '#ffffff', width: 18, align: 'center' });
        write(step, X + 28, top, { size: 10, width: textW, lineGap: 2.5 });
        doc.y = Math.max(doc.y, top + 18) + 8;
      });

      // Top issues explained. Cards move to a new page only when they do not fit.
      doc.y += 6;
      ensure(summary.topIssues.length ? 250 : 120);
      sectionTitle('Top issues explained', summary.topIssues.length ? 'The most important open issues, highest risk first.' : undefined);
      if (!summary.topIssues.length) {
        const message = snapshot.latestReview || snapshot.latestDynamicTest
          ? 'There are no open issues. Nothing needs fixing from the latest checks.'
          : 'No checks have finished yet, so there are no issues to explain.';
        const top = doc.y;
        doc.lineWidth(0.8).roundedRect(X, top, W, 46, 10).fillAndStroke(C.surfaceSubtle, C.line);
        write(message, X + 16, top + 15, { size: 10, color: C.muted, width: W - 32 });
        doc.y = top + 58;
      }
      summary.topIssues.forEach(issue => {
        const innerX = X + 16;
        const innerW = W - 32;
        const blocks: Array<[string, string, boolean]> = [];
        if (issue.whatIsWrong) blocks.push(['What is wrong', issue.whatIsWrong, false]);
        if (issue.howToFix) blocks.push(['How to fix it', issue.howToFix, false]);
        if (issue.location) blocks.push(['Where', issue.location, true]);
        const blockHeight = blocks.reduce((sum, [, text, mono]) => sum + 13 + measure(text, fonts.regular, mono ? 8.5 : 9.5, innerW, 2, mono) + 7, 0);
        const height = 14 + 16 + 8 + measure(issue.title, fonts.bold, 11.5, innerW) + 6 + blockHeight + 8;
        ensure(height + 10);
        const top = doc.y;
        const level = issue.riskLevel ?? 'unclassified';
        doc.lineWidth(0.8).roundedRect(X, top, W, height, 10).fillAndStroke(C.surface, C.line);
        doc.save().roundedRect(X, top, W, height, 10).clip();
        doc.rect(X, top, 4, height).fill(LEVELS[level].fg);
        doc.restore();
        let px = innerX;
        px += pill(RISK_LABELS[level] + ' risk', px, top + 14, LEVELS[level]) + 6;
        pill(issue.origin, px, top + 14, { fg: C.muted, bg: C.surfaceSubtle, border: C.line });
        let y = write(issue.title, innerX, top + 14 + 16 + 8, { font: fonts.bold, size: 11.5, width: innerW }) + 6;
        blocks.forEach(([label, text, mono]) => {
          write(label.toUpperCase(), innerX, y, { font: fonts.semibold, size: 7.5, color: C.subtle, spacing: 0.8 });
          y = write(text, innerX, y + 13, { size: mono ? 8.5 : 9.5, color: mono ? C.muted : C.ink, width: innerW, lineGap: 2, mono }) + 7;
        });
        doc.y = top + height + 10;
      });
      if (summary.remainingIssues) {
        write('+ ' + plural(summary.remainingIssues, 'more open issue') + ', listed in Part 2: Technical details.', X, doc.y, { size: 9.5, color: C.muted, width: W });
        doc.y += 6;
      }

      // Browser test result.
      if (snapshot.latestDynamicTest) {
        const test = snapshot.latestDynamicTest;
        const rows: Array<[string, string]> = [
          ['What it checked', clip(test.session.goal, 420)],
          ['Website', test.session.targetUrl],
          ['Result', summary.browserTest.detail],
        ];
        if (test.summary) rows.push(['Summary', clip(test.summary, 420)]);
        const innerW = W - 32 - 110;
        const height = 16 + 18 + 10 + rows.reduce((sum, [, text]) => sum + Math.max(14, measure(text, fonts.regular, 9.5, innerW, 2)) + 8, 0) + 4;
        ensure(height + 56);
        sectionTitle('Browser test result');
        const top = doc.y;
        const tone = TONES[summary.browserTest.tone];
        doc.lineWidth(0.8).roundedRect(X, top, W, height, 10).fillAndStroke(C.surface, C.line);
        write(test.session.name, X + 16, top + 16, { font: fonts.bold, size: 11.5, width: W - 160 });
        pill(summary.browserTest.label, X + W - 16 - pillWidth(summary.browserTest.label), top + 15, tone);
        let y = top + 16 + 18 + 10;
        rows.forEach(([label, text]) => {
          write(label, X + 16, y, { font: fonts.semibold, size: 9, color: C.muted, width: 104 });
          y = Math.max(write(text, X + 16 + 110, y, { size: 9.5, width: innerW, lineGap: 2 }), y + 14) + 8;
        });
        doc.y = top + height + 10;
      }

      // Glossary, kept together with its heading.
      ensure(56 + 4 * 24);
      sectionTitle('What the risk levels mean');
      (['critical', 'high', 'medium', 'low'] as RiskLevel[]).forEach(level => {
        ensure(24);
        const top = doc.y;
        pill(RISK_LABELS[level], X, top, LEVELS[level]);
        write(RISK_MEANINGS[level], X + 72, top + 2, { size: 9.5, color: C.ink, width: W - 72 });
        doc.y = Math.max(doc.y, top + 16) + 7;
      });

      /* ─────────────────────── Part 2: Technical details ───────────────────────── */

      doc.addPage();
      const partTwoStart = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
      doc.y = TOP;
      write('PART 2', X, doc.y, { font: fonts.semibold, size: 8.5, color: C.primary, spacing: 1.2 });
      doc.y += 4;
      write('Technical details', X, doc.y, { font: fonts.bold, size: 22 });
      doc.y += 2;
      write('For developers and auditors: exact IDs, versions and timestamps, the full finding history, evidence and model usage.', X, doc.y, { size: 9.5, color: C.muted, width: W });
      doc.y += 8;

      const heading = (text: string) => {
        ensure(52);
        doc.y += 12;
        write(text, X, doc.y, { font: fonts.bold, size: 12.5, color: C.primary });
        doc.y += 3;
        doc.lineWidth(0.6).strokeColor(C.line).moveTo(X, doc.y).lineTo(X + W, doc.y).stroke();
        doc.y += 8;
      };
      const subheading = (text: string) => {
        ensure(30);
        doc.y += 3;
        write(text, X, doc.y, { font: fonts.semibold, size: 10, width: W });
        doc.y += 3;
      };
      const line = (text: unknown, options: { size?: number; color?: string; indent?: number; after?: number; bold?: boolean } = {}) => {
        const size = options.size ?? 9;
        const indent = options.indent ?? 0;
        const height = measure(String(text ?? ''), options.bold ? fonts.semibold : fonts.regular, size, W - indent, 2);
        ensure(Math.min(height, 40));
        write(String(text ?? ''), X + indent, doc.y, { font: options.bold ? fonts.semibold : fonts.regular, size, color: options.color ?? C.ink, width: W - indent, lineGap: 2 });
        doc.y += options.after ?? 2;
      };
      const muted = (text: string) => line(text, { size: 8.5, color: C.subtle, after: 4 });
      const bullet = (text: string) => {
        const height = measure(text, fonts.regular, 8.5, W - 14, 2);
        ensure(Math.min(height, 40));
        const top = doc.y;
        doc.circle(X + 4, top + 5.5, 1.6).fill(C.subtle);
        write(text, X + 14, top, { size: 8.5, color: C.ink, width: W - 14, lineGap: 2 });
        doc.y += 2;
      };
      const keyValues = (items: Array<[string, unknown]>) => {
        const labelW = 150;
        items.forEach(([label, value]) => {
          const text = String(value ?? 'Unavailable');
          const height = measure(text, fonts.regular, 8.5, W - labelW, 1.5);
          ensure(Math.min(height, 40) + 3);
          const top = doc.y;
          write(label, X, top, { font: fonts.semibold, size: 8.5, color: C.muted, width: labelW - 10 });
          const afterValue = write(text, X + labelW, top, { size: 8.5, width: W - labelW, lineGap: 1.5 });
          doc.y = Math.max(afterValue, top + 12) + 3;
        });
        doc.y += 4;
      };
      const drawFinding = (finding: ProjectReportFinding, index: number) => {
        subheading(String(index + 1) + '. ' + finding.title);
        keyValues([
          ['Risk', finding.riskLevel ?? 'Not classified'],
          ['Severity / priority', finding.severity + ' / ' + (finding.priority ?? 'Not supplied')],
          ['State', statusLabel(finding.status)],
          ['Module / category', finding.source + ' / ' + finding.category],
          ['Finding ID', finding.id],
          ['Location', finding.filePath ? finding.filePath + (finding.lineNumber ? ':' + finding.lineNumber : '') : 'Unavailable'],
          ['Created', isoDate(finding.createdAt)],
        ]);
        if (finding.description) line(finding.description, { size: 8.5, color: C.muted, after: 4 });
        if (finding.evidenceText) {
          line('Evidence', { size: 8.5, bold: true, after: 1 });
          line(finding.evidenceText, { size: 8.5, color: C.muted, indent: 10, after: 4 });
        }
        if (finding.recommendation) line('Recommendation: ' + finding.recommendation, { size: 8.5, after: 6 });
      };
      const drawCurrentFinding = (finding: ReportCurrentFinding, index: number) => {
        subheading(String(index + 1) + '. ' + finding.title);
        keyValues([
          ['Canonical finding ID', finding.id],
          ['Source module', finding.source],
          ['Persisted status', statusLabel(finding.persistedStatus)],
          ['Effective disposition', currentDisposition(finding)],
          ['Risk level', finding.riskLevel ?? 'Not classified'],
          ['Location', finding.filePath ? finding.filePath + (finding.lineNumber ? ':' + finding.lineNumber : '') : 'Unavailable'],
          ['Latest occurrence', finding.latestOccurrence
            ? finding.latestOccurrence.findingId + ' / Review ' + (finding.latestOccurrence.reviewId ?? 'Unavailable') + ' / ' + finding.latestOccurrence.classification
            : 'Canonical finding'],
          ['Lineage references', finding.lineageReferences.length
            ? finding.lineageReferences.map(item => item.findingId + ' / Review ' + (item.reviewId ?? 'Unavailable') + ' / ' + item.classification).join('; ')
            : 'None'],
        ]);
        if (finding.resolutionEvidence) {
          muted('Resolution basis: not reproduced in comparable Review ' + finding.resolutionEvidence.reviewId
            + '; source version changed from ' + finding.resolutionEvidence.previousSourceVersion
            + ' to ' + finding.resolutionEvidence.reviewedSourceVersion + '.');
        }
      };
      const appendUsage = (usage: ReportUsage) => {
        if (usage.status !== 'available' || !usage.totals) {
          line('Usage unavailable: ' + (usage.reason ?? 'No model-usage records were persisted.'), { size: 8.5, color: C.warning });
          return;
        }
        keyValues([
          ['Calls', usage.totals.calls.toLocaleString('en-US')],
          ['Input / output tokens', usage.totals.input.toLocaleString('en-US') + ' / ' + usage.totals.output.toLocaleString('en-US')],
          ['Cache reads / creation', usage.totals.cacheRead.toLocaleString('en-US') + ' / ' + usage.totals.cacheCreation.toLocaleString('en-US')],
        ]);
        usage.byModel.forEach(group => bullet(
          group.provider + ' / ' + group.model + ': ' + group.calls.toLocaleString('en-US') + ' calls, '
          + group.input.toLocaleString('en-US') + ' input, ' + group.output.toLocaleString('en-US') + ' output tokens',
        ));
        doc.y += 4;
      };

      heading('About this report');
      keyValues([
        ['Project', snapshot.project.name],
        ['Project ID', snapshot.project.id],
        ['Report ID', snapshot.metadata.reportId],
        ['Generated', isoDate(snapshot.metadata.generatedAt)],
        ['Generated by', snapshot.metadata.actorEmail ?? snapshot.metadata.actorId ?? 'Unavailable'],
        ['Report format version', snapshot.metadata.generatorVersion],
        ['Risk policy version', snapshot.metadata.riskPolicyVersion],
        ...(snapshot.metadata.reviewId ? [['Focused Review', snapshot.metadata.reviewId] as [string, unknown]] : []),
      ]);

      heading('Risk assessment');
      keyValues([
        ['Current static risk items', snapshot.riskAssessment.currentFindingCount],
        ['Critical / high', snapshot.riskAssessment.critical + ' / ' + snapshot.riskAssessment.high],
        ['Medium / low', snapshot.riskAssessment.medium + ' / ' + snapshot.riskAssessment.low],
        ['Unclassified', snapshot.riskAssessment.unclassified],
      ]);
      muted('Dynamic findings are included in the inventory but remain outside this static risk policy.');
      if (snapshot.riskAssessment.items.length) {
        subheading('Current risk items');
        snapshot.riskAssessment.items.forEach(finding =>
          bullet((finding.riskLevel ?? 'Unclassified') + ' - ' + finding.title + ' (' + statusLabel(finding.status) + ')'));
      } else muted('No current risk items are available.');

      heading('Current project findings');
      if (!snapshot.currentFindings || snapshot.currentFindings.status === 'unavailable') {
        line('Current finding inventory unavailable: ' + (snapshot.currentFindings?.reason ?? 'this legacy report snapshot has no reconciled current inventory.'), { size: 8.5, color: C.warning });
      } else if (!snapshot.currentFindings.items.length) {
        muted('No current findings were returned by the reconciled project projection.');
      } else snapshot.currentFindings.items.forEach(drawCurrentFinding);

      heading('Historical finding occurrences');
      muted('Saved states in this section are immutable historical occurrences and may repeat one canonical issue. Per-Review findings remain session-scoped.');
      if (!snapshot.findings.length) muted('No findings have been recorded.');
      else snapshot.findings.forEach(drawFinding);

      heading('Latest Static Review attempt');
      if (!snapshot.latestReview) {
        muted('Unavailable: no terminal Review record is available for this project.');
      } else {
        const review = snapshot.latestReview;
        const lifecycle = review.decision?.decision === 'approved'
          ? 'Completed'
          : review.decision?.decision === 'changes_requested'
            ? 'Changes requested'
            : review.session.status === 'success' ? 'Need approval' : statusLabel(review.session.status);
        keyValues([
          ['Review', review.session.name],
          ['Review ID', review.session.id],
          ['Lifecycle state', lifecycle],
          ['Execution status', statusLabel(review.session.status)],
          ['Decision', review.decision ? statusLabel(review.decision.decision) : 'No decision recorded'],
          ['Execution time', isoDate(review.session.executionTimestamp) + ' (' + executionBasisLabel(review.session.executionTimestampBasis) + ')'],
          ['Created', isoDate(review.session.createdAt)],
          ['Last activity', isoDate(review.session.updatedAt)],
          ['Decision time', isoDate(review.decision?.createdAt)],
        ]);
        line('Summary: ' + (review.summary ?? 'No summary was recorded.'), { size: 8.5, color: C.muted, after: 4 });
        if (review.session.failureReason) line('Failure reason: ' + review.session.failureReason, { size: 8.5, color: C.warning });
        if (review.decision?.comment) line('Decision feedback: ' + review.decision.comment, { size: 8.5 });
        if (review.decision?.attachments.length) {
          subheading('Decision attachments');
          review.decision.attachments.forEach(item => bullet(item.fileName + ' - ' + item.mimeType + ' - ' + isoDate(item.createdAt)));
        }

        subheading('Reported findings');
        if (!review.reportedFindings.length) muted('No newly reported findings are persisted for this Review.');
        else review.reportedFindings.forEach(drawFinding);
        subheading('Carryover findings');
        if (!review.carryoverFindings.length) muted('No carryover findings are persisted for this Review.');
        else review.carryoverFindings.forEach(drawFinding);
        if (review.findingClassificationStatus === 'unavailable') {
          line('Recurring and other cross-Review classifications are unavailable for this record and are not inferred.', { size: 8.5, color: C.warning });
        } else {
          line('Cross-Review classification: available', { size: 8.5, color: C.primary });
          if (review.recurringFindings?.length) muted('Recurring findings: ' + review.recurringFindings.length);
          review.correlations?.forEach(item => bullet(item.classification + ' / ' + item.method + ' / score ' + item.score + ' - ' + (item.childFindingId ?? item.parentFindingId ?? 'Unavailable')));
        }

        subheading('Source manifest');
        keyValues([
          ['Status', statusLabel(review.sourceManifest.status)],
          ['Captured', isoDate(review.sourceManifest.capturedAt)],
          ['Artifacts reviewed', review.sourceManifest.artifactCount ?? 'Unavailable'],
        ]);
        if (!review.sourceManifest.sources.length) muted('No source-manifest items are available.');
        else review.sourceManifest.sources.forEach(source =>
          bullet(source.label + ' - ' + source.filesReviewed + ' file(s); hashes: ' + (source.contentHashes.join(', ') || 'Unavailable')));

        subheading('Traceability');
        keyValues([['Snapshot status', statusLabel(review.traceability.status)]]);
        if (review.traceability.summary) {
          keyValues([
            ['Complete / incomplete / missing', review.traceability.summary.complete + ' / ' + review.traceability.summary.incomplete + ' / ' + review.traceability.summary.missing],
            ['Attention', review.traceability.summary.attention],
          ]);
        } else muted('Unavailable: this Review has no persisted traceability snapshot.');
        review.traceability.records.forEach(record =>
          bullet(record.title + ' - ' + record.state + '; evidence: ' + (record.evidenceStatus ?? 'Historical evidence unavailable') + '; mappings: ' + record.mappingIds.length + '; source artifacts: ' + (record.sourceArtifactIds.join(', ') || 'None')));

        subheading('Review model usage');
        appendUsage(review.modelUsage);
      }

      heading('Latest existing Dynamic Test');
      if (!snapshot.latestDynamicTest) {
        muted('Unavailable: no terminal Dynamic Test summary is available for this project.');
      } else {
        const dynamic = snapshot.latestDynamicTest;
        keyValues([
          ['Test', dynamic.session.name],
          ['Test ID', dynamic.session.id],
          ['Status', statusLabel(dynamic.session.status)],
          ['Target', dynamic.session.targetUrl],
          ['Goal', dynamic.session.goal],
          ['Created / updated', isoDate(dynamic.session.createdAt) + ' / ' + isoDate(dynamic.session.updatedAt)],
        ]);
        line('Summary: ' + (dynamic.summary ?? 'No summary was recorded.'), { size: 8.5, color: C.muted, after: 4 });
        if (dynamic.failureReason) line('Failure reason: ' + dynamic.failureReason, { size: 8.5, color: C.warning });
        subheading('Evidence references');
        if (!dynamic.evidence.length) muted('No evidence references are recorded.');
        dynamic.evidence.forEach(item => bullet(item.type + ' - ' + item.summary + ' - ' + (item.path ?? 'Location unavailable') + ' - ' + isoDate(item.createdAt)));
        subheading('Action trace');
        if (!dynamic.actionTrace.length) muted('No action trace is available.');
        dynamic.actionTrace.forEach(item => bullet(String(item.step) + '. ' + item.action + ' - ' + item.target + ' - ' + item.result));
        muted('Raw console output and model request/response payloads are not included.');
      }

      heading('Project sources');
      keyValues([['Source artifacts recorded', snapshot.sourceInventory.artifactCount]]);
      snapshot.sourceInventory.artifacts.forEach(artifact =>
        bullet(artifact.fileName + ' - ' + artifact.type + ' / ' + artifact.source + ' - ' + artifact.path + ' - SHA-256 ' + artifact.contentHash));
      if (!snapshot.sourceInventory.artifacts.length) muted('No source artifacts are recorded.');

      heading('Requirements');
      if (!snapshot.requirements.items.length) muted('No structured requirements are recorded.');
      snapshot.requirements.items.forEach(requirement => {
        subheading(requirement.title);
        keyValues([
          ['Requirement ID', requirement.id],
          ['Category / priority', (requirement.category || 'Not supplied') + ' / ' + (requirement.priority || 'Not supplied')],
        ]);
        if (requirement.description) muted(requirement.description);
        if (requirement.mappings.length) requirement.mappings.forEach(mapping =>
          bullet(mapping.coverageStatus + ' - confidence ' + mapping.confidence + ' - artifact ' + (mapping.fileId ?? 'Unavailable')));
        else muted('No source mappings are recorded.');
      });

      heading('Coding standards');
      if (!snapshot.standards.items.length) muted('No coding-standard artifacts are recorded.');
      snapshot.standards.items.forEach(standard => {
        bullet(standard.title + ' - ' + standard.path + ' - ' + standard.source);
        keyValues([['Content hash', standard.contentHash]]);
        muted('Structured-rule state: ' + standard.structuredRulesStatus + '.');
        standard.rules?.filter(rule => rule.enabled).forEach(rule => bullet(rule.stableKey + ': ' + rule.statement));
      });

      heading('Model usage summary');
      appendUsage(snapshot.modelUsage);
      muted('Usage contains provider/model and token counts only. Credentials, prompts, model responses, and hidden reasoning are excluded.');

      // Running header and footer on every page.
      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        const pageNumber = range.start + index;
        doc.switchToPage(pageNumber);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const right = doc.page.width - MARGIN;
        doc.font(fonts.semibold).fontSize(7.5).fillColor(C.primary).text('CENTINEL', MARGIN, 26, { lineBreak: false, characterSpacing: 1 });
        doc.font(fonts.regular).fontSize(7.5).fillColor(C.subtle)
          .text(clean(pageNumber >= partTwoStart ? 'Part 2 · Technical details' : 'Part 1 · Summary'), MARGIN + 54, 26, { lineBreak: false });
        doc.text(clean(clip(snapshot.project.name, 60)), right - 260, 26, { lineBreak: false, width: 260, align: 'right' });
        doc.lineWidth(0.6).strokeColor(C.line).moveTo(MARGIN, 42).lineTo(right, 42).stroke();
        const footerY = doc.page.height - 40;
        doc.lineWidth(0.6).strokeColor(C.line).moveTo(MARGIN, footerY - 8).lineTo(right, footerY - 8).stroke();
        doc.font(fonts.regular).fontSize(7.5).fillColor(C.subtle)
          .text('Report ' + snapshot.metadata.reportId, MARGIN, footerY, { lineBreak: false });
        doc.text('Page ' + String(index + 1) + ' of ' + String(range.count), right - 92, footerY, { lineBreak: false, width: 92, align: 'right' });
        doc.page.margins.bottom = savedBottom;
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function plural(count: number, one: string): string {
  return count + ' ' + (count === 1 ? one : one + 's');
}
