import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketFrameworkAssessment } from '../framework/assessment.ts';
import type { ConfidenceClass, FrameworkStatus } from '../framework/config.ts';
import type { Fixture, MarketOption } from '../types/fixtures.ts';
import {
  buildPickSelection,
  evaluatePickCandidate,
  GRADE_PLAN,
} from './pickSelection.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

interface QualifiedOptions {
  fair: number;
  model: number;
  odds: number;
  status?: FrameworkStatus;
  confidence?: ConfidenceClass;
  downgrades?: string[];
  marketComplete?: boolean;
}

function qualifiedMarket(
  id: string,
  {
    fair,
    model,
    odds,
    status = 'QUALIFIED',
    confidence = 'Medium',
    downgrades = [],
    marketComplete = true,
  }: QualifiedOptions
): MarketOption {
  const edge = model - fair;
  const ev = model * odds - 1;
  const pStress = model - 0.25 * edge;
  const framework: MarketFrameworkAssessment = {
    marketId: id,
    selectionKey: '1X2-H',
    status,
    reasonCodes: status === 'QUALIFIED' ? [] : ['SUITABILITY_REVIEW'],
    pModel: model,
    pFair: fair,
    edge,
    relativeEdge: model / fair - 1,
    ev,
    evStress: pStress * odds - 1,
    pStress,
    fairOdds: 1 / model,
    confidence,
    confidenceDowngrades: downgrades,
    flags: [],
    marketContext: null,
    oddsAgeSeconds: 120,
    marketComplete,
    benchmarkBook: 'Bet365',
    executionBook: 'Bet365',
    value: null,
  };
  return {
    ...makeMarket(id, odds, '1X2', `${id} pick`),
    fairProbability: Math.round(fair * 1000) / 10,
    framework,
  };
}

function fixtureWithMarket(
  id: string,
  market: MarketOption,
  overrides: Partial<Fixture> = {}
): Fixture {
  return makeFixture({
    id,
    status: 'Scheduled',
    awaitingResult: false,
    markets: [market],
    ...overrides,
  });
}

test('grade bands map to the placement roles from the guide', () => {
  assert.equal(GRADE_PLAN.High.band, '≥ 70% fair chance');
  assert.equal(GRADE_PLAN.High.role, 'Anchor leg');
  assert.equal(GRADE_PLAN.Solid.role, 'Core leg');
  assert.equal(GRADE_PLAN.Moderate.role, 'Middle leg');
  assert.equal(GRADE_PLAN.Speculative.role, 'Do not use');
});

test('a qualified angle with a complete book passes every hard filter', () => {
  const fixture = fixtureWithMarket(
    'f1',
    qualifiedMarket('f1-h', { fair: 0.75, model: 0.8, odds: 1.6 })
  );
  const candidate = evaluatePickCandidate(fixture, 'probability');

  assert.ok(candidate);
  assert.equal(candidate.grade, 'High');
  assert.equal(candidate.role, 'Anchor leg');
  assert.equal(candidate.eligible, true);
  assert.deepEqual(candidate.rejectionReasons, []);
  assert.equal(candidate.checks.every((check) => check.passed), true);
});

test('each hard filter independently keeps a leg out of the slip', () => {
  const base = { fair: 0.7, model: 0.76, odds: 1.6 };
  const cases: Array<{
    id: string;
    options: QualifiedOptions;
    failed: string;
  }> = [
    {
      id: 'status',
      options: { ...base, status: 'CONDITIONAL_REVIEW' },
      failed: 'Framework status is QUALIFIED',
    },
    {
      id: 'edge',
      options: { ...base, model: 0.72 },
      failed: 'Edge ≥ 5pp, EV > 0 and stressed EV > 0',
    },
    {
      id: 'confidence',
      options: { ...base, downgrades: ['ODDS_FRESHNESS'] },
      failed: 'Confidence ≥ Low, no stale-odds or thin-sample downgrade',
    },
    {
      id: 'market',
      options: { ...base, marketComplete: false },
      failed: 'Fair probability from a complete book, not a one-sided approximation',
    },
  ];

  for (const entry of cases) {
    const candidate = evaluatePickCandidate(
      fixtureWithMarket(entry.id, qualifiedMarket(`${entry.id}-h`, entry.options)),
      'probability'
    );
    assert.ok(candidate, entry.id);
    assert.equal(candidate.eligible, false, entry.id);
    assert.ok(candidate.rejectionReasons.includes(entry.failed), entry.id);
  }

  const finished = evaluatePickCandidate(
    fixtureWithMarket(
      'live',
      qualifiedMarket('live-h', base),
      { status: 'Finished' }
    ),
    'probability'
  );
  assert.equal(finished?.eligible, false);
  assert.ok(
    finished?.rejectionReasons.includes('Price is still pre-match')
  );
});

