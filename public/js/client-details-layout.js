document.addEventListener('click', event => {
  const menu = document.getElementById('clientMoreMenu');
  if (menu && !menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  const menu = document.getElementById('clientMoreMenu');
  if (event.key === 'Escape' && menu?.open) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
