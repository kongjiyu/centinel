import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chunkFrozenSource, SOURCE_CHUNK_POLICY } from '../../sidecar/src/review/sourceChunks.js';

process.chdir(path.resolve(import.meta.dirname, '../..'));
const manifest = JSON.parse(fs.readFileSync('docs/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/manifest.json', 'utf8'));
const run = fs.readFileSync('evidence/public-repo-outcomes-2026-10-22/active-mitigation-run.txt', 'utf8').trim();
const events = fs.readdirSync(run).filter(name => /^\d{4}-.+\.json$/.test(name)).sort()
  .map(name => JSON.parse(fs.readFileSync(path.join(run, name), 'utf8')));
const results: unknown[] = [];
for (const item of manifest.cases) {
  const artifacts = events.filter(event => event.instanceId === item.instanceId && event.kind === 'imported-artifacts').at(-1)?.data;
  if (!Array.isArray(artifacts)) throw new Error(`Missing frozen artifacts: ${item.alias}`);
  let characters = 0, legacyCharacters = 0, legacyChunks = 0, semanticChunks = 0, fragments = 0;
  const kinds: Record<string, number> = {};
  for (const artifact of artifacts) {
    const bytes = fs.readFileSync(path.join(item.inputDirectory, artifact.filePath));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== artifact.contentHash) throw new Error('Frozen hash mismatch');
    const content = bytes.toString('utf8');
    const chunks = chunkFrozenSource(artifact, content);
    if (!Buffer.concat(chunks.map(chunk => Buffer.from(chunk.content, 'utf8'))).equals(bytes)) throw new Error('Chunk bytes mismatch');
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk.startOffset !== offset || chunk.content !== content.slice(chunk.startOffset, chunk.endOffset) || chunk.content.length > 2_400) throw new Error('Chunk position/bound mismatch');
      offset = chunk.endOffset;
      kinds[chunk.kind] = (kinds[chunk.kind] ?? 0) + 1;
      if (chunk.isFragment) fragments++;
    }
    if (offset !== content.length) throw new Error('Chunk reconstruction gap');
    semanticChunks += chunks.length;
    characters += content.length;
    // Historical fixed-window policy: 2,400 characters, 240 overlap.
    for (let start = 0; start < content.length; start += 2_160) {
      const end = Math.min(content.length, start + 2_400);
      legacyCharacters += end - start;
      legacyChunks++;
      if (end === content.length) break;
    }
  }
  results.push({ alias: item.alias, files: artifacts.length, sourceCharacters: characters,
    legacyWindowCharacters: legacyCharacters, legacyWindowChunks: legacyChunks,
    semanticChunkCharacters: characters, semanticChunks, fragments, kinds, exactByteReconstruction: true });
}
const output = { capturedAt: new Date().toISOString(), policy: SOURCE_CHUNK_POLICY,
  execution: 'Trusted static parser only; no model, vector provider, repository execution or database calls.',
  caveat: 'Chunk counts approximate cold-index request counts only when one request is made per chunk; they are not provider token counts. Legacy duplicate-body suppression is excluded.', results };
fs.writeFileSync(path.join(import.meta.dirname, 'chunk-benchmark.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
