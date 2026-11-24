import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POSITIVE_READ_ROI_LABEL,
  POSITIVE_READ_TITLE,
  positiveReadCaveats,
  positiveReadEyebrow,
  positiveReadIntroduction,
  positiveReadModeNote,
} from './positiveReadCopy.ts';

test('both qualifying-read surfaces share one definition and threshold', () => {
  assert.equal(POSITIVE_READ_TITLE, 'Qualifying reads');
  assert.equal(POSITIVE_READ_ROI_LABEL, '5.0%');

  const intro = positiveReadIntroduction('25 Nov');
  assert.match(intro, /Fixtures on 25 Nov/);
  assert.match(intro, /section × band × market combination/);
  assert.match(intro, new RegExp(`ROI of ${POSITIVE_READ_ROI_LABEL} or more`));
  assert.match(intro, /qualifying parameter/);
});

test('only the slip workflow adds the pending-pick rule', () => {
  const shared = {
    strategy: 'balanced',
    source: 'archive' as const,
  };

  assert.equal(
    positiveReadEyebrow({ ...shared, mode: 'analytics' }),
    'Daily feed · balanced strategy · archived matchday'
  );
  assert.equal(
    positiveReadEyebrow({ ...shared, mode: 'build' }),
    'Daily feed · balanced strategy · archived matchday · pending picks are kept'
  );
  assert.match(positiveReadModeNote('build'), /Add all pending picks/);
  assert.match(positiveReadModeNote('build'), /every pending pick is kept/i);
  assert.match(positiveReadModeNote('analytics'), /Research tab/);
});

test('caveats describe parameters, badges and pending picks consistently', () => {
  const caveats = positiveReadCaveats();

  assert.match(caveats[0], /A qualifying read is a section × band × market parameter/);
  assert.match(caveats[1], /Qualified parameters.*Confirmed parameters/);
  assert.match(caveats[2], /qualified parameter/);
  assert.match(caveats[3], /Parameters below the study’s minimum sample/);
  assert.match(caveats[6], /fixture made by section and market/);
  assert.match(caveats[7], /Adding a pending pick/);
});
