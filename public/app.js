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
  let dirty = false;
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
