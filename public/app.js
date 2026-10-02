(() => {
  let installPrompt;
  const installButton = document.querySelector('[data-install]');
  const help = document.querySelector('[data-install-help]');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone && help) help.textContent = 'You are using the installed app.';
  window.addEventListener('beforeinstallprompt', event => {
    if (!installButton || standalone) return;
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton?.addEventListener('click', async () => {
    if (!installPrompt) return;
    try { await installPrompt.prompt(); await installPrompt.userChoice; }
    finally { installPrompt = null; installButton.hidden = true; }
  });
  window.addEventListener('appinstalled', () => {
    if (installButton) installButton.hidden = true;
    if (help) help.textContent = 'Installed. Open LyricalSource CMS from your apps.';
  });
  const connection = document.querySelector('[data-connection]');
  const updateConnection = () => { if (connection) connection.hidden = navigator.onLine; };
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  updateConnection();
  const form = document.querySelector('[data-editor-form]');
  if (!form) return;
  let dirty = form.dataset.unsaved === '1';
  const status = document.querySelector('[data-save-status]');
  const editor = document.getElementById('editor');
  const markDirty = () => { dirty = true; if (status) status.textContent = 'Unsaved changes'; };
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);
  if (editor) new MutationObserver(markDirty).observe(editor, { childList: true, subtree: true, characterData: true, attributes: true });
  window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  form.addEventListener('submit', event => {
    if (!navigator.onLine) {
      event.preventDefault();
      if (status) status.textContent = 'You are offline. Keep this page open and reconnect to save.';
      return;
    }
    if (editor) document.getElementById('body').value = editor.innerHTML;
    dirty = false;
    if (status) status.textContent = 'Saving…';
  });
})();

// Native disclosure menus retain keyboard support without a custom menu widget.
(() => {
  const menu = document.querySelector('[data-profile-menu]');
  if (!menu) return;
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
})();

(() => {
  const form = document.querySelector('[data-editing]');
  if (!form) return;
  const script = document.querySelector('script[src$="/app.js"]');
  const endpoint = new URL('editing/' + form.dataset.editing, script.src);
  const notice = document.createElement('p');
  notice.className = 'notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  form.before(notice);
  let pending = false;
  async function heartbeat() {
    if (document.hidden || pending || !navigator.onLine) return;
    pending = true;
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const { editors } = await response.json();
      notice.textContent = editors.length ? `${editors.join(', ')} ${editors.length === 1 ? 'is' : 'are'} also editing this item. Only the first save of this version will be accepted.` : '';
      notice.hidden = !editors.length;
    } catch {
      notice.textContent = 'Live editor presence is unavailable. Save conflict checks still apply.';
      notice.hidden = false;
    } finally { pending = false; }
  }
  heartbeat();
  const timer = setInterval(heartbeat, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    navigator.sendBeacon(endpoint, new URLSearchParams({ leave: '1' }));
  });
})();
