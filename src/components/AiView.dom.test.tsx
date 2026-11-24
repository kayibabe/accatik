import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomTestEnv } from '../utils/domTestEnv.ts';

installDomTestEnv();

const { act, createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AiView } = await import('./AiView.tsx');

type Root = ReturnType<typeof createRoot>;

const originalFetch = globalThis.fetch;
let mounted: { container: HTMLElement; root: Root } | null = null;

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null,
    },
    json: async () => data,
  } as unknown as Response;
}

function makePick(fixtureId: string, aiScore: number) {
  return {
    fixtureId,
    homeTeam: `Home ${fixtureId}`,
    awayTeam: `Away ${fixtureId}`,
    competition: 'Test League',
    country: 'Testland',
    kickoffTime: '18:00 CAT',
    kickoffTimestamp: Date.UTC(2026, 10, 24, 16, 0),
    marketId: `${fixtureId}-1x2`,
    marketType: '1X2',
    selectionKey: 'home',
    label: 'Home win',
    odds: 2.1,
    bookmaker: 'Test book',
    pModel: 0.55,
    pStress: 0.51,
    pFair: 0.48,
    edge: 0.07,
    ev: 0.155,
    evStress: 0.071,
    aiScore,
    band: 'Solid',
    confidence: 0.7,
    disagreement: 0.04,
    stakePct: 0.01,
    frameworkStatus: 'Solid',
    frameworkConfidence: '0.7',
    calibration: null,
    signals: {
      framework: 0.55,
      poisson: 0.54,
      provider: null,
      bookFair: 0.48,
      historyRoi: null,
      historySample: 0,
      promoted: false,
    },
    reasons: ['Model edge survives the uncertainty haircut.'],
    risks: [],
  };
}

const briefing = {
  dateIso: '2026-11-24',
  displayDate: 'Tuesday, November 24, 2026',
  strategy: 'balanced',
  generatedAt: '2026-11-24T08:00:00.000Z',
  modelVersion: 'test',
  narrativeProvider: null,
  narrativeNote: '',
  avgClv: null,
  marketFilter: 'all',
  competitionFilter: 'all',
  summary: 'Three eligible picks before the model-score bar.',
  inputs: [],
  picks: [makePick('a', 79), makePick('b', 65), makePick('c', 55)],
  diagnostics: {
    fixturesScanned: 10,
    marketsScanned: 30,
    eligibleMarkets: 3,
    excludedStarted: 0,
    excludedNoModel: 0,
    excludedNegativeEv: 0,
    cacheNote: '',
  },
  disclaimer: 'Research estimates, not certainties.',
};

const ticket = {
  dateIso: '2026-11-24',
  generatedAt: '2026-11-24T08:01:00.000Z',
  riskMode: 'balanced',
  targetOdds: 2.5,
  maxLegs: 5,
  legs: [],
  totalOdds: 2.1,
  hitProbability: 0.55,
  breakEvenProbability: 0.476,
  evStress: 0.071,
  stakePct: 0.01,
  targetReached: false,
  reason: 'Test ticket.',
  risks: [],
  rejected: [],
  disclaimer: 'Research estimates, not certainties.',
};

async function renderAiView() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  await act(async () => {
    root.render(
      h(AiView, {
        selectedDate: '2026-11-24',
        displayDate: briefing.displayDate,
        strategy: 'balanced',
        minOdds: 2.5,
        maxLegs: 5,
        canApplyTicket: true,
        onGoToSlate: () => {},
        onApplyTicket: () => {},
      })
    );
  });
  return container;
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(
    (button) => button.textContent?.trim() === label
  ) as HTMLButtonElement[];
}

async function click(container: HTMLElement, label: string) {
  const button = buttons(container, label)[0];
  assert.ok(button, `expected a "${label}" button`);
  await act(async () => {
    button.click();
  });
}

async function setScoreBar(container: HTMLElement, value: number) {
  const slider = container.querySelector('input[type="range"]');
  assert.ok(slider, 'expected the model-score slider');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  await act(async () => {
    setter?.call(slider, String(value));
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    return jsonResponse(url.includes('/api/ai/accumulator') ? ticket : briefing) as Response;
  };
});

afterEach(async () => {
  if (mounted) {
    const { container, root } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
  globalThis.fetch = originalFetch;
});

test('the ranked-picks summary and add-to-slip buttons follow the score bar', async () => {
  const container = await renderAiView();
  const text = () => container.textContent ?? '';

  assert.match(text(), /2 selections clear the model-score bar of 60/);
  assert.equal(buttons(container, 'Add to slip').length, 2);
  assert.match(text(), /Picks above bar\s*2\s*of 3 eligible/);

  await setScoreBar(container, 70);
  assert.match(text(), /1 selections clear the model-score bar of 70/);
  assert.equal(buttons(container, 'Add to slip').length, 1);
  assert.match(text(), /Picks above bar\s*1\s*of 3 eligible/);

  await setScoreBar(container, 90);
  assert.match(text(), /No priced selection .* clears the model-score bar of 90/);
  assert.equal(buttons(container, 'Add to slip').length, 0);
  assert.equal(buttons(container, 'Lower threshold to 40').length, 1);
});

test('a ticket built at an older score bar is hidden after the bar moves', async () => {
  const container = await renderAiView();

  await click(container, 'Generate with AI');
  assert.equal(buttons(container, 'Regenerate').length, 1);

  await setScoreBar(container, 70);
  assert.equal(buttons(container, 'Regenerate').length, 0);
  assert.equal(buttons(container, 'Generate with AI').length, 1);
});
