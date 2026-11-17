(() => {
  const dialog = document.getElementById('add-category-modal');
  const trigger = document.getElementById('open-category-modal');
  if (!dialog || !trigger) return;
  let previousOverflow = '';
  const open = () => {
    if (dialog.open) return;
    previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
  };
  trigger.addEventListener('click', open);
  dialog.querySelectorAll('[data-close-category]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    const url = new URL(window.location.href);
    url.searchParams.delete('add');
    history.replaceState(null, '', url);
    trigger.focus();
  });
  if (dialog.dataset.autoOpen === 'true') open();
})();
