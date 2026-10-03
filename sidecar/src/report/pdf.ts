import PDFDocument from 'pdfkit';
import type { ProjectReportFinding, ProjectReportSnapshot, ReportUsage } from './types.js';

const PAGE_MARGIN = 48;
const BODY_BOTTOM = 102;
const LINE_HEIGHT = 13;
const COLORS = {
  ink: '#17211a',
  muted: '#566159',
  line: '#d9ddda',
  green: '#28623c',
  soft: '#f2f5f2',
  warning: '#8a5a11',
};

function pdfText(value: unknown): string {
  const input = String(value ?? '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/\u2026/g, '...');
  const normalized = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return Array.from(normalized, char => char.charCodeAt(0) <= 126 ? char : '?').join('');
}

function date(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? pdfText(value) : parsed.toISOString();
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: 'New', carryover: 'Carryover', accepted: 'Accepted', dismissed: 'Dismissed', fixed: 'Fixed',
    success: 'Completed', failure: 'Failed', failed: 'Failed', blocked: 'Needs attention',
    cancelled: 'Cancelled', pending_approval: 'Need approval', completed: 'Completed',
    approved: 'Completed', changes_requested: 'Changes requested', queued: 'Queued', running: 'In progress',
  };
  return labels[status] ?? pdfText(status);
}

function wrapText(doc: PDFKit.PDFDocument, text: string, width: number, fontSize: number, bold = false): string[] {
  const font = bold ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(font).fontSize(fontSize);
  const output: string[] = [];
  const paragraphs = pdfText(text).split(/\r?\n/);
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      output.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (doc.widthOfString(next) <= width) {
        line = next;
        continue;
      }
      if (line) output.push(line);
      line = '';
      if (doc.widthOfString(word) <= width) {
        line = word;
        continue;
      }
      let piece = '';
      for (const character of word) {
        if (piece && doc.widthOfString(piece + character) > width) {
          output.push(piece);
          piece = '';
        }
        piece += character;
      }
      line = piece;
    }
    if (line) output.push(line);
  }
  return output.length ? output : [''];
}

