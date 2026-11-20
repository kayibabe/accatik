import test from 'node:test';
import assert from 'node:assert/strict';
import type { RawApiOddsItem } from './apiFootball.ts';
import { buildMarketsFromOdds, toFixture } from './markets.ts';

function odds(values: Record<string, Array<[string, string]>>): RawApiOddsItem {
  return {
    fixture: { id: 77 },
    bookmakers: [
      {
        id: 8,
        name: 'Bet365',
        bets: Object.entries(values).map(([name, prices]) => ({
          id: 0,
          name,
          values: prices.map(([value, odd]) => ({ value, odd })),
        })),
      },
    ],
  };
}

const fullBook = odds({
  'Match Winner': [
    ['Home', '2.10'],
    ['Draw', '3.30'],
    ['Away', '3.50'],
  ],
  'Double Chance': [
    ['Home/Draw', '1.30'],
    ['Home/Away', '1.35'],
    ['Draw/Away', '1.70'],
  ],
  'Goals Over/Under': [
    ['Over 1.5', '1.35'],
    ['Under 1.5', '3.10'],
    ['Over 2.5', '1.95'],
    ['Under 2.5', '1.85'],
    ['Over 3.5', '3.20'],
    ['Under 3.5', '1.35'],
    ['Over 4.5', '6.00'],
    ['Under 4.5', '1.13'],
  ],
  'Both Teams Score': [
    ['Yes', '1.80'],
    ['No', '2.00'],
  ],
  'Draw No Bet': [
    ['Home', '1.70'],
    ['Away', '2.20'],
  ],
});

test('every published selection is archived, including the extra lines', () => {
  const result = buildMarketsFromOdds('77', 'Alpha', 'Beta', fullBook);
  const ids = result.allMarkets.map((market) => market.id);

  for (const id of [
    '77-1x2-h',
    '77-1x2-d',
    '77-1x2-a',
    '77-dc-1x',
    '77-dc-12',
    '77-dc-x2',
    '77-ou-15',
    '77-ou-u15',
    '77-ou-25',
    '77-ou-u25',
    '77-ou-35',
    '77-ou-u35',
    '77-ou-45',
    '77-ou-u45',
    '77-btts-yes',
    '77-btts-no',
    '77-dnb-h',
    '77-dnb-a',
  ]) {
    assert.ok(ids.includes(id), `${id} should be priced`);
  }
  assert.equal(result.allMarkets.length, 18);
  assert.ok(
    result.allMarkets.every(
      (market) => market.fairProbability !== undefined
    ),
    'all selections must carry a de-vigged probability'
  );
  assert.equal(
    result.allMarkets.find((market) => market.id === '77-ou-u45')?.label,
    'Under 4.5 Goals'
  );
});

test('the board keeps the five headline markets only', () => {
  const result = buildMarketsFromOdds('77', 'Alpha', 'Beta', fullBook);
  assert.deepEqual(
    result.markets.map((market) => market.id),
    [
      '77-1x2-h',
      '77-1x2-a',
      '77-ou-15',
      '77-ou-25',
      '77-btts-yes',
    ]
  );
  assert.ok(!result.markets.some((market) => market.id.endsWith('btts-no')));
  assert.ok(!result.markets.some((market) => market.id.endsWith('dc-12')));
});

test('fixtures carry both the board shortlist and the full priced ladder', () => {
  const raw = {
    fixture: {
      id: 77,
      timestamp: 1763300400,
      date: '2026-11-16T18:00:00+02:00',
      status: { short: 'NS' },
      venue: { name: 'Ground', city: 'Cape Town' },
    },
    league: { name: 'League', country: 'South Africa', round: 'Round 1' },
    teams: {
      home: { name: 'Alpha' },
      away: { name: 'Beta' },
    },
    score: {},
  } as Parameters<typeof toFixture>[0];

  const fixture = toFixture(raw, fullBook, '2026-11-16', 1763296800000);
  assert.equal(fixture.markets.length, 5);
  assert.equal(fixture.allMarkets?.length, 18);
});

test('books without the extra values still build cleanly', () => {
  const legacy = odds({
    'Match Winner': [
      ['Home', '2.10'],
      ['Draw', '3.30'],
      ['Away', '3.50'],
    ],
    'Goals Over/Under': [
      ['Over 1.5', '1.35'],
      ['Over 2.5', '1.95'],
    ],
  });
  const result = buildMarketsFromOdds('77', 'Alpha', 'Beta', legacy);
  assert.deepEqual(
    result.allMarkets.map((market) => market.id),
    ['77-1x2-h', '77-1x2-a', '77-ou-15', '77-ou-25', '77-1x2-d']
  );
  assert.deepEqual(
    result.markets.map((market) => market.id),
    ['77-1x2-h', '77-1x2-a', '77-ou-15', '77-ou-25']
  );
});
