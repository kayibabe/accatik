import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  PositiveReadCombo,
  PositiveReadMatch,
  PositiveReadMatchesResponse,
  PositiveReadPick,
} from '../types/analytics.ts';
import {
  DEFAULT_POSITIVE_READ_FILTERS,
  POSITIVE_READ_FILTER_STORAGE_KEY,
  activePositiveReadFilterCount,
  applyPositiveReadFilters,
  derivePositiveReadOptions,
  groupPositiveReadCombos,
  loadPositiveReadFilters,
  matchesPositiveReadCombo,
  parsePositiveReadFilters,
  positiveReadTier,
  reconcilePositiveReadFilters,
  savePositiveReadFilters,
} from './positiveReadFilters.ts';

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const asStorage = (storage: MemoryStorage) => storage as unknown as Storage;

function combo(
  key: string,
  section: PositiveReadCombo['section'],
  band: PositiveReadCombo['band'],
  marketKey: string,
  roi: number,
  smallSample = false,
  flags: Partial<
    Pick<
      PositiveReadCombo,
      | 'qualified'
      | 'confirmed'
      | 'stable'
      | 'positiveDates'
      | 'totalDates'
      | 'roiCiLow'
      | 'roiCiHigh'
    >
  > = {}
): PositiveReadCombo {
  const roiCiLow = flags.roiCiLow ?? roi - 5;
  const qualified = flags.qualified ?? (!smallSample && roiCiLow > 0);
  return {
    key,
    section,
    sectionLabel:
      section === 'note'
        ? 'Analyst Note'
        : section === 'angle'
          ? 'Recommended Angle'
          : 'Safer Cover',
    band,
    marketKey,
    marketLabel: marketKey === 'GOALS-O2.5' ? 'Over 2.5 Goals' : marketKey,
    label: `${section} · ${band} · ${marketKey}`,
    roi,
    staked: 20,
    smallSample,
    roiCiLow,
    roiCiHigh: flags.roiCiHigh ?? roi + 5,
    positiveDates: flags.positiveDates ?? 3,
    totalDates: flags.totalDates ?? 4,
    qualified,
    confirmed: flags.confirmed ?? false,
    stable: flags.stable ?? qualified,
  };
}

const combos: PositiveReadCombo[] = [
  combo('note:High:GOALS-O2.5', 'note', 'High', 'GOALS-O2.5', 12),
  combo('angle:High:GOALS-O2.5', 'angle', 'High', 'GOALS-O2.5', 5, true),
  combo('cover:Solid:1X2-H', 'cover', 'Solid', '1X2-H', 20),
  combo('note:Solid:BTTS-YES', 'note', 'Solid', 'BTTS-YES', 30, true),
  combo('note:High:1X2-H', 'note', 'High', '1X2-H', 2),
];

function pick(
  comboKey: string,
  status: PositiveReadPick['status']
): PositiveReadPick {
  return {
    comboKey,
    label: comboKey,
    fixtureId: comboKey.startsWith('note') ? 'm1' : 'm2',
    homeTeam: 'Home',
    awayTeam: 'Away',
    competition: 'League',
    matchDate: '2026-11-23',
    kickoffTime: '16:00',
    marketId: `market-${comboKey}`,
    marketLabel: comboKey,
    marketType: 'Goals',
    odds: 1.8,
    impliedProbability: 55,
    fairProbability: 60,
    rationale: 'Study pick',
    band: 'High',
    studyBand: 'High',
    bandDrift: false,
    status,
  };
}

function match(
  id: string,
  competition: string,
  matchCombos: PositiveReadCombo[],
  matchPicks: PositiveReadPick[]
): PositiveReadMatch {
  return {
    fixtureId: id,
    homeTeam: `Home ${id}`,
    awayTeam: `Away ${id}`,
    competition,
    country: id === 'm2' ? 'Zambia' : 'Malawi',
    kickoffTime: '16:00',
    kickoffTimestamp: 1,
    status: 'Scheduled',
    score: null,
    combos: matchCombos,
    picks: matchPicks,
  };
}