export function renderProjectReportPdf(snapshot: ProjectReportSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: PAGE_MARGIN + 16, right: PAGE_MARGIN, bottom: PAGE_MARGIN + 12, left: PAGE_MARGIN },
      bufferPages: true,
      info: {
        Title: 'Centinel project report - ' + pdfText(snapshot.project.name),
        Author: snapshot.metadata.actorId ? 'Centinel user ' + snapshot.metadata.actorId : 'Centinel',
        Subject: 'Immutable project quality report',
        Creator: 'Centinel ' + snapshot.metadata.generatorVersion,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const drawHeader = () => {
      const width = doc.page.width - PAGE_MARGIN * 2;
      doc.save();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.green);
      doc.text('CENTINEL  /  PROJECT REPORT', PAGE_MARGIN, 21, { lineBreak: false });
      doc.strokeColor(COLORS.line).lineWidth(0.7)
        .moveTo(PAGE_MARGIN, 38).lineTo(PAGE_MARGIN + width, 38).stroke();
      doc.restore();
      doc.y = PAGE_MARGIN + 17;
    };

    doc.on('pageAdded', () => {
      drawHeader();
    });
    drawHeader();

    const usableWidth = () => doc.page.width - PAGE_MARGIN * 2;
    const ensureSpace = (height: number) => {
      if (doc.y + height > doc.page.height - BODY_BOTTOM) doc.addPage();
    };
    const line = (text: unknown, options: { size?: number; bold?: boolean; color?: string; indent?: number; after?: number } = {}) => {
      const size = options.size ?? 9.5;
      const bold = options.bold ?? false;
      const indent = options.indent ?? 0;
      const width = usableWidth() - indent;
      const font = bold ? 'Helvetica-Bold' : 'Helvetica';
      const rows = wrapText(doc, String(text ?? ''), width, size, bold);
      rows.forEach(row => {
        ensureSpace(LINE_HEIGHT + 2);
        doc.font(font).fontSize(size).fillColor(options.color ?? COLORS.ink);
        doc.text(row, PAGE_MARGIN + indent, doc.y, { lineBreak: false, width });
        doc.y += Math.max(LINE_HEIGHT, size + 3);
      });
      doc.y += options.after ?? 1;
    };
    const divider = () => {
      ensureSpace(12);
      doc.strokeColor(COLORS.line).lineWidth(0.6)
        .moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y).stroke();
      doc.y += 11;
    };
    const heading = (text: string) => {
      ensureSpace(31);
      doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.green);
      doc.text(pdfText(text), PAGE_MARGIN, doc.y, { lineBreak: false });
      doc.y += 22;
      divider();
    };
    const subheading = (text: string) => {
      line(text, { size: 11, bold: true, after: 3 });
    };
    const label = (name: string, value: unknown) => line(name + ': ' + String(value ?? 'Unavailable'), { size: 9, after: 0 });
    const bullet = (text: string) => line('- ' + text, { size: 9, indent: 10, after: 0 });
    const keyValueBlock = (items: Array<[string, unknown]>) => {
      items.forEach(([name, value]) => label(name, value));
      doc.y += 4;
    };
    const drawFinding = (finding: ProjectReportFinding, index: number) => {
      subheading(String(index + 1) + '. ' + finding.title);
      keyValueBlock([
        ['Risk', finding.riskLevel ?? 'Not classified'],
        ['Severity / priority', finding.severity + ' / ' + (finding.priority ?? 'Not supplied')],
        ['State', statusLabel(finding.status)],
        ['Module / category', finding.source + ' / ' + finding.category],
        ['Finding ID', finding.id],
        ['Location', finding.filePath ? finding.filePath + (finding.lineNumber ? ':' + finding.lineNumber : '') : 'Unavailable'],
        ['Created', date(finding.createdAt)],
      ]);
      if (finding.description) line(finding.description, { size: 9, color: COLORS.muted, after: 5 });
      if (finding.evidenceText) {
        line('Evidence:', { size: 8.5, bold: true, after: 1 });
        line(finding.evidenceText, { size: 8.5, color: COLORS.muted, indent: 10, after: 4 });
      }
      if (finding.recommendation) line('Recommendation: ' + finding.recommendation, { size: 9, after: 6 });
      divider();
    };
    const appendUsage = (usage: ReportUsage) => {
      if (usage.status !== 'available' || !usage.totals) {
        line('Usage unavailable: ' + (usage.reason ?? 'No model-usage records were persisted.'), { size: 9, color: COLORS.warning });
        return;
      }
      label('Calls', usage.totals.calls);
      label('Input / output tokens', usage.totals.input + ' / ' + usage.totals.output);
      label('Cache reads / creation', usage.totals.cacheRead + ' / ' + usage.totals.cacheCreation);
      usage.byModel.forEach(group => bullet(
        group.provider + ' / ' + group.model + ': ' + group.calls + ' calls, '
        + group.input + ' input, ' + group.output + ' output tokens',
      ));
      doc.y += 4;
    };

    try {
      doc.font('Helvetica-Bold').fontSize(25).fillColor(COLORS.ink);
      doc.text('Project report', PAGE_MARGIN, doc.y, { lineBreak: false });
      doc.y += 31;
      line(snapshot.project.name, { size: 13, bold: true, color: COLORS.green, after: 8 });
      keyValueBlock([
        ['Project ID', snapshot.project.id],
        ['Export ID', snapshot.metadata.reportId],
        ['Generated', date(snapshot.metadata.generatedAt)],
        ['Generated by', snapshot.metadata.actorId ?? 'Unavailable'],
        ['Generator version', snapshot.metadata.generatorVersion],
        ['Risk policy version', snapshot.metadata.riskPolicyVersion],
      ]);
      if (snapshot.project.description) line(snapshot.project.description, { size: 9, color: COLORS.muted, after: 10 });
      divider();

      heading('Risk assessment');
      label('Current static risk items', snapshot.riskAssessment.currentFindingCount);
      label('Critical / high', snapshot.riskAssessment.critical + ' / ' + snapshot.riskAssessment.high);
      label('Medium / low', snapshot.riskAssessment.medium + ' / ' + snapshot.riskAssessment.low);
      label('Unclassified', snapshot.riskAssessment.unclassified);
      line('Dynamic findings are included in the inventory but remain outside this static risk policy.', { size: 8.5, color: COLORS.muted, after: 7 });
      if (snapshot.riskAssessment.items.length) {
        subheading('Current risk items');
        snapshot.riskAssessment.items.forEach((finding, index) =>
          bullet((finding.riskLevel ?? 'Unclassified') + ' - ' + finding.title + ' (' + statusLabel(finding.status) + ')'));
      } else line('No current risk items are available.', { size: 9, color: COLORS.muted });

      heading('Finding inventory');
      line('Every persisted finding is listed with its current state. Carryover findings are separate in the latest Review section.', { size: 9, color: COLORS.muted });
      if (!snapshot.findings.length) line('No findings have been recorded.', { size: 9, color: COLORS.muted });
      else snapshot.findings.forEach(drawFinding);

      heading('Latest Static Review');
      if (!snapshot.latestReview) {
        line('Unavailable: no terminal Review record is available for this project.', { size: 9, color: COLORS.muted });
      } else {
        const review = snapshot.latestReview;
        const lifecycle = review.decision?.decision === 'approved'
          ? 'Completed'
          : review.decision?.decision === 'changes_requested'
            ? 'Changes requested'
            : review.session.status === 'success' ? 'Need approval' : statusLabel(review.session.status);
        keyValueBlock([
          ['Review', review.session.name],
          ['Review ID', review.session.id],
          ['Lifecycle state', lifecycle],
          ['Execution status', statusLabel(review.session.status)],
          ['Decision', review.decision ? statusLabel(review.decision.decision) : 'No decision recorded'],
          ['Created / updated', date(review.session.createdAt) + ' / ' + date(review.session.updatedAt)],
        ]);
        line('Summary: ' + (review.summary ?? 'No summary was recorded.'), { size: 9, color: COLORS.muted });
        if (review.session.failureReason) line('Failure reason: ' + review.session.failureReason, { size: 9, color: COLORS.warning });
        if (review.decision?.comment) line('Decision feedback: ' + review.decision.comment, { size: 9 });
        if (review.decision?.attachments.length) {
          subheading('Decision attachments');
          review.decision.attachments.forEach(item => bullet(item.fileName + ' - ' + item.mimeType + ' - ' + date(item.createdAt)));
        }

        subheading('Reported findings');
        if (!review.reportedFindings.length) line('No newly reported findings are persisted for this Review.', { size: 9, color: COLORS.muted });
        else review.reportedFindings.forEach(drawFinding);
        subheading('Carryover findings');
        if (!review.carryoverFindings.length) line('No carryover findings are persisted for this Review.', { size: 9, color: COLORS.muted });
        else review.carryoverFindings.forEach(drawFinding);
        if (review.findingClassificationStatus === 'unavailable') {
          line('Recurring and other cross-Review classifications are unavailable for this record and are not inferred.', { size: 8.5, color: COLORS.warning });
        } else {
          line('Cross-Review classification: available', { size: 8.5, color: COLORS.green });
          if (review.recurringFindings?.length) line('Recurring findings: ' + review.recurringFindings.length, { size: 8.5, color: COLORS.muted });
          review.correlations?.forEach(item => bullet(item.classification + ' / ' + item.method + ' / score ' + item.score + ' - ' + (item.childFindingId ?? item.parentFindingId ?? 'Unavailable')));
        }

        subheading('Source manifest');
        keyValueBlock([
          ['Status', statusLabel(review.sourceManifest.status)],
          ['Captured', date(review.sourceManifest.capturedAt)],
          ['Artifacts reviewed', review.sourceManifest.artifactCount ?? 'Unavailable'],
        ]);
        if (!review.sourceManifest.sources.length) line('No source-manifest items are available.', { size: 9, color: COLORS.muted });
        else review.sourceManifest.sources.forEach(source =>
          bullet(source.label + ' - ' + source.filesReviewed + ' file(s); hashes: ' + (source.contentHashes.join(', ') || 'Unavailable')));

        subheading('Traceability');
        label('Snapshot status', statusLabel(review.traceability.status));
        if (review.traceability.summary) {
          label('Complete / incomplete / missing', review.traceability.summary.complete + ' / ' + review.traceability.summary.incomplete + ' / ' + review.traceability.summary.missing);
          label('Attention', review.traceability.summary.attention);
        } else line('Unavailable: this Review has no persisted traceability snapshot.', { size: 9, color: COLORS.muted });
        review.traceability.records.forEach(record =>
          bullet(record.title + ' - ' + record.state + '; mappings: ' + record.mappingIds.length + '; source artifacts: ' + (record.sourceArtifactIds.join(', ') || 'None')));

        subheading('Review model usage');
        appendUsage(review.modelUsage);
      }

      heading('Project sources');
      label('Source artifacts recorded', snapshot.sourceInventory.artifactCount);
      snapshot.sourceInventory.artifacts.forEach(artifact =>
        bullet(artifact.fileName + ' - ' + artifact.type + ' / ' + artifact.source + ' - ' + artifact.path + ' - SHA-256 ' + artifact.contentHash));
      if (!snapshot.sourceInventory.artifacts.length) line('No source artifacts are recorded.', { size: 9, color: COLORS.muted });

      heading('Requirements');
      if (!snapshot.requirements.items.length) line('No structured requirements are recorded.', { size: 9, color: COLORS.muted });
      snapshot.requirements.items.forEach(requirement => {
        subheading(requirement.title);
        keyValueBlock([
          ['Requirement ID', requirement.id],
          ['Category / priority', (requirement.category || 'Not supplied') + ' / ' + (requirement.priority || 'Not supplied')],
        ]);
        if (requirement.description) line(requirement.description, { size: 9, color: COLORS.muted });
        if (requirement.mappings.length) requirement.mappings.forEach(mapping =>
          bullet(mapping.coverageStatus + ' - confidence ' + mapping.confidence + ' - artifact ' + (mapping.fileId ?? 'Unavailable')));
        else line('No source mappings are recorded.', { size: 8.5, color: COLORS.muted });
      });

      heading('Coding standards');
      if (!snapshot.standards.items.length) line('No coding-standard artifacts are recorded.', { size: 9, color: COLORS.muted });
      snapshot.standards.items.forEach(standard => {
        bullet(standard.title + ' - ' + standard.path + ' - ' + standard.source);
        label('Content hash', standard.contentHash);
        line('Structured-rule state: ' + standard.structuredRulesStatus + '.', { size: 8.5, color: COLORS.muted, after: 2 });
        standard.rules?.filter(rule => rule.enabled).forEach(rule => bullet(rule.stableKey + ': ' + rule.statement));
        doc.y += 2;
      });

      heading('Model usage summary');
      appendUsage(snapshot.modelUsage);
      line('Usage contains provider/model and token counts only. Credentials, prompts, model responses, and hidden reasoning are excluded.', { size: 8.5, color: COLORS.muted });

      heading('Latest existing Dynamic Test');
      if (!snapshot.latestDynamicTest) {
        line('Unavailable: no terminal Dynamic Test summary is available for this project.', { size: 9, color: COLORS.muted });
      } else {
        const dynamic = snapshot.latestDynamicTest;
        keyValueBlock([
          ['Test', dynamic.session.name],
          ['Test ID', dynamic.session.id],
          ['Status', statusLabel(dynamic.session.status)],
          ['Target', dynamic.session.targetUrl],
          ['Goal', dynamic.session.goal],
          ['Created / updated', date(dynamic.session.createdAt) + ' / ' + date(dynamic.session.updatedAt)],
        ]);
        line('Summary: ' + (dynamic.summary ?? 'No summary was recorded.'), { size: 9, color: COLORS.muted });
        if (dynamic.failureReason) line('Failure reason: ' + dynamic.failureReason, { size: 9, color: COLORS.warning });
        subheading('Evidence references');
        if (!dynamic.evidence.length) line('No evidence references are recorded.', { size: 9, color: COLORS.muted });
        dynamic.evidence.forEach(item => bullet(item.type + ' - ' + item.summary + ' - ' + (item.path ?? 'Location unavailable') + ' - ' + date(item.createdAt)));
        subheading('Action trace');
        if (!dynamic.actionTrace.length) line('No action trace is available.', { size: 9, color: COLORS.muted });
        dynamic.actionTrace.forEach(item => bullet(String(item.step) + '. ' + item.action + ' - ' + item.target + ' - ' + item.result));
        line('Raw console output and model request/response payloads are not included.', { size: 8.5, color: COLORS.muted });
      }

      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        doc.switchToPage(range.start + index);
        const footerY = doc.page.height - 74;
        doc.strokeColor(COLORS.line).lineWidth(0.6)
          .moveTo(PAGE_MARGIN, footerY - 8).lineTo(doc.page.width - PAGE_MARGIN, footerY - 8).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted);
        doc.text('Export ' + snapshot.metadata.reportId, PAGE_MARGIN, footerY, { lineBreak: false });
        doc.text('Page ' + String(index + 1) + ' of ' + String(range.count), doc.page.width - PAGE_MARGIN - 92, footerY, { lineBreak: false, width: 92, align: 'right' });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
