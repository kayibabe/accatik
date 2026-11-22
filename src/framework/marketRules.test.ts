import test from 'node:test';
import assert from 'node:assert/strict';
import type { FrameworkModelInput } from './model.ts';
import type { QualificationCandidate } from './qualification.ts';
import { qualifyCandidate } from './qualification.ts';
import { evaluateValue } from './value.ts';
import {
  failedToScoreRisk,
  lowScoringWarning,
  marketScreeningFlags,
  teamGoalsContext,
} from './marketRules.ts';

function model(overrides: Partial<FrameworkModelInput> = {}): FrameworkModelInput {
  return {
    lambdaHome: 1.5,
    lambdaAway: 1.1,
    rho: 0,
    attackHome: 1.1,
    attackAway: 0.9,
    defenceHome: 1,
    defenceAway: 1,
    formHome: 60,
    formAway: 50,
    failedToScoreHome: 0.1,
    failedToScoreAway: 0.15,
    sampleHome: 10,
    sampleAway: 10,
    leagueMatches: 40,
    leagueUsedFallback: false,
    modelVersion: 'test',
    confidence: 'Medium',
    dataOk: true,
    providerAudited: false,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<QualificationCandidate> = {}
): QualificationCandidate {
  return {
    market: 'GOALS-O2.5',
    dataOk: true,
    flags: [],
    value: evaluateValue({ pModel: 0.7, pFair: 0.5, odds: 2 }),
    oddsAgeOk: true,
    marketComplete: true,
    usesProviderProb: false,
    providerAudited: false,
    criticalFlags: [],
    confidenceOk: true,
    confidence: 'Medium',
    ...overrides,
  };
}

test('low-scoring warning comes from the model expected total', () => {
  assert.equal(lowScoringWarning(model()), false);
  assert.equal(lowScoringWarning(model({ lambdaHome: 1, lambdaAway: 1 })), true);
  assert.equal(
    lowScoringWarning(model(), { lowScoringTotalThreshold: 3 }),
    true
  );
});

test('failed-to-score risk fires on either team', () => {
  assert.equal(failedToScoreRisk(model()), false);
  assert.equal(failedToScoreRisk(model({ failedToScoreAway: 0.45 })), true);
});

test('market screening flags are independent of provider indices', () => {
  assert.deepEqual(
    marketScreeningFlags(model({ lambdaHome: 1, failedToScoreHome: 0.5 })),
    ['LOW_SCORING_WARNING', 'FAILED_TO_SCORE_RISK']
  );
});

test('team-goal context records the missing lineup input', () => {
  const context = teamGoalsContext('TEAM-H-O1.5', model());
  assert.ok(context);
  assert.equal(context.side, 'home');
  assert.equal(context.line, 1.5);
  assert.equal(context.expectedGoals, 1.5);
  assert.equal(context.opponentConcession, 1);
  assert.equal(context.venueForm, 60);
  assert.equal(context.attackIndex, null);
  assert.deepEqual(context.missing, ['COMPARATIVE_INDICES', 'LINEUP_AVAILABILITY']);
  assert.equal(teamGoalsContext('GOALS-O2.5', model()), null);
});

test('provider indices fill the team-goal context', () => {
  const context = teamGoalsContext('TEAM-A-U0.5', model({
    providerIndices: {
      attackHome: 0.45,
      attackAway: 0.55,
      defenceHome: 0.5,
      defenceAway: 0.5,
    },
  }));
  assert.ok(context);
  assert.equal(context.side, 'away');
  assert.equal(context.attackIndex, 0.55);
  assert.equal(context.defenceIndex, 0.5);
  assert.deepEqual(context.missing, ['LINEUP_AVAILABILITY']);
});

test('a low-scoring screen holds the higher Over lines, not the Unders', () => {
  assert.deepEqual(
    qualifyCandidate(candidate({ flags: ['LOW_SCORING_WARNING'] })),
    { status: 'CONDITIONAL_REVIEW', reasonCodes: ['SUITABILITY_REVIEW'] }
  );
  assert.deepEqual(
    qualifyCandidate(candidate({
      market: 'GOALS-U2.5',
      flags: ['LOW_SCORING_WARNING'],
    })),
    { status: 'QUALIFIED', reasonCodes: [] }
  );
});

test('failed-to-score risk holds BTTS Yes but not BTTS No', () => {
  assert.deepEqual(
    qualifyCandidate(candidate({
      market: 'BTTS-YES',
      flags: ['FAILED_TO_SCORE_RISK'],
    })),
    { status: 'CONDITIONAL_REVIEW', reasonCodes: ['SUITABILITY_REVIEW'] }
  );
  assert.deepEqual(
    qualifyCandidate(candidate({
      market: 'BTTS-NO',
      flags: ['FAILED_TO_SCORE_RISK'],
    })),
    { status: 'QUALIFIED', reasonCodes: [] }
  );
});

test('team-goal markets stay in review without lineup data', () => {
  const context = teamGoalsContext('TEAM-H-O1.5', model());
  assert.deepEqual(
    qualifyCandidate(candidate({ market: 'TEAM-H-O1.5', marketContext: context })),
    { status: 'CONDITIONAL_REVIEW', reasonCodes: ['UNRESOLVED_RISK_FLAG'] }
  );
});

test('insufficient confidence rejects before a review hold is considered', () => {
  assert.deepEqual(
    qualifyCandidate(candidate({
      flags: ['LOW_SCORING_WARNING'],
      confidenceOk: false,
    })),
    { status: 'REJECTED', reasonCodes: ['INSUFFICIENT_CONFIDENCE'] }
  );
});
