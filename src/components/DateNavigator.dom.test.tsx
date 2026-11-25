import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomTestEnv } from '../utils/domTestEnv.ts';

installDomTestEnv();

const { act, createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DateNavigator } = await import('./DateNavigator.tsx');

type Root = ReturnType<typeof createRoot>;
let mounted: { container: HTMLElement; root: Root } | null = null;
let changes: string[] = [];

async function renderNavigator(selectedDate = '2026-11-18', todayDate = '2026-11-18') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  await rerender(selectedDate, todayDate);
  return container;
}

async function rerender(selectedDate: string, todayDate = '2026-11-18') {
  assert.ok(mounted, 'navigator must be mounted before it can be re-rendered');
  changes = [];
  await act(async () => {
    mounted!.root.render(
      h(DateNavigator, {
        selectedDate,
        todayDate,
        onChangeDate: (dateIso: string) => changes.push(dateIso),
      })
    );
  });
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label ||
      candidate.textContent === label
  );
  assert.ok(button, `expected a button labelled "${label}"`);
  return button as HTMLButtonElement;
}

function stripTiles(container: HTMLElement): HTMLButtonElement[] {
  const group = container.querySelector('[role="group"][aria-label="Choose match date"]');
  assert.ok(group, 'expected the matchday strip group');
  return [...group.querySelectorAll('button')] as HTMLButtonElement[];
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
}

async function setNativeDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

afterEach(async () => {
  if (mounted) {
    const { container, root } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
});

test('the strip shows five CAT-labelled days around the selection', async () => {
  const container = await renderNavigator('2026-11-18', '2026-11-18');
  const tiles = stripTiles(container);

  assert.equal(tiles.length, 5);
  assert.deepEqual(
    tiles.map((tile) => tile.textContent),
    ['MON\n16', 'TUE\n17', 'TODAY\n18', 'THU\n19', 'FRI\n20']
  );
  assert.equal(
    tiles[2].getAttribute('aria-label'),
    'TODAY\n18 · Today · Wednesday, 18 November 2026'
  );
  assert.equal(tiles[2].getAttribute('aria-pressed'), 'true');
  assert.equal(tiles[0].getAttribute('aria-pressed'), 'false');
  assert.equal(tiles[2].getAttribute('aria-current'), 'date');
  assert.equal(
    [...container.querySelectorAll('button')].some((button) => button.textContent === 'Today'),
    false,
    'the Today reset should be hidden on the current matchday'
  );
});

test('the selection ring stays clear of the stacked weekday label', async () => {
  const container = await renderNavigator();
  const tiles = stripTiles(container);

  assert.ok(
    tiles.every((tile) => tile.classList.contains('py-1.5')),
    'every tile needs vertical padding so its edge never clips the weekday text'
  );

  const selected = tiles.find(
    (tile) => tile.getAttribute('aria-pressed') === 'true'
  );
  assert.ok(selected);
  assert.ok(
    selected.classList.contains('ring-inset'),
    'the selected tile should use an inset ring'
  );
  assert.equal(selected.classList.contains('border-emerald-700'), false);
});

test('arrows shift the selection and wrap across a month boundary', async () => {
  const container = await renderNavigator('2026-12-01', '2026-11-18');

  await click(buttonByLabel(container, 'Previous day'));
  assert.deepEqual(changes, ['2026-11-30']);

  await click(buttonByLabel(container, 'Next day'));
  assert.deepEqual(changes, ['2026-11-30', '2026-12-02']);
});

test('a tile selects its date and the Today reset returns off-today views', async () => {
  const container = await renderNavigator('2026-11-16', '2026-11-18');
  const tiles = stripTiles(container);

  await click(tiles[4]);
  assert.deepEqual(changes, ['2026-11-18']);

  await rerender('2026-11-14');
  assert.equal(stripTiles(container).length, 5);
  await click(buttonByLabel(container, 'Today'));
  assert.deepEqual(changes, ['2026-11-18']);
});

test('the native date input stays labelled and rejects an empty value', async () => {
  const container = await renderNavigator('2026-11-18', '2026-11-18');
  const input = container.querySelector<HTMLInputElement>('input[type="date"]');
  assert.ok(input, 'expected a native date input');
  assert.equal(input.getAttribute('aria-label'), 'Select any match date');
  assert.ok(input.classList.contains('date-input-overlay'));

  await setNativeDate(input, '');
  assert.deepEqual(changes, []);

  await setNativeDate(input, '2026-11-25');
  assert.deepEqual(changes, ['2026-11-25']);
});
