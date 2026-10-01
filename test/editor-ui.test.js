const test = require('node:test');
const assert = require('node:assert/strict');
const editor = require('../src/editor-ui');
const { layout } = require('../src/views');
test('description formatting is sanitized and constrained before saving', () => {
  assert.equal(editor.cleanDescription('<p>Hello <b>world</b></p><script>alert(1)</script>'), '<p>Hello <b>world</b></p>');
  assert.throws(() => editor.cleanDescription('12345',4), /characters/);
});
test('cover uploads use the existing image media API contract', async () => {
  let called = false;
  const url = await editor.uploadCover({ mimetype:'image/png',buffer:Buffer.from('test'),originalname:'cover.png' }, async (method,route,body,multipart) => {
    called = true; assert.equal(method,'POST');assert.equal(route,'media');assert.equal(multipart,true);assert.equal(body.get('image').name,'cover.png');return {url:'/uploads/cover.png'};
  });
  assert.equal(url,'/uploads/cover.png'); assert.ok(called);
  await assert.rejects(editor.uploadCover({mimetype:'text/html'},()=>{}), /JPEG/);
});
test('section search and author navigation match permitted content', () => {
  const editorUser={id:1,name:'Editor',email:'editor@example.com',role:'editor'};
  assert.match(layout('Albums',editorUser,''), /action="\/albums" method="get" role="search"/);
  assert.match(layout('Playlists',editorUser,''), /placeholder="Search playlists…"/);
  assert.match(layout('Songs',editorUser,''), /action="\/songs" method="get" role="search"/);
  const author=layout('Articles',{...editorUser,role:'author'},'');
  assert.doesNotMatch(author, /href="\/(albums|playlists|songs|team)"/);
});
