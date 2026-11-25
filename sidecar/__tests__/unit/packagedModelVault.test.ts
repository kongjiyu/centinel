import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('accepts the packaged key through stdin and isolates local credentials by owner', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { initializePackagedModelKey, encryptLocalModelSecret, decryptModelSecret, encryptSecret, decryptSecret } from './src/tokenVault.ts';
    import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { DatabaseSync } from 'node:sqlite';
    import { LocalWorkspace } from './src/store/localWorkspace.ts';
    import { EnvironmentVault } from './src/dynamic/environment/vault.ts';
    import { WorkspaceRegistry, inspectWorkspace } from './src/dynamic/workspace/registry.ts';
    import { EnvironmentSessionVault } from './src/dynamic/environment/sessionVault.ts';
    import { UploadVault } from './src/dynamic/environment/uploadVault.ts';
    import { DownloadVault } from './src/dynamic/environment/downloadVault.ts';
    import { saveModelProviderSetting } from './src/modelSettings.ts';
    import { resolveModelProviderChain } from './src/review/modelProviderResolver.ts';
    const original = encryptSecret('legacy-fixture');
    assert.throws(() => encryptLocalModelSecret('first', 'example'), /OS-protected/);
    initializePackagedModelKey();
    assert.equal(process.env.CENTINEL_MODEL_KEY_PIPE, undefined);
    const protectedValue = encryptLocalModelSecret('first', 'example');
    assert.match(protectedValue, /^device-v1\\./);
    assert.equal(decryptModelSecret('first', protectedValue), 'example');
    assert.throws(() => decryptModelSecret('second', protectedValue));
    assert.equal(decryptModelSecret('first', original), 'legacy-fixture');
    assert.equal(decryptSecret(original), 'legacy-fixture');
    delete process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;
    const directory = mkdtempSync(join(tmpdir(), 'centinel-packaged-model-'));
    const content = Buffer.from('public synthetic file');
    const cacheOwner = '11111111-1111-4111-8111-111111111111';
    const cacheProject = '22222222-2222-4222-8222-222222222222';
    const cacheReview = '33333333-3333-4333-8333-333333333333';
    const cacheRecord = { version: 1, ownerId: cacheOwner, projectId: cacheProject, originReviewId: cacheReview,
      requestHash: 'a'.repeat(64), providerFingerprint: 'b'.repeat(64), policyVersion: 'fixture-policy', validationVersion: 'fixture-validation',
      generation: { findings: [], featureAssessments: [] }, supportRecords: [] };
    let uploadId, downloadId;
    try {
      const initial = new LocalWorkspace(directory);
      try {
        const vault = new EnvironmentVault(initial.environmentValuesRoot, { deviceEncrypted: true });
        assert.deepEqual(vault.write('first', 'project', 'profile', { TEST_SECRET: 'fictional-environment-key' }), { variableNames: ['TEST_SECRET'] });
        assert.deepEqual(vault.read('second', 'project', 'profile'), {});
        writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { unit: 'vitest --run' } }));
        const registry = new WorkspaceRegistry(initial.executionAuthorizationRoot, true);
        const inspection = inspectWorkspace(directory);
        registry.authorize('first', 'project', 'profile', { directory, packageManager: 'pnpm',
          scripts: { unit: 'unit' }, allowScripts: true, expectedFingerprint: inspection.fingerprint });
        const [authorizationFile] = readdirSync(initial.executionAuthorizationRoot);
        assert.match(readFileSync(join(initial.executionAuthorizationRoot, authorizationFile), 'utf8'), /^workspace-v1\./);
        const sessions = new EnvironmentSessionVault(initial.browserSessionsRoot, Date.now, true);
        sessions.write('first', 'project', 'profile', 'fixture', { cookies: [], origins: [{
          origin: 'http://localhost:3000', localStorage: [{ name: 'qa', value: 'fictional-browser-state' }],
        }] }, new Date(Date.now() + 3600000).toISOString(), ['http://localhost:3000']);
        const [sessionFile] = readdirSync(initial.browserSessionsRoot);
        assert.match(readFileSync(join(initial.browserSessionsRoot, sessionFile), 'utf8'), /^workspace-v1\./);
        const uploads = new UploadVault(initial.browserUploadsRoot, Date.now, true);
        const downloads = new DownloadVault(initial.browserDownloadsRoot, Date.now, true);
        uploadId = uploads.save('first', 'project', 'profile', {
          name: 'fixture.txt', mimeType: 'text/plain', publicTestData: true, base64: content.toString('base64'),
        }).id;
        downloadId = downloads.retain('first', 'project', 'run', {
          kind: 'download', mimeType: 'text/plain', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'),
          permissionUrl: 'http://localhost:3000/fixture.txt',
        }, content).id;
        const view = await saveModelProviderSetting(initial.modelConfigurations('first'), 'first', 'text', {
          provider: 'custom', apiFormat: 'openai-compatible', model: 'fixture', baseUrl: 'https://fixture.invalid', apiKey: 'fictional-provider-key',
        });
        assert.equal(view.hasApiKey, true);
        const stamp = new Date().toISOString();
        initial.importSnapshot(cacheOwner, { id: cacheProject, ownerId: cacheOwner, name: 'Protected cache fixture',
          description: '', workspacePath: '', createdAt: stamp, updatedAt: stamp }, []);
        await initial.reviews(cacheOwner).createReview({ id: cacheReview, projectId: cacheProject, name: 'Cache origin',
          reviewType: 'code_review', status: 'queued', idempotencyKey: 'cache-origin', scope: {}, config: {},
          lineage: { lineageRootId: cacheReview, parentReviewId: null, iteration: 1, reusedSourceManifest: false } });
        await initial.reviewBatchCache(cacheOwner).save(cacheRecord);
        const cacheDb = new DatabaseSync(join(directory, 'workspace.sqlite'), { readOnly: true });
        try {
          assert.match(cacheDb.prepare('SELECT payload FROM local_review_batch_cache').get().payload, /^workspace-v1\\./);
        } finally { cacheDb.close(); }
      } finally { initial.close(); }
      const reopened = new LocalWorkspace(directory);
      try {
        const vault = new EnvironmentVault(reopened.environmentValuesRoot, { deviceEncrypted: true });
        assert.deepEqual(vault.read('first', 'project', 'profile'), { TEST_SECRET: 'fictional-environment-key' });
        const registry = new WorkspaceRegistry(reopened.executionAuthorizationRoot, true);
        assert.equal(registry.verify('first', 'project', 'profile', 'unit').script, 'unit');
        assert.equal(registry.read('second', 'project', 'profile'), null);
        const sessions = new EnvironmentSessionVault(reopened.browserSessionsRoot, Date.now, true);
        assert.deepEqual(sessions.knownValues('first', 'project', 'profile', 'fixture'), ['fictional-browser-state']);
        assert.deepEqual(sessions.knownValues('second', 'project', 'profile', 'fixture'), []);
        const uploads = new UploadVault(reopened.browserUploadsRoot, Date.now, true);
        const downloads = new DownloadVault(reopened.browserDownloadsRoot, Date.now, true);
        const [upload] = uploads.list('first', 'project', 'profile');
        assert.equal(upload.id, uploadId);
        assert.deepEqual(uploads.resolve('first', 'project', 'profile', { ...upload, selector: '#fixture' }).buffer, content);
        assert.equal(downloads.get('first', 'project', 'run', downloadId).base64, content.toString('base64'));
        assert.deepEqual(downloads.list('second', 'project', 'run'), []);
        const configurations = reopened.modelConfigurations('first');
        assert.match(configurations.readModelSetting('first', 'static_review').secret_ciphertext, /^device-v1\\./);
        const provider = await resolveModelProviderChain(configurations, { ownerId: 'first' });
        assert.equal(provider.primary.apiKey, 'fictional-provider-key');
        assert.deepEqual(await reopened.reviewBatchCache(cacheOwner).load(cacheProject, cacheRecord.requestHash), cacheRecord);
        assert.equal(await reopened.reviewBatchCache('different-account').load(cacheProject, cacheRecord.requestHash), null);
      } finally { reopened.close(); }
    } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); }
  `], { input: Buffer.alloc(32, 37), env: { ...process.env, CENTINEL_MODEL_KEY_PIPE: '1', CENTINEL_PACKAGED: '1',
    CENTINEL_TOKEN_ENCRYPTION_KEY: 'legacy-fixture-only' }, timeout: 10_000, encoding: 'utf8' });
  expect(result.stderr?.replace(/^.*ExperimentalWarning: SQLite.*\r?\n(?:.*--trace-warnings.*\r?\n)?/m, '')).toBe('');
  expect(result.status).toBe(0);
});
