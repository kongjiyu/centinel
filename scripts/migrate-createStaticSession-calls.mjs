// One-off: rewrite the old createStaticSession signature to the new
// object-input form. Used by both staticSessions.test.ts (and any
// other file still calling the old signature). Run with:
//   node scripts/migrate-createStaticSession-calls.mjs <files...>

import fs from 'fs';
import path from 'path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: migrate-createStaticSession-calls.mjs <files...>');
  process.exit(1);
}

const re = /createStaticSession\(\s*'([^']+)'\s*,\s*('[^']+'|`[^`]+`)\s*,\s*('[^']+'|`[^`]+`|[a-zA-Z_$][\w$]*)\s*,\s*(\{[^}]*\})\s*\)/g;

let totalReplacements = 0;
for (const file of files) {
  const full = path.resolve(file);
  const original = fs.readFileSync(full, 'utf8');
  const replaced = original.replace(re, (_match, projectId, name, reviewType, configJson) => {
    return `createStaticSession({ projectId: '${projectId}', name: ${name}, reviewType: ${reviewType}, configJson: ${configJson} })`;
  });
  if (replaced === original) {
    console.log(`no changes: ${file}`);
    continue;
  }
  const count = (original.match(re) ?? []).length;
  fs.writeFileSync(full, replaced, 'utf8');
  console.log(`updated: ${file} (${count} replacements)`);
  totalReplacements += count;
}

console.log(`\ntotal: ${totalReplacements} replacements across ${files.length} files`);
