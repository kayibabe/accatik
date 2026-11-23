import test from 'node:test';
import assert from 'node:assert/strict';
import type { Fixture } from '../../src/types/fixtures.ts';
import type {
  CombinationRoiResponse,
  CombinationRoiRow,
  PositiveReadCombo,
} from '../../src/types/analytics.ts';
import { makeFixture } from '../../src/utils/testFactories.ts';
import { studyPickForFixture } from './combinationRoi.ts';
import {
  buildPositiveReadMatchesResponse,
  positiveCombosFromStudy,
} from './positiveReadMatches.ts';

function row(
  overrides: Partial<CombinationRoiRow> & Pick<CombinationRoiRow, 'key'>
): CombinationRoiRow {
  return {
    scope: 'section-band',
    section: 'note',
    band: 'High',
    marketKey: 'GOALS-O2.5',
    marketLabel: 'Over 2.5 Goals',
    settled: 20,
    staked: 20,
    wins: 12,
    losses: 8,
    voids: 0,
    winRate: 60,
    avgOdds: 2,
    netPnl: 4,
    roi: 20,
    positiveDates: 3,
    totalDates: 4,
    roiCiLow: 5,
    roiCiHigh: 35,
    firstDateIso: '2026-10-01',
    lastDateIso: '2026-11-20',
    smallSample: false,
    ...overrides,
  };
}

function study(rows: CombinationRoiRow[]): CombinationRoiResponse {
  return {
    strategy: 'balanced',
    generatedAt: '2026-11-23T04:00:00.000Z',
    firstDateIso: '2026-10-01',
    lastDateIso: '2026-11-22',
    sampleDates: 30,
    sampleFixtures: 300,
    stakePerPick: 1,
    minSample: 20,
    bands: ['High', 'Solid', 'Moderate', 'Speculative'],
    markets: [],
    rows,
    priceQuality: { prematch: 300, live: 0, unknown: 0 },
    snapshotFixtures: 300,
    caveats: [],
  };
}

function combo(
  key: string,
  overrides: Partial<PositiveReadCombo> = {}
): PositiveReadCombo {
  return {
    key,
    section: 'angle',
    sectionLabel: 'Recommended Angle',
    band: 'High',
    marketKey: 'GOALS-O2.5',
    marketLabel: 'Over 2.5 Goals',
    label: 'Recommended Angle · High · Over 2.5 Goals',
    roi: 12,
    staked: 24,
    smallSample: false,
    roiCiLow: 4,
    ...overrides,
  };
}

/** A finished fixture whose captured cards resolve to two known study cells. */
function snapshotFixture(): Fixture {
  return makeFixture({
    id: 'snap',
    score: { home: 2, away: 1 },
    kickoffTimestamp: Date.UTC(2026, 10, 22, 16),
    modelAdvice: '',
    markets: [],
    featuredPickSnapshots: [
      {
        capturedAt: '2026-11-22T10:00:00.000Z',
        strategy: 'balanced',
        angle: {
          marketId: 'snap-ou25',
          selectionKey: 'GOALS-O2.5',
          label: 'Over 2.5 Goals',
          marketType: 'Goals',
          odds: 1.9,
          fairProbability: 74,
        },
        cover: {
          marketId: 'snap-1x2-h',
          selectionKey: '1X2-H',
          label: 'Home Win',
          marketType: '1X2',
          odds: 1.5,
          fairProbability: 66,
        },
        note: null,
      },
    ],
  });
}

