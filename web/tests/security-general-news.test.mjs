import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneralNewsRss, reasonGroups } from '../security-detail-core.js';

test('general news parser returns metadata only', () => {
  const xml = '<rss><channel><item><title><![CDATA[決算ニュース]]></title><link>https://example.com/news</link><pubDate>Fri, 07 Aug 2026 00:00:00 GMT</pubDate><source url="https://example.com">Example Media</source><description>Article body must not be copied</description></item></channel></rss>';
  const items = parseGeneralNewsRss(xml);
  assert.deepEqual(Object.keys(items[0]), ['title','link','published_at','source']);
  assert.equal(items[0].source, 'Example Media');
  assert.equal(JSON.stringify(items).includes('Article body'), false);
});

test('flat API reason fields render into separate groups', () => {
  const groups = reasonGroups({ recommendation:{ fundamental_reasons_positive:['割安'], fundamental_risks:['Trap'], technical_reasons_positive:['上昇'], technical_risks:['過熱'] } });
  assert.deepEqual(groups.fundamental.positive, ['割安']);
  assert.deepEqual(groups.fundamental.risks, ['Trap']);
  assert.deepEqual(groups.technical.positive, ['上昇']);
  assert.deepEqual(groups.technical.risks, ['過熱']);
});
