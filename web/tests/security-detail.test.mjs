import test from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, extractSecurityCode, normalizeSecurityCode, pickDisclosure, reasonGroups, sliceChartBars } from '../security-detail-core.js';

test('code extraction supports five-digit J-Quants codes and company names',()=>{assert.equal(normalizeSecurityCode('80350'),'8035');assert.equal(extractSecurityCode('東京エレクトロン 8035',[{code:'8035',company_name:'東京エレクトロン'}]),'8035');assert.equal(extractSecurityCode('アドバンテスト',[{code:'6857',company_name:'アドバンテスト'}]),'6857')});
test('chart geometry creates bounded candles and moving averages',()=>{const bars=Array.from({length:80},(_,index)=>({date:`d${index}`,open:100+index,high:102+index,low:98+index,close:101+index,sma20:100+index,sma60:99+index}));const geometry=chartGeometry(sliceChartBars(bars,'3m'));assert.equal(geometry.bars.length,66);assert.ok(geometry.y(geometry.max)<geometry.y(geometry.min));assert.ok(geometry.bodyWidth>=2)});
test('recommendation reasons stay separated',()=>{const groups=reasonGroups({recommendation:{fundamental:{positive_reasons:['割安'],risk_reasons:['欠損']},technical:{positive_reasons:['SMA'],risk_reasons:['高ボラ']}}});assert.deepEqual(groups.fundamental.positive,['割安']);assert.deepEqual(groups.technical.risks,['高ボラ']);assert.ok(!groups.fundamental.risks.includes('高ボラ'))});
test('generic TDnet fields are normalized',()=>{const item=pickDisclosure({DiscTitle:'決算短信',DocumentURL:'https://example.test/a.pdf',DiscDate:'2026-08-08'});assert.equal(item.title,'決算短信');assert.equal(item.url,'https://example.test/a.pdf')});