test('positiveCombosFromStudy mirrors the table Positive toggle and labels each row', () => {
  const combos = positiveCombosFromStudy(
    study([
      row({
        key: 'note:High:GOALS-O2.5',
        section: 'note',
        band: 'High',
        marketKey: 'GOALS-O2.5',
        marketLabel: 'Over 2.5 Goals',
        roi: 12.3,
      }),
      row({
        key: 'angle:High:GOALS-O2.5',
        section: 'angle',
        band: 'High',
        marketKey: 'GOALS-O2.5',
        roi: 2,
      }),
      row({
        key: 'note:Solid:BTTS-YES',
        section: 'note',
        band: 'Solid',
        marketKey: 'BTTS-YES',
        marketLabel: 'BTTS Yes',
        roi: 5.1,
        staked: 8,
        smallSample: true,
        roiCiLow: -4,
      }),
      row({ key: 'cover:High:1X2-H', section: 'cover', roi: 0 }),
      row({ key: 'note:Solid:1X2-A', section: 'note', roi: -1 }),
      row({ key: 'note:Solid:1X2-D', section: 'note', roi: null }),
      row({ key: 'note:All:GOALS-O2.5', section: 'note', band: 'All', roi: 9 }),
      row({ key: 'null:High:GOALS-O2.5', section: null, roi: 9 }),
      row({
        key: 'note:High:GOALS-O2.5',
        scope: 'section',
        band: 'All',
        roi: 9,
      }),
      row({ key: 'market:GOALS-O2.5', scope: 'market', section: null, band: 'All', roi: 9 }),
    ])
  );

  assert.deepEqual(
    combos.map((item) => item.label),
    [
      'Analyst Note · High · Over 2.5 Goals',
      'Recommended Angle · High · Over 2.5 Goals',
      'Analyst Note · Solid · BTTS Yes',
    ]
  );
  assert.equal(combos[0].key, 'note:High:GOALS-O2.5');
  assert.equal(combos[2].smallSample, true);
  assert.equal(combos[2].roiCiLow, -4);
});

test('studyPickForFixture reuses the study resolver, band and selection key', () => {
  const fixture = snapshotFixture();
  const angle = studyPickForFixture(fixture, 'balanced', 'angle');
  const cover = studyPickForFixture(fixture, 'balanced', 'cover');

  assert.deepEqual(
    {
      selectionKey: angle?.selectionKey,
      marketLabel: angle?.marketLabel,
      band: angle?.band,
    },
    { selectionKey: 'GOALS-O2.5', marketLabel: 'Over 2.5 Goals', band: 'High' }
  );
  assert.deepEqual(
    { selectionKey: cover?.selectionKey, band: cover?.band },
    { selectionKey: '1X2-H', band: 'Solid' }
  );
  assert.equal(studyPickForFixture(fixture, 'balanced', 'note'), null);

  const empty = makeFixture({
    id: 'empty',
    markets: [],
    featuredPickSnapshots: [],
    modelAdvice: undefined,
  });
  assert.equal(studyPickForFixture(empty, 'balanced', 'angle'), null);
});

test('one match carries every hit combo, with no duplicate fixtures', () => {
  const fixture = snapshotFixture();
  const noPick = makeFixture({
    id: 'no-pick',
    markets: [],
    featuredPickSnapshots: [],
    modelAdvice: undefined,
  });

  const response = buildPositiveReadMatchesResponse({
    strategy: 'balanced',
    dateIso: '2026-11-22',
    source: 'archive',
    fixtures: [noPick, fixture],
    combos: [
      combo('angle:High:GOALS-O2.5'),
      combo('cover:Solid:1X2-H', {
        section: 'cover',
        sectionLabel: 'Safer Cover',
        band: 'Solid',
        marketKey: '1X2-H',
        marketLabel: 'Home Win',
        label: 'Safer Cover · Solid · Home Win',
        roi: 8,
      }),
    ],
    availableDates: ['2026-11-22', '2026-11-21'],
    generatedAt: '2026-11-23T04:00:00.000Z',
  });

  assert.equal(response.matches.length, 1);
  assert.equal(response.matches[0].fixtureId, 'snap');
  assert.deepEqual(
    response.matches[0].combos.map((item) => item.key),
    ['angle:High:GOALS-O2.5', 'cover:Solid:1X2-H']
  );
  assert.deepEqual(
    response.matches[0].picks.map((pick) => ({
      comboKey: pick.comboKey,
      marketId: pick.marketId,
      marketType: pick.marketType,
      odds: pick.odds,
      status: pick.status,
    })),
    [
      {
        comboKey: 'angle:High:GOALS-O2.5',
        marketId: 'snap-ou25',
        marketType: 'Goals',
        odds: 1.9,
        status: 'Win',
      },
      {
        comboKey: 'cover:Solid:1X2-H',
        marketId: 'snap-1x2-h',
        marketType: '1X2',
        odds: 1.5,
        status: 'Win',
      },
    ]
  );
  assert.equal(response.matches[0].picks[0].label, 'Recommended Angle · High · Over 2.5 Goals');
  assert.equal(response.matches[0].picks[0].homeTeam, 'Home FC');
  assert.equal(response.matches[0].picks[0].awayTeam, 'Away FC');
  assert.equal(response.matches[0].score, '2–1');
  assert.equal(response.matches[0].status, 'Finished');
  assert.equal(response.source, 'archive');
  assert.deepEqual(response.availableDates, ['2026-11-22', '2026-11-21']);
  assert.deepEqual(response.combos.length, 2);
  assert.equal(response.generatedAt, '2026-11-23T04:00:00.000Z');
  assert.equal(response.caveats.length > 0, true);
});