const matches: PositiveReadMatch[] = [
  match('m1', 'League A', [combos[0], combos[2]], [
    pick('note:High:GOALS-O2.5', 'Pending'),
    pick('cover:Solid:1X2-H', 'Win'),
  ]),
  match('m2', 'League B', [combos[1], combos[3]], [
    pick('angle:High:GOALS-O2.5', 'Pending'),
    pick('note:Solid:BTTS-YES', 'Live'),
  ]),
];

const data: PositiveReadMatchesResponse = {
  strategy: 'balanced',
  dateIso: '2026-11-23',
  source: 'archive',
  generatedAt: '2026-11-23T04:00:00.000Z',
  studyGeneratedAt: '2026-11-23T04:00:00.000Z',
  studyExcludedDateIso: '2026-11-23',
  minSample: 20,
  universe: {
    sections: ['angle', 'cover', 'note'],
    bands: ['High', 'Solid', 'Moderate', 'Speculative'],
    markets: [],
    marketLabels: {},
  },
  qualifiedCount: combos.filter((item) => item.qualified).length,
  confirmedCount: combos.filter((item) => item.confirmed).length,
  availableDates: [],
  combos,
  matches,
  caveats: [],
};

test('parsePositiveReadFilters rejects junk and keeps only valid values', () => {
  assert.deepEqual(parsePositiveReadFilters(null), DEFAULT_POSITIVE_READ_FILTERS);
  assert.deepEqual(parsePositiveReadFilters('filters'), DEFAULT_POSITIVE_READ_FILTERS);

  const parsed = parsePositiveReadFilters({
    section: 'angle',
    band: 'High',
    marketKey: 'GOALS-O2.5',
    smallSample: 'only',
    quality: 'confirmed',
    minRoi: 12.34,
    query: '  River  ',
  });
  assert.deepEqual(parsed, {
    section: 'angle',
    band: 'High',
    marketKey: 'GOALS-O2.5',
    smallSample: 'only',
    quality: 'confirmed',
    minRoi: 12.3,
    query: 'River',
  });

  const invalid = parsePositiveReadFilters({
    section: 'unknown',
    band: 'Everything',
    marketKey: 42,
    smallSample: 'sometimes',
    quality: 'probably',
    minRoi: -5,
    query: 'x'.repeat(121),
  });
  assert.deepEqual(invalid, DEFAULT_POSITIVE_READ_FILTERS);

  assert.deepEqual(
    parsePositiveReadFilters({ ...DEFAULT_POSITIVE_READ_FILTERS, band: 'All' }).band,
    'All'
  );
});

test('filter state round-trips through storage and degrades safely', () => {
  const storage = new MemoryStorage();
  const state = { ...DEFAULT_POSITIVE_READ_FILTERS, band: 'Solid' as const, minRoi: 10 };
  savePositiveReadFilters(state, asStorage(storage));
  assert.equal(storage.getItem(POSITIVE_READ_FILTER_STORAGE_KEY) !== null, true);
  assert.deepEqual(loadPositiveReadFilters(asStorage(storage)), {
    ...state,
  });

  storage.setItem(POSITIVE_READ_FILTER_STORAGE_KEY, '{bad json');
  assert.deepEqual(loadPositiveReadFilters(asStorage(storage)), DEFAULT_POSITIVE_READ_FILTERS);
  assert.deepEqual(loadPositiveReadFilters(null), DEFAULT_POSITIVE_READ_FILTERS);

  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  } as unknown as Storage;
  assert.deepEqual(loadPositiveReadFilters(throwing), DEFAULT_POSITIVE_READ_FILTERS);
  assert.doesNotThrow(() => savePositiveReadFilters(state, throwing));
});

