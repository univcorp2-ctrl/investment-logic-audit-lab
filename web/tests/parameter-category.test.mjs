import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryForParameterPath, categorySummary } from '../parameter-category-core.js';

test('Fundamental and Technical paths never mix',()=>{for(const path of ['fundamental.minRoePct','fundamental.minFcfYieldPct','screening.minQuality','screening.maxTrap'])assert.equal(categoryForParameterPath(path),'F');for(const path of ['screening.minTechnical','screening.minRsi','screening.requireSma20AboveSma60','screening.maxVolatility'])assert.equal(categoryForParameterPath(path),'T')});
test('risk screening and display classifications are explicit',()=>{assert.equal(categoryForParameterPath('risk.maxPortfolioDrawdownPct'),'R');assert.equal(categoryForParameterPath('screening.market'),'S');assert.equal(categoryForParameterPath('screening.minCompleteness'),'S');assert.equal(categoryForParameterPath('display.fontScale'),'UI')});
test('category summary counts paths',()=>{assert.deepEqual(categorySummary(['fundamental.minRoePct','screening.minRsi','risk.maxPositionLossPct','screening.market','display.fontScale']),{F:1,T:1,R:1,S:1,UI:1})});
