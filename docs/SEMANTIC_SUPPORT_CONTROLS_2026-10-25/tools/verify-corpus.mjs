import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORPUS_ROOT = path.resolve(toolDirectory, "..");
const EXPECTED_MANIFEST_PATH = "expected/expected-dispositions.json";
const PINNED_EXPECTED_MANIFEST_SHA256 = "560f25368db33e29e826efb1a0e5653cc6e16fe6e837302daeb6d4d46ec401eb";
const TASKS_PATH = "tasks/candidate-claims.json";
const REQUIRED_CASE_COUNT = 12;
const ALLOWED_DISPOSITIONS = new Set(["supported", "contradicted", "insufficient"]);
const ALLOWED_BOUNDARIES = new Set([
  "local_source",
  "selected_call_path",
  "runtime_dependent",
  "cross_implementation",
]);

function fail(message) {
  throw new Error(message);
}

function requireValue(condition, message) {
  if (!condition) fail(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function walkInputFiles(directory, relativeToRoot = "") {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeToRoot, entry.name);
    const info = lstatSync(absolutePath);
    requireValue(!info.isSymbolicLink(), `Inputs must not contain symlinks: ${relativePath}`);
    if (info.isDirectory()) {
      results.push(...walkInputFiles(absolutePath, relativePath));
      continue;
    }
    requireValue(info.isFile(), `Inputs must contain regular files only: ${relativePath}`);
    requireValue(relativePath.endsWith(".ts") || relativePath.endsWith(".js"), `Inputs must be source-only .ts/.js files: ${relativePath}`);
    results.push(relativePath);
  }
  return results.sort();
}

function validateRelativeInputPath(root, relativePath) {
  requireValue(typeof relativePath === "string", "Source and reference paths must be strings.");
  requireValue(relativePath.startsWith("inputs/"), `Path is outside inputs/: ${relativePath}`);
  requireValue(!relativePath.includes("\\"), `Use forward slashes in manifest paths: ${relativePath}`);
  requireValue(path.posix.normalize(relativePath) === relativePath, `Path is not normalized: ${relativePath}`);
  requireValue(!relativePath.split("/").includes(".."), `Path traversal is not allowed: ${relativePath}`);
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  const relativeToRoot = path.relative(root, absolutePath);
  requireValue(relativeToRoot && !relativeToRoot.startsWith(`..${path.sep}`) && relativeToRoot !== "..", `Path escapes corpus root: ${relativePath}`);
  return absolutePath;
}