test('matchesPositiveReadCombo applies each dimension independently', () => {
  const noteHigh = combos[0];
  const smallSample = combos[1];

  assert.equal(matchesPositiveReadCombo(noteHigh, DEFAULT_POSITIVE_READ_FILTERS), true);
  assert.equal(
    matchesPositiveReadCombo(noteHigh, { ...DEFAULT_POSITIVE_READ_FILTERS, section: 'cover' }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(noteHigh, { ...DEFAULT_POSITIVE_READ_FILTERS, band: 'Solid' }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(noteHigh, { ...DEFAULT_POSITIVE_READ_FILTERS, marketKey: '1X2-H' }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(noteHigh, { ...DEFAULT_POSITIVE_READ_FILTERS, smallSample: 'only' }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(smallSample, {
      ...DEFAULT_POSITIVE_READ_FILTERS,
      smallSample: 'exclude',
    }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(noteHigh, { ...DEFAULT_POSITIVE_READ_FILTERS, minRoi: 15 }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(noteHigh, { ...DEFAULT_POSITIVE_READ_FILTERS, minRoi: 15 }, 'roi'),
    true
  );
});

test('quality gate narrows to qualified or confirmed evidence', () => {
  const confirmed = combo(
    'note:High:BTTS-YES',
    'note',
    'High',
    'BTTS-YES',
    25,
    false,
    { confirmed: true }
  );

  assert.equal(
    matchesPositiveReadCombo(combos[0], { ...DEFAULT_POSITIVE_READ_FILTERS, quality: 'qualified' }),
    true
  );
  assert.equal(
    matchesPositiveReadCombo(combos[0], { ...DEFAULT_POSITIVE_READ_FILTERS, quality: 'confirmed' }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(confirmed, {
      ...DEFAULT_POSITIVE_READ_FILTERS,
      quality: 'confirmed',
    }),
    true
  );
  assert.equal(
    matchesPositiveReadCombo(combos[1], { ...DEFAULT_POSITIVE_READ_FILTERS, quality: 'qualified' }),
    false
  );
  assert.equal(
    matchesPositiveReadCombo(
      combos[0],
      { ...DEFAULT_POSITIVE_READ_FILTERS, quality: 'confirmed' },
      'quality'
    ),
    true
  );

  const withConfirmed: PositiveReadMatchesResponse = {
    ...data,
    combos: [...combos, confirmed],
    matches: [],
  };
  assert.deepEqual(
    applyPositiveReadFilters(withConfirmed, {
      ...DEFAULT_POSITIVE_READ_FILTERS,
      quality: 'confirmed',
    }).combos.map((item) => item.key),
    ['note:High:BTTS-YES']
  );
  assert.deepEqual(
    applyPositiveReadFilters(withConfirmed, {
      ...DEFAULT_POSITIVE_READ_FILTERS,
      quality: 'qualified',
    }).combos.map((item) => item.key),
    ['note:High:GOALS-O2.5', 'cover:Solid:1X2-H', 'note:High:BTTS-YES']
  );

  assert.deepEqual(
    derivePositiveReadOptions([...combos, confirmed], DEFAULT_POSITIVE_READ_FILTERS).quality.map(
      (item) => [item.id, item.count]
    ),
    [
      ['all', 6],
      ['qualified', 3],
      ['confirmed', 1],
    ]
  );

  assert.equal(positiveReadTier(confirmed), 'confirmed');
  assert.equal(positiveReadTier(combos[0]), 'qualified');
  assert.equal(positiveReadTier(combos[4]), 'observed');
  assert.equal(positiveReadTier(combos[1]), 'small-sample');
});

test('reconcile ignores the quality gate when validating dimensions', () => {
  const state = {
    ...DEFAULT_POSITIVE_READ_FILTERS,
    section: 'note' as const,
    band: 'High' as const,
    marketKey: 'GOALS-O2.5',
    quality: 'confirmed' as const,
  };
  // No combo is confirmed in `combos`, but the dimension itself is valid. The
  // quality gate is the user's to loosen, so reconcile must keep the selection.
  assert.deepEqual(reconcilePositiveReadFilters(state, combos), state);
});

test('derivePositiveReadOptions counts each dimension without its own filter', () => {
  const options = derivePositiveReadOptions(combos, {
    ...DEFAULT_POSITIVE_READ_FILTERS,
    section: 'note',
  });

  assert.deepEqual(
    options.sections.map((item) => [item.id, item.count]),
    [
      ['all', 5],
      ['note', 3],
      ['angle', 1],
      ['cover', 1],
    ]
  );
  assert.deepEqual(
    options.bands.map((item) => [item.id, item.count]),
    [
      ['all', 3],
      ['High', 2],
      ['Solid', 1],
    ]
  );
  assert.deepEqual(
    options.markets.map((item) => [item.id, item.count]),
    [
      ['all', 3],
      ['1X2-H', 1],
      ['BTTS-YES', 1],
      ['GOALS-O2.5', 1],
    ]
  );
});

test('applyPositiveReadFilters narrows combos, matches and addable picks together', () => {
  const result = applyPositiveReadFilters(data, {
    ...DEFAULT_POSITIVE_READ_FILTERS,
    section: 'note',
    band: 'High',
    marketKey: 'GOALS-O2.5',
  });

  assert.deepEqual(result.combos.map((item) => item.key), ['note:High:GOALS-O2.5']);
  assert.deepEqual(result.matches.map((item) => item.fixtureId), ['m1']);
  assert.deepEqual(result.matches[0].combos.map((item) => item.key), ['note:High:GOALS-O2.5']);
  assert.deepEqual(result.matches[0].picks.map((item) => item.comboKey), [
    'note:High:GOALS-O2.5',
  ]);
  assert.deepEqual(
    result.eligiblePicks.map((item) => item.comboKey),
    ['note:High:GOALS-O2.5']
  );
});

test('team and competition search narrows matches but not study parameters', () => {
  const result = applyPositiveReadFilters(data, {
    ...DEFAULT_POSITIVE_READ_FILTERS,
    query: 'ZAMBIA',
  });

  assert.equal(result.combos.length, combos.length);
  assert.deepEqual(result.matches.map((item) => item.fixtureId), ['m2']);
  assert.deepEqual(
    result.eligiblePicks.map((item) => item.comboKey),
    ['angle:High:GOALS-O2.5']
  );
});

test('sample mode and minimum ROI can be combined', () => {
  const hidden = applyPositiveReadFilters(data, {
    ...DEFAULT_POSITIVE_READ_FILTERS,
    smallSample: 'exclude',
    minRoi: 15,
  });
  assert.deepEqual(hidden.combos.map((item) => item.key), ['cover:Solid:1X2-H']);

  const onlySmall = applyPositiveReadFilters(data, {
    ...DEFAULT_POSITIVE_READ_FILTERS,
    smallSample: 'only',
  });
  assert.deepEqual(onlySmall.combos.map((item) => item.key), [
    'angle:High:GOALS-O2.5',
    'note:Solid:BTTS-YES',
  ]);
});

test('reconcile drops saved dimensions no longer present in the feed', () => {
  const reconciled = reconcilePositiveReadFilters(
    {
      ...DEFAULT_POSITIVE_READ_FILTERS,
      section: 'cover',
      band: 'High',
      marketKey: 'GOALS-O2.5',
    },
    combos
  );

  assert.deepEqual(reconciled, {
    ...DEFAULT_POSITIVE_READ_FILTERS,
    band: 'High',
  });
});

test('groupPositiveReadCombos groups by scope as requested', () => {
  const allBandsCover = combo('cover:All:DC-12', 'cover', 'All', 'DC-12', 30);
  const allBandsNote = combo('note:All:GOALS-O2.5', 'note', 'All', 'GOALS-O2.5', 6.9);
  const groups = groupPositiveReadCombos([
    allBandsCover,
    combos[0],
    combos[4],
    allBandsNote,
  ]);
  assert.deepEqual(
    groups.map((group) => [group.sectionLabel, group.combos.length]),
    [
      ['Alternative cover', 1],
      ['Section × band × market', 2],
      ['Section × market · all bands combined', 1],
    ]
  );
  assert.equal(activePositiveReadFilterCount(DEFAULT_POSITIVE_READ_FILTERS), 0);
  assert.equal(
    activePositiveReadFilterCount({
      ...DEFAULT_POSITIVE_READ_FILTERS,
      band: 'High',
      minRoi: 10,
    }),
    2
  );
});