test('shortlist ranks by grade, enforces diversity and defers middle legs', () => {
  const fixtures = [
    fixtureWithMarket(
      'anchor',
      qualifiedMarket('anchor-h', { fair: 0.75, model: 0.82, odds: 1.6 }),
      { competition: 'Premier League', homeTeam: 'Anchor FC', awayTeam: 'Other FC' }
    ),
    fixtureWithMarket(
      'core',
      qualifiedMarket('core-h', { fair: 0.6, model: 0.68, odds: 2.0 }),
      { competition: 'La Liga', homeTeam: 'Core FC', awayTeam: 'Second FC' }
    ),
    fixtureWithMarket(
      'middle',
      qualifiedMarket('middle-h', { fair: 0.45, model: 0.51, odds: 2.6 }),
      { competition: 'Serie A', homeTeam: 'Middle FC', awayTeam: 'Third FC' }
    ),
    fixtureWithMarket(
      'same-league',
      qualifiedMarket('same-league-h', { fair: 0.78, model: 0.84, odds: 1.5 }),
      { competition: 'Premier League', homeTeam: 'Fourth FC', awayTeam: 'Fifth FC' }
    ),
    fixtureWithMarket(
      'same-team',
      qualifiedMarket('same-team-h', { fair: 0.61, model: 0.67, odds: 2.0 }),
      { competition: 'Bundesliga', homeTeam: 'Core FC', awayTeam: 'Sixth FC' }
    ),
  ];

  const selection = buildPickSelection(fixtures, 'probability');
  assert.deepEqual(
    selection.shortlist.map((candidate) => candidate.fixtureId),
    ['anchor', 'core', 'middle']
  );
  assert.deepEqual(
    selection.shortlist.map((candidate) => candidate.selectedSlot),
    [1, 2, 3]
  );
  assert.equal(selection.legs.length, 3);
  assert.ok(
    selection.held.some(
      (entry) =>
        entry.fixtureId === 'same-league' &&
        entry.reason === 'Competition already used'
    )
  );
  assert.ok(
    selection.held.some(
      (entry) =>
        entry.fixtureId === 'same-team' && entry.reason === 'Team already used'
    )
  );
});

test('a lone Moderate leg is never shortlisted', () => {
  const selection = buildPickSelection(
    [
      fixtureWithMarket(
        'middle-only',
        qualifiedMarket('middle-only-h', { fair: 0.45, model: 0.51, odds: 2.6 })
      ),
    ],
    'probability'
  );

  assert.equal(selection.eligible.length, 1);
  assert.equal(selection.shortlist.length, 0);
  assert.equal(selection.legs.length, 0);
});

test('the guard reports negative edgePts even when every leg passed value gates', () => {
  const selection = buildPickSelection(
    [
      fixtureWithMarket(
        'g1',
        qualifiedMarket('g1-h', { fair: 0.7, model: 0.8, odds: 1.35 }),
        { competition: 'League A', homeTeam: 'Alpha FC', awayTeam: 'Beta FC' }
      ),
      fixtureWithMarket(
        'g2',
        qualifiedMarket('g2-h', { fair: 0.7, model: 0.8, odds: 1.35 }),
        { competition: 'League B', homeTeam: 'Gamma FC', awayTeam: 'Delta FC' }
      ),
    ],
    'probability'
  );

  assert.equal(selection.legs.length, 2);
  assert.equal(selection.guard.economics.basis, 'fair');
  assert.ok(selection.guard.economics.edgePts < 0);
  assert.equal(selection.guard.recommended, false);
  assert.match(selection.guard.reason, /negative-EV/);
});
