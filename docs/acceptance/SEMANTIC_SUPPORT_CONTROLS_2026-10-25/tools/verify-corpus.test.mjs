import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CORPUS_ROOT, verifyCorpus } from "./verify-corpus.mjs";

function withCorpusCopy(callback) {
  const tempParent = mkdtempSync(path.join(os.tmpdir(), "semantic-support-controls-"));
  const copy = path.join(tempParent, "corpus");
  cpSync(DEFAULT_CORPUS_ROOT, copy, { recursive: true });
  try {
    callback(copy);
  } finally {
    rmSync(tempParent, { recursive: true, force: true });
  }
}

test("the hand-authored corpus has intact hashes, references, and separation", () => {
  const result = verifyCorpus();
  assert.equal(result.caseCount, 12);
  assert.equal(result.judgmentCount, 21);
  assert.equal(result.taskCount, 21);
  assert.equal(result.sourceFileCount, 20);
  assert.ok(result.exactReferenceCount > 0);
  assert.equal(result.contrastSetCount, 6);
});

test("a changed source is rejected by its recorded SHA-256", () => {
  withCorpusCopy((copy) => {
    const sourcePath = path.join(copy, "inputs", "case-01", "source.ts");
    writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf8")}\n// local mutation\n`);
    assert.throws(() => verifyCorpus(copy, { enforcePinnedManifest: false }), /Source SHA-256 mismatch/);
  });
});

test("a forged exact-line quotation is rejected", () => {
  withCorpusCopy((copy) => {
    const manifestPath = path.join(copy, "expected", "expected-dispositions.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.cases[0].judgments[0].references[0].text = "  const maxItems = 999;";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyCorpus(copy, { enforcePinnedManifest: false }), /Reference text mismatch/);
  });
});

test("gold or unregistered files cannot be placed under source-only inputs", () => {
  withCorpusCopy((copy) => {
    writeFileSync(path.join(copy, "inputs", "case-01", "expected.json"), "{}\n");
    assert.throws(() => verifyCorpus(copy, { enforcePinnedManifest: false }), /source-only/);
  });
});