test('two cards hitting the same combo collapse to one chip', () => {
  const fixture = makeFixture({
    id: 'duplicate',
    markets: [],
    modelAdvice: '',
    featuredPickSnapshots: [
      {
        capturedAt: '2026-11-22T10:00:00.000Z',
        strategy: 'balanced',
        angle: {
          marketId: 'dup-ou25',
          selectionKey: 'GOALS-O2.5',
          label: 'Over 2.5 Goals',
          marketType: 'Goals',
          odds: 1.9,
          fairProbability: 74,
        },
        cover: {
          marketId: 'dup-ou25',
          selectionKey: 'GOALS-O2.5',
          label: 'Over 2.5 Goals',
          marketType: 'Goals',
          odds: 1.9,
          fairProbability: 74,
        },
        note: null,
      },
    ],
  });

  const response = buildPositiveReadMatchesResponse({
    strategy: 'balanced',
    dateIso: '2026-11-22',
    source: 'live',
    fixtures: [fixture],
    combos: [combo('angle:High:GOALS-O2.5')],
    availableDates: [],
  });

  assert.equal(response.source, 'live');
  assert.equal(response.matches.length, 1);
  assert.deepEqual(
    response.matches[0].combos.map((item) => item.key),
    ['angle:High:GOALS-O2.5']
  );
  assert.equal(response.matches[0].score, '2–1');
});

test('upcoming fixtures stay in the feed with a null score and are kickoff-sorted', () => {
  const early = makeFixture({
    id: 'early',
    status: 'Scheduled',
    score: { home: null, away: null },
    kickoffTimestamp: Date.UTC(2026, 10, 22, 14),
    markets: [],
    featuredPickSnapshots: [
      {
        capturedAt: '2026-11-22T10:00:00.000Z',
        strategy: 'balanced',
        angle: {
          marketId: 'early-ou25',
          selectionKey: 'GOALS-O2.5',
          label: 'Over 2.5 Goals',
          marketType: 'Goals',
          odds: 1.9,
          fairProbability: 74,
        },
        cover: null,
        note: null,
      },
    ],
  });
  const late = snapshotFixture();

  const response = buildPositiveReadMatchesResponse({
    strategy: 'balanced',
    dateIso: '2026-11-22',
    source: 'live',
    fixtures: [late, early],
    combos: [combo('angle:High:GOALS-O2.5')],
    availableDates: [],
  });

  assert.deepEqual(
    response.matches.map((match) => match.fixtureId),
    ['early', 'snap']
  );
  assert.equal(response.matches[0].score, null);
  assert.equal(response.matches[0].status, 'Scheduled');
  assert.deepEqual(
    response.matches[0].picks.map((pick) => ({
      comboKey: pick.comboKey,
      marketId: pick.marketId,
      status: pick.status,
    })),
    [{ comboKey: 'angle:High:GOALS-O2.5', marketId: 'early-ou25', status: 'Pending' }]
  );
});
