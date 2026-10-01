const sanitize = require('sanitize-html');
const { escape: e } = require('./views');
function description(value, limit = 20000) {
  const html = String(value || '').includes('<') ? sanitize(value) : e(value).replace(/\n/g, '<br>');
  return `<label id="description-label">Description</label><div class="toolbar" role="group" aria-label="Description formatting"><button type="button" data-format="bold">Bold</button><button type="button" data-format="italic">Italic</button><button type="button" data-format="insertUnorderedList">List</button></div><div class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="description-label" data-rich-editor="description" data-max-length="${limit}">${html}</div><textarea name="description" hidden>${e(value)}</textarea>`;
}
function image(value, site, fallback = '') {
  const initial = value || fallback;
  const src = initial.startsWith('/') ? site + initial : initial;
  return `<div data-cover-editor data-site-url="${e(site)}"><img class="cover-preview" data-cover-preview ${/^https?:\/\//.test(src) ? `src="${e(src)}"` : 'hidden'} alt="Cover preview"><label>Cover image URL<input name="image" data-cover-url value="${e(value)}"></label><label>Upload cover image<input type="file" name="imageFile" accept="image/jpeg,image/png,image/webp,image/gif" data-cover-file></label><p class="save-status">JPEG, PNG, WebP or GIF; maximum 5 MB. Keep the selected file until saving succeeds.</p></div>`;
}
const saveStatus = '<p class="save-status" role="status" data-save-status>All changes saved.</p>';
function cleanDescription(value, limit = 20000) {
  const text = String(value || '');
  if (text.length > limit) throw new Error(`Description must be ${limit} characters or fewer.`);
  return sanitize(text);
}
async function uploadCover(file, request) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) throw new Error('Choose a JPEG, PNG, WebP or GIF cover.');
  const body = new FormData();
  body.append('image', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  return (await request('POST', 'media', body, true)).url;
}
module.exports = { description, image, saveStatus, uploadCover, cleanDescription };
