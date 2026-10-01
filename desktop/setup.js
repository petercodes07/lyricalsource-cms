const form = document.querySelector('form');
const input = document.getElementById('url');
const error = document.getElementById('error');
window.workspace.get().then(settings => { input.value = settings.url; }).catch(() => { error.textContent = 'Could not read connection settings.'; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try { const result = await window.workspace.connect(input.value); error.textContent = result.error || ''; }
  catch { error.textContent = 'Could not connect. Try again.'; }
  finally { button.disabled = false; }
});
