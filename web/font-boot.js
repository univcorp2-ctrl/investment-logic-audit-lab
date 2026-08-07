(() => {
  const root = document.documentElement;
  const parseJson = key => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
  };
  const central = parseJson('valuescope-parameter-bundle-v1')
    ?? parseJson('valuescope-user-parameters-v2')
    ?? {};
  const storedDisplay = parseJson('valuescope-display-preferences-v1') ?? {};
  const display = { ...storedDisplay, ...(central.display ?? central.ui ?? {}) };
  const storedFont = localStorage.getItem('valuescope-font-scale-v1');
  const rawFont = storedFont || display.fontScale || 'normal';
  const fontScale = ['normal', 'standard', 'large', 'xlarge'].includes(rawFont) ? rawFont : 'normal';
  const density = localStorage.getItem('valuescope-density-v1') || display.density || 'comfortable';
  const contrast = display.contrast || (display.highContrast ? 'high' : 'normal');
  const reducedMotion = Boolean(display.reducedMotion);
  const px = ({ normal:16, standard:16, large:18, xlarge:20 })[fontScale] ?? 16;
  root.dataset.fontScale = fontScale;
  root.dataset.displayDensity = density === 'compact' ? 'compact' : 'comfortable';
  root.dataset.displayContrast = contrast === 'high' ? 'high' : 'normal';
  root.dataset.reduceMotion = String(reducedMotion);
  root.style.setProperty('--user-root-font-size', `${px}px`);
  root.style.setProperty('--pcc-root-font-size', `${px}px`);
})();
