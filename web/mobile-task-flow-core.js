export const PHONE_TASKS = Object.freeze({
  overview: Object.freeze([
    { key:'summary', label:'要点' },
    { key:'demo', label:'デモ運用' },
    { key:'data', label:'データ状態' },
  ]),
  decision: Object.freeze([
    { key:'recommendation', label:'推奨' },
    { key:'ranking', label:'ランキング' },
    { key:'detail', label:'銘柄詳細' },
  ]),
  screening: Object.freeze([
    { key:'quick', label:'かんたん設定', parameterTab:'screening' },
    { key:'fundamental', label:'Fundamental', parameterTab:'fundamental' },
    { key:'technical', label:'Technical', parameterTab:'technical' },
    { key:'risk', label:'Risk', parameterTab:'risk' },
    { key:'display', label:'表示', parameterTab:'display' },
    { key:'advanced', label:'詳細設定' },
  ]),
  performance: Object.freeze([
    { key:'current', label:'現在損益' },
    { key:'curve', label:'資産推移' },
    { key:'metrics', label:'分析指標' },
    { key:'diagnosis', label:'原因分析' },
  ]),
  data: Object.freeze([
    { key:'plans', label:'J-Quants', decisionTab:'plan' },
    { key:'disclosure', label:'開示能力', decisionTab:'disclosure' },
    { key:'learning', label:'AI学習' },
    { key:'strategy', label:'戦略ラボ', decisionTab:'strategy' },
  ]),
});

export function normalizePhoneView(value) {
  return Object.hasOwn(PHONE_TASKS, value) ? value : 'overview';
}

export function normalizePhoneTask(view, task) {
  const normalizedView = normalizePhoneView(view);
  const tasks = PHONE_TASKS[normalizedView];
  return tasks.some(item => item.key === task) ? task : tasks[0].key;
}

export function parsePhoneState(hash = '') {
  const params = new URLSearchParams(String(hash).replace(/^#/, ''));
  const view = normalizePhoneView(params.get('view') ?? 'overview');
  return { view, task:normalizePhoneTask(view, params.get('task')), params };
}

export function phoneHash(hash, view, task) {
  const parsed = parsePhoneState(hash);
  parsed.params.set('view', normalizePhoneView(view));
  parsed.params.set('task', normalizePhoneTask(view, task));
  return `#${parsed.params.toString()}`;
}

export function taskIndex(view, task) {
  return Math.max(0, PHONE_TASKS[normalizePhoneView(view)].findIndex(item => item.key === task));
}

export function adjacentTask(view, task, direction) {
  const tasks = PHONE_TASKS[normalizePhoneView(view)];
  const index = taskIndex(view, task);
  return tasks[Math.max(0, Math.min(tasks.length - 1, index + direction))].key;
}

export function taskDefinition(view, task) {
  const tasks = PHONE_TASKS[normalizePhoneView(view)];
  return tasks.find(item => item.key === normalizePhoneTask(view, task)) ?? tasks[0];
}
