import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_FAMILY_CHIP_TONE,
  marketTypeFromLabel,
  marketTypeFromSelectionKey,
  splitLeadingMarketLabel,
} from './marketLabelTone.ts';

test('every market family gets its own accent', () => {
  const tones = Object.values(MARKET_FAMILY_CHIP_TONE);
  assert.equal(new Set(tones).size, tones.length);
});

test('selection keys map to market families', () => {
  assert.equal(marketTypeFromSelectionKey('GOALS-O2.5'), 'Goals');
  assert.equal(marketTypeFromSelectionKey('BTTS-YES'), 'BTTS');
  assert.equal(marketTypeFromSelectionKey('DC-X2'), 'Double Chance');
  assert.equal(marketTypeFromSelectionKey('DNB-1'), 'Draw No Bet');
  assert.equal(marketTypeFromSelectionKey('1X2-H'), '1X2');
  assert.equal(marketTypeFromSelectionKey('unknown'), null);
});

test('market labels map to the same families', () => {
  assert.equal(marketTypeFromLabel('Over 2.5 Goals'), 'Goals');
  assert.equal(marketTypeFromLabel('BTTS Yes'), 'BTTS');
  assert.equal(marketTypeFromLabel('X2 (Draw or Away)'), 'Double Chance');
  assert.equal(marketTypeFromLabel('Double chance : draw or Birmingham'), 'Double Chance');
  assert.equal(marketTypeFromLabel('Draw No Bet'), 'Draw No Bet');
  assert.equal(marketTypeFromLabel('Home Win'), '1X2');
  assert.equal(marketTypeFromLabel('Model leans Home at 40%'), null);
});

test('a leading market phrase is split out of provider advice', () => {
  assert.deepEqual(splitLeadingMarketLabel('Double chance : draw or Birmingham'), {
    label: 'Double Chance',
    rest: 'draw or Birmingham',
    marketType: 'Double Chance',
  });
  assert.deepEqual(splitLeadingMarketLabel('Over 2.5 Goals at 1.80'), {
    label: 'Over 2.5 Goals',
    rest: 'at 1.80',
    marketType: 'Goals',
  });
  assert.deepEqual(splitLeadingMarketLabel('BTTS Yes — both sides to score'), {
    label: 'BTTS Yes',
    rest: 'both sides to score',
    marketType: 'BTTS',
  });
});

test('notes without a market phrase stay intact', () => {
  assert.deepEqual(splitLeadingMarketLabel('  Model leans Home at 40%.  '), {
    label: '',
    rest: 'Model leans Home at 40%.',
    marketType: null,
  });
});
