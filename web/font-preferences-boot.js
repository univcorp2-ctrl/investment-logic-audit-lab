(() => {
  const root = document.documentElement;
  try {
    const display = JSON.parse(localStorage.getItem('valuescope-display-preferences-v1') ?? 'null') ?? {};
    const fontScale = localStorage.getItem('valuescope-font-scale-v1') ?? display.fontScale ?? 'normal';
    const density = localStorage.getItem('valuescope-density-v1') ?? display.density ?? 'comfortable';
    root.dataset.fontScale = ['normal','large','xlarge'].includes(fontScale) ? fontScale : 'normal';
    root.dataset.displayDensity = ['comfortable','compact'].includes(density) ? density : 'comfortable';
    root.dataset.displayContrast = display.contrast === 'high' ? 'high' : 'normal';
    root.dataset.reduceMotion = String(Boolean(display.reducedMotion));
  } catch {
    root.dataset.fontScale = 'normal';
    root.dataset.displayDensity = 'comfortable';
    root.dataset.displayContrast = 'normal';
    root.dataset.reduceMotion = 'false';
  }
})();
