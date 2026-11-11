// Applies the theme the user last chose (kept in this browser only) before the page paints.
// Without a saved choice the page follows the system setting.
try {
  var saved = localStorage.getItem('nb-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch (e) { /* storage unavailable: follow the system */ }