function validateString(value, label) {
  requireValue(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string.`);
}

export function verifyCorpus(corpusRoot = DEFAULT_CORPUS_ROOT, { enforcePinnedManifest = true } = {}) {
  const root = path.resolve(corpusRoot);
  const manifestPath = path.join(root, EXPECTED_MANIFEST_PATH);
  const manifestBytes = readFileSync(manifestPath);
  const manifestDigest = sha256(manifestBytes);
  if (enforcePinnedManifest) {
    requireValue(
      manifestDigest === PINNED_EXPECTED_MANIFEST_SHA256,
      `Expected-disposition manifest SHA-256 mismatch: ${manifestDigest}`,
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    fail(`Expected-disposition manifest is not valid JSON: ${error.message}`);
  }

  requireValue(manifest.schemaVersion === 1, "Unsupported manifest schemaVersion.");
  requireValue(manifest.corpusId === "semantic-support-controls-2026-10-25", "Unexpected corpusId.");
  requireValue(Array.isArray(manifest.cases), "Manifest cases must be an array.");
  requireValue(manifest.cases.length === REQUIRED_CASE_COUNT, `Expected ${REQUIRED_CASE_COUNT} cases; found ${manifest.cases.length}.`);

  requireValue(manifest.tasks?.path === TASKS_PATH, `Task prompt path must be ${TASKS_PATH}.`);
  const taskBytes = readFileSync(path.join(root, TASKS_PATH));
  const taskDigest = sha256(taskBytes);
  requireValue(taskDigest === manifest.tasks.sha256, `Candidate task SHA-256 mismatch: ${taskDigest}`);
  let taskManifest;
  try {
    taskManifest = JSON.parse(taskBytes.toString("utf8"));
  } catch (error) {
    fail(`Candidate task file is not valid JSON: ${error.message}`);
  }
  requireValue(taskManifest.schemaVersion === 1 && Array.isArray(taskManifest.tasks), "Invalid candidate task manifest.");
  const taskById = new Map();
  for (const task of taskManifest.tasks) {
    requireValue(/^[a-z0-9_-]+$/.test(task.id), `Invalid task id: ${task.id}`);
    requireValue(!taskById.has(task.id), `Duplicate task id: ${task.id}`);
    validateString(task.caseId, `${task.id}.caseId`);
    validateString(task.candidate, `${task.id}.candidate`);
    taskById.set(task.id, task);
  }

  const caseIds = new Set();
  const expectedSourceFiles = [];
  const caseById = new Map();
  let judgmentCount = 0;
  let referenceCount = 0;

  for (const entry of manifest.cases) {
    requireValue(/^case-\d{2}$/.test(entry.id), `Invalid case id: ${entry.id}`);
    requireValue(!caseIds.has(entry.id), `Duplicate case id: ${entry.id}`);
    caseIds.add(entry.id);
    caseById.set(entry.id, entry);
    validateString(entry.family, `${entry.id}.family`);
    requireValue(Array.isArray(entry.sources) && entry.sources.length > 0, `${entry.id} must list at least one source file.`);
    requireValue(Array.isArray(entry.judgments) && entry.judgments.length > 0, `${entry.id} must list at least one judgment.`);

    const sourcePaths = new Set();
    for (const source of entry.sources) {
      const absolutePath = validateRelativeInputPath(root, source.path);
      requireValue(source.path.startsWith(`inputs/${entry.id}/`), `${source.path} is not inside its declared case folder.`);
      requireValue(!sourcePaths.has(source.path), `Duplicate source path in ${entry.id}: ${source.path}`);
      sourcePaths.add(source.path);
      expectedSourceFiles.push(source.path);
      requireValue(/^[a-f0-9]{64}$/.test(source.sha256), `Invalid SHA-256 for ${source.path}`);
      const fileBytes = readFileSync(absolutePath);
      const actualDigest = sha256(fileBytes);
      requireValue(actualDigest === source.sha256, `Source SHA-256 mismatch for ${source.path}: ${actualDigest}`);
    }

    const judgmentIds = new Set();
    for (const judgment of entry.judgments) {
      judgmentCount += 1;
      requireValue(/^[a-z0-9_]+$/.test(judgment.id), `Invalid judgment id in ${entry.id}: ${judgment.id}`);
      requireValue(!judgmentIds.has(judgment.id), `Duplicate judgment id in ${entry.id}: ${judgment.id}`);
      judgmentIds.add(judgment.id);
      validateString(judgment.taskId, `${entry.id}.${judgment.id}.taskId`);
      const task = taskById.get(judgment.taskId);
      requireValue(task, `Missing candidate task ${judgment.taskId}.`);
      requireValue(task.caseId === entry.id, `${judgment.taskId} is assigned to ${task.caseId}, not ${entry.id}.`);
      validateString(judgment.expectedSummary, `${entry.id}.${judgment.id}.expectedSummary`);
      requireValue(ALLOWED_BOUNDARIES.has(judgment.boundary), `Invalid boundary in ${entry.id}.${judgment.id}: ${judgment.boundary}`);
      requireValue(ALLOWED_DISPOSITIONS.has(judgment.expectedDisposition), `Invalid disposition in ${entry.id}.${judgment.id}: ${judgment.expectedDisposition}`);
      requireValue(Array.isArray(judgment.references) && judgment.references.length > 0, `${entry.id}.${judgment.id} must cite at least one exact source line.`);
      for (const reference of judgment.references) {
        referenceCount += 1;
        requireValue(sourcePaths.has(reference.path), `${entry.id}.${judgment.id} references a file outside its case sources: ${reference.path}`);
        validateRelativeInputPath(root, reference.path);
        requireValue(Number.isSafeInteger(reference.line) && reference.line > 0, `Invalid line number in ${entry.id}.${judgment.id}.`);
        validateString(reference.text, `${entry.id}.${judgment.id}.reference text`);
        const sourceText = readFileSync(path.join(root, ...reference.path.split("/")), "utf8");
        const lines = sourceText.split(/\r?\n/);
        requireValue(reference.line <= lines.length, `Reference line is outside ${reference.path}: ${reference.line}`);
        requireValue(lines[reference.line - 1] === reference.text, `Reference text mismatch at ${reference.path}:${reference.line}`);
      }
    }
  }

  requireValue(taskById.size === judgmentCount, `Expected one candidate task per judgment; found ${taskById.size} tasks and ${judgmentCount} judgments.`);
  const referencedTaskIds = new Set(manifest.cases.flatMap((entry) => entry.judgments.map((judgment) => judgment.taskId)));
  requireValue(referencedTaskIds.size === taskById.size, "Every candidate task must be referenced by exactly one expected judgment.");

  expectedSourceFiles.sort();
  requireValue(new Set(expectedSourceFiles).size === expectedSourceFiles.length, "A source file is listed by more than one case.");
  const inputDirectory = path.join(root, "inputs");
  const actualInputFiles = walkInputFiles(inputDirectory, "inputs");
  requireValue(
    JSON.stringify(actualInputFiles) === JSON.stringify(expectedSourceFiles),
    `Input/source manifest mismatch. Listed=${expectedSourceFiles.length}; present=${actualInputFiles.length}.`,
  );

  requireValue(Array.isArray(manifest.contrastSets) && manifest.contrastSets.length > 0, "Manifest contrastSets must be a non-empty array.");
  const contrastIds = new Set();
  for (const contrast of manifest.contrastSets) {
    validateString(contrast.id, "contrast id");
    requireValue(!contrastIds.has(contrast.id), `Duplicate contrast id: ${contrast.id}`);
    contrastIds.add(contrast.id);
    requireValue(Array.isArray(contrast.caseIds) && contrast.caseIds.length > 0, `${contrast.id} must name cases.`);
    requireValue(Array.isArray(contrast.judgmentIds) && contrast.judgmentIds.length > 0, `${contrast.id} must name judgments.`);
    const mappedCaseIds = Object.keys(contrast.expectedDispositionsByCase ?? {}).sort();
    requireValue(JSON.stringify(mappedCaseIds) === JSON.stringify([...contrast.caseIds].sort()), `${contrast.id} expected dispositions must cover exactly its cases.`);
    for (const caseId of contrast.caseIds) {
      const entry = caseById.get(caseId);
      requireValue(entry, `${contrast.id} references unknown case ${caseId}.`);
      requireValue(entry.contrastSet === contrast.id, `${caseId} does not point back to contrast ${contrast.id}.`);
      const memberJudgments = contrast.judgmentIds
        .map((id) => entry.judgments.find((judgment) => judgment.id === id))
        .filter(Boolean);
      requireValue(memberJudgments.length > 0, `${contrast.id} has no listed judgments in ${caseId}.`);
      const expected = contrast.expectedDispositionsByCase[caseId];
      const expectedList = Array.isArray(expected) ? expected : [expected];
      requireValue(expectedList.length === memberJudgments.length, `${contrast.id} disposition count does not match its judgments in ${caseId}.`);
      for (let index = 0; index < memberJudgments.length; index += 1) {
        requireValue(
          expectedList[index] === memberJudgments[index].expectedDisposition,
          `${contrast.id} disposition disagrees with ${caseId}.${memberJudgments[index].id}.`,
        );
      }
    }
  }

  return {
    caseCount: manifest.cases.length,
    judgmentCount,
    sourceFileCount: expectedSourceFiles.length,
    taskCount: taskById.size,
    exactReferenceCount: referenceCount,
    contrastSetCount: manifest.contrastSets.length,
    manifestSha256: manifestDigest,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCorpus();
  console.log(
    `Corpus integrity passed: ${result.caseCount} cases, ${result.judgmentCount} judgments, ${result.taskCount} candidate tasks, ${result.sourceFileCount} source files, ${result.exactReferenceCount} exact line references, ${result.contrastSetCount} contrast sets.`,
  );
}
