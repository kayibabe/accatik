import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomTestEnv } from '../utils/domTestEnv.ts';

installDomTestEnv();

const { act, createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { groupRowsByDate } = await import('../utils/dateGroups.ts');
const { DateGroups } = await import('./ui/DateGroups.tsx');

interface Row {
  dateIso: string;
}

const TODAY = '2026-11-25';
const YESTERDAY = '2026-11-24';
const groups = groupRowsByDate<Row>(
  [{ dateIso: TODAY }, { dateIso: YESTERDAY }],
  (row) => row.dateIso
);

type Root = ReturnType<typeof createRoot>;
let mounted: { container: HTMLElement; root: Root } | null = null;

async function render(focusDate: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  await rerender(focusDate);
  return container;
}

async function rerender(focusDate: string) {
  assert.ok(mounted, 'accordion must be mounted before it can be re-rendered');
  await act(async () => {
    mounted!.root.render(
      h(DateGroups<Row>, {
        groups,
        todayDate: TODAY,
        focusDate,
        idPrefix: 'focus-test',
        renderDay: (rows: Row[]) => h('div', { className: 'rows' }, rows.length),
      })
    );
  });
}

function buttonFor(container: HTMLElement, panelId: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-controls="${panelId}"]`);
  assert.ok(button, `expected a toggle for ${panelId}`);
  return button as HTMLButtonElement;
}

afterEach(async () => {
  if (mounted) {
    const { container, root } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
});

test('the selected past date opens its group but keeps relative labels', async () => {
  const container = await render(YESTERDAY);

  assert.equal(
    buttonFor(container, 'focus-test-year-2026').getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    buttonFor(container, 'focus-test-month-2026-11').getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    buttonFor(container, `focus-test-day-${YESTERDAY}`).getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    buttonFor(container, `focus-test-day-${TODAY}`).getAttribute('aria-expanded'),
    'false'
  );
  assert.ok(container.querySelector(`#focus-test-day-${YESTERDAY}`));
  assert.equal(container.querySelector(`#focus-test-day-${TODAY}`), null);
  assert.match(
    buttonFor(container, `focus-test-day-${YESTERDAY}`).textContent ?? '',
    /Yesterday · Tuesday, 24 November 2026/
  );
  assert.match(
    buttonFor(container, `focus-test-day-${TODAY}`).textContent ?? '',
    /Today · Wednesday, 25 November 2026/
  );
});

test('changing the selection moves the open group to that date', async () => {
  const container = await render(YESTERDAY);

  await rerender(TODAY);

  assert.equal(
    buttonFor(container, `focus-test-day-${TODAY}`).getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    buttonFor(container, `focus-test-day-${YESTERDAY}`).getAttribute('aria-expanded'),
    'false'
  );
});

test('an empty selection falls back to the newest group', async () => {
  const container = await render('2026-11-20');

  assert.equal(
    buttonFor(container, `focus-test-day-${TODAY}`).getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    buttonFor(container, `focus-test-day-${YESTERDAY}`).getAttribute('aria-expanded'),
    'false'
  );
});
