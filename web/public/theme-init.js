// Applies the stored theme before first paint so the page never flashes the wrong colours.
// Kept as an external file because the CSP forbids inline scripts.
(function () {
  try {
    var t = localStorage.getItem('r16a.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    // Storage can be unavailable in private windows, the system theme then applies.
  }
})();
