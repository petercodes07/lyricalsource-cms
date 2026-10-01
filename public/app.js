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
  document.querySelectorAll('input[type="password"]').forEach(input => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary password-toggle'; button.textContent = 'Show password';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const show = input.type === 'password'; input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide password' : 'Show password'; button.setAttribute('aria-pressed', String(show));
    });
    input.after(button);
  });
  document.querySelectorAll('[data-cover-editor]').forEach(container => {
    const preview = container.querySelector('[data-cover-preview]');
    const url = container.querySelector('[data-cover-url]');
    const file = container.querySelector('[data-cover-file]');
    let objectUrl;
    const update = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const selected = file.files[0];
      file.setCustomValidity(selected && selected.size > 5 * 1024 * 1024 ? 'Choose an image smaller than 5 MB.' : '');
      const source = selected ? (objectUrl = URL.createObjectURL(selected)) : url.value.startsWith('/') ? container.dataset.siteUrl + url.value : url.value;
      preview.hidden = !source || !/^(https?:|blob:)/.test(source);
      if (!preview.hidden) preview.src = source;
    };
    url.addEventListener('input', update); file.addEventListener('change', update);
  });
  const form = document.querySelector('[data-editor-form]');
  if (!form) return;
  let dirty = !!document.querySelector('[role="alert"]');
  let saving = false;
  const status = document.querySelector('[data-save-status]');
  const editor = document.getElementById('editor');
  const markDirty = () => { dirty = true; if (status) status.textContent = 'Unsaved changes'; };
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);
  form.addEventListener('editor-change', markDirty);
  if (editor) new MutationObserver(markDirty).observe(editor, { childList: true, subtree: true, characterData: true, attributes: true });
  window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const richEditors = form.querySelectorAll('[data-rich-editor]');
  richEditors.forEach(rich => {
    rich.addEventListener('input', () => { form.elements[rich.dataset.richEditor].value = rich.innerHTML; });
  });
  form.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => {
    richEditors[0]?.focus(); document.execCommand(button.dataset.format); markDirty();
  }));
  form.addEventListener('submit', async event => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (saving) return;
    if (!navigator.onLine) {
      event.preventDefault();
      if (status) status.textContent = 'You are offline. Keep this page open and reconnect to save.';
      return;
    }
    if (editor) document.getElementById('body').value = editor.innerHTML;
    richEditors.forEach(rich => { form.elements[rich.dataset.richEditor].value = rich.innerHTML; });
    const body = new FormData(form);
    saving = true;
    if (event.submitter?.name) body.append(event.submitter.name, event.submitter.value);
    const buttons = Array.from(form.querySelectorAll('button[type="submit"],button:not([type])'));
    buttons.forEach(button => { button.disabled = true; });
    if (status) status.textContent = 'Saving…';
    try {
      const payload = form.enctype === 'multipart/form-data' ? body : new URLSearchParams(Array.from(body).filter(([,value]) => typeof value === 'string'));
      const response = await fetch(form.action, { method: 'POST', body: payload });
      const html = await response.text();
      const page = new DOMParser().parseFromString(html, 'text/html');
      if (!response.ok) throw new Error(page.querySelector('[role="alert"],.notice')?.textContent || 'Save failed');
      if (!response.redirected || page.querySelector('input[autocomplete="current-password"]') && !form.querySelector('input[autocomplete="current-password"]')) throw new Error('Save could not be confirmed');
      dirty = false;
      if (status) status.textContent = 'Saved successfully';
      location.assign(response.url);
    } catch (error) {
      dirty = true;
      saving = false;
      if (status) status.textContent = `${error.message || 'Save could not be confirmed'}. Your entries and selected files are still here. Check the saved version in a separate window before retrying.`;
      buttons.forEach(button => { button.disabled = false; });
    }
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
