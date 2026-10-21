(() => {
  'use strict';
  const status = document.getElementById('announcement');
  let notificationTimer;
  const announce = message => {
    status.textContent = message;
    status.classList.add('visible');
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => status.classList.remove('visible'), 3000);
  };
  document.querySelectorAll('[data-copy]').forEach(button => {
    const label = button.querySelector('span');
    const originalLabel = label.textContent;
    let resetTimer;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        label.textContent = 'Copied ✓';
        announce('Copied ' + button.dataset.copy);
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { label.textContent = originalLabel; }, 2200);
      } catch {
        // Keep the path selectable when clipboard access is blocked.
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(button.querySelector('code'));
        selection.removeAllRanges();
        selection.addRange(range);
        announce('Copy the selected path with your browser’s copy command.');
      }
    });
  });
  document.getElementById('year').textContent = String(new Date().getFullYear());
})();
