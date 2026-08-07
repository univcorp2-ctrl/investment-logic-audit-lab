import test from 'node:test';
import assert from 'node:assert/strict';
import { densityForMode, normalizeView, parseShellHash, sectionViewMap, shellHash, viewForSelector, viewportMode } from '../app-shell-core.js';

test('viewport modes separate phone tablet and desktop', () => {
  assert.equal(viewportMode(390), 'phone');
  assert.equal(viewportMode(767), 'phone');
  assert.equal(viewportMode(768), 'tablet');
  assert.equal(viewportMode(1024), 'tablet');
  assert.equal(viewportMode(1180), 'tablet');
  assert.equal(viewportMode(1440), 'desktop');
});

test('view routing preserves screening configuration hash', () => {
  const hash = shellHash('analytics', '#screen=abc123');
  const parsed = parseShellHash(hash);
  assert.equal(parsed.view, 'analytics');
  assert.equal(parsed.params.get('screen'), 'abc123');
});

test('direct anchors map to their primary view', () => {
  assert.equal(viewForSelector('screeningLab'), 'screening');
  assert.equal(viewForSelector('performanceAnalytics'), 'analytics');
  assert.equal(viewForSelector('investmentDecisionReport'), 'decision');
  assert.equal(normalizeView('unknown'), 'overview');
});

test('phone always uses comfortable density', () => {
  assert.equal(densityForMode('phone','compact'), 'comfortable');
  assert.equal(densityForMode('tablet','compact'), 'compact');
});

test('section map groups existing dynamic modules once', () => {
  const map = sectionViewMap();
  assert.equal(map['#demoTrade'], 'analytics');
  assert.equal(map['#riskDiagnostics'], 'analytics');
  assert.equal(map['#screeningLab'], 'screening');
});
