const test = require('node:test');
const assert = require('node:assert/strict');
const { workspaceUrl, sameWorkspace, externalUrl } = require('../policy');
test('production accepts only credential-free HTTPS workspace roots', () => {
  assert.equal(workspaceUrl('https://cms.example.com/'), 'https://cms.example.com');
  for (const value of ['http://cms.example.com', 'http://127.0.0.1:3100', 'file:///tmp/app', 'javascript:alert(1)', 'https://user:pass@cms.example.com', 'https://cms.example.com/path', 'https://cms.example.com/?token=x']) assert.throws(() => workspaceUrl(value));
  assert.equal(workspaceUrl('http://127.0.0.1:3100', true), 'http://127.0.0.1:3100');
  assert.throws(() => workspaceUrl('http://localhost:9999', true));
});
test('navigation is confined to the workspace origin', () => {
  assert.ok(sameWorkspace('https://cms.example.com/articles/1', 'https://cms.example.com'));
  for (const value of ['https://cms.example.com.attacker.test', 'https://cms.example.com@attacker.test', 'http://cms.example.com', 'file:///tmp/file', 'https://user@cms.example.com']) assert.equal(sameWorkspace(value, 'https://cms.example.com'), false);
});
test('external links reject executable protocols and embedded credentials', () => {
  assert.ok(externalUrl('https://lyricalsource.com/articles/story'));
  for (const value of ['file:///tmp/file', 'javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.com', 'http://example.com']) assert.equal(externalUrl(value), false);
});
test('desktop package is isolated from server dependencies and data', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.dependencies, undefined);
  assert.ok(!pkg.build.files.some(file => file.includes('..') || file.includes('src/') || file.includes('.env') || file.includes('data/')));
  assert.equal(pkg.main, 'main.js');
});

test('CMS subpath workspaces stay confined to /cms', () => {
  assert.equal(workspaceUrl('https://lyricalsource.com/cms/'), 'https://lyricalsource.com/cms');
  assert.ok(sameWorkspace('https://lyricalsource.com/cms/articles/1', 'https://lyricalsource.com/cms'));
  for (const value of ['https://lyricalsource.com/cms-other', 'https://lyricalsource.com/', 'https://other.example/cms']) assert.equal(sameWorkspace(value, 'https://lyricalsource.com/cms'), false);
});

test('Windows and Mac launch the shared CMS without a saved workspace', () => {
  const { SHARED_WORKSPACE, startupWorkspace } = require('../workspace');
  assert.equal(SHARED_WORKSPACE, 'https://lyricalsourcecom.dbm.shared-servers.com/cms');
  assert.equal(startupWorkspace(), SHARED_WORKSPACE);
  assert.equal(startupWorkspace({ packaged: false, args: [] }), SHARED_WORKSPACE);
  assert.equal(startupWorkspace({ packaged: true, args: ['--demo', '--ssh-workspace'] }), SHARED_WORKSPACE);
  assert.equal(startupWorkspace({ packaged: false, args: ['--demo'] }), 'http://127.0.0.1:3100');
  const fs = require('node:fs'), path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.doesNotMatch(main, /workspace\.json|showSetup|Connection settings|workspace:connect/);
  assert.ok(require('../package.json').build.files.includes('workspace.js'));
});
