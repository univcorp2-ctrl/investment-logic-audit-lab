import test from 'node:test';
import assert from 'node:assert/strict';
import { PHONE_DESTINATIONS, adjacentPhonePage, allManagedSelectors, parsePhoneHash, serializePhoneHash } from '../phone-flow-core.js';

test('all five phone destinations have bounded subpages',()=>{assert.deepEqual(Object.keys(PHONE_DESTINATIONS),['overview','decision','screening','performance','other']);for(const pages of Object.values(PHONE_DESTINATIONS)){assert.ok(pages.length>=3&&pages.length<=5);assert.equal(new Set(pages.map(page=>page.key)).size,pages.length)}});
test('phone hash preserves other parameters and restores page',()=>{const hash=serializePhoneHash('screening','technical','#parameters=abc');assert.match(hash,/parameters=abc/);assert.match(hash,/phone=screening%3Atechnical/);assert.deepEqual(parsePhoneHash(hash).destination,'screening');assert.deepEqual(parsePhoneHash(hash).subpage,'technical')});
test('adjacent navigation is clamped',()=>{assert.equal(adjacentPhonePage('overview','summary',-1).key,'summary');assert.equal(adjacentPhonePage('overview','summary',1).key,'demo');assert.equal(adjacentPhonePage('other','export',1).key,'export')});
test('managed selectors include decision parameters analytics and risk',()=>{const selectors=allManagedSelectors();for(const selector of ['#investmentDecisionReport','#parameterControl','#performanceAnalytics','#riskDiagnostics','.ranking'])assert.ok(selectors.includes(selector))});
