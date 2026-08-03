const scoredCountNode = document.querySelector('#scoredCount');
const sourceLabelNode = document.querySelector('#sourceLabel');

async function installScreenedCountDisplay() {
  if (!scoredCountNode || !sourceLabelNode) return;

  let screenedCount = null;
  try {
    const response = await fetch(`./jquants-ranking.json?count=${Date.now()}`, {
      cache: 'no-store',
    });
    if (response.ok) {
      const payload = await response.json();
      const value = Number(payload?.metadata?.scored_count);
      if (Number.isFinite(value) && value >= 0) screenedCount = value;
    }
  } catch {
    // The main application handles the missing-data fallback and error display.
  }

  if (screenedCount === null) return;
  const apply = () => {
    const isJQuants = sourceLabelNode.textContent.includes('J-Quants API V2');
    if (isJQuants && scoredCountNode.textContent !== String(screenedCount)) {
      scoredCountNode.textContent = String(screenedCount);
    }
  };
  apply();
  new MutationObserver(apply).observe(scoredCountNode, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  new MutationObserver(apply).observe(sourceLabelNode, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

installScreenedCountDisplay();
