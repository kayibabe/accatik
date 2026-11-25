import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomTestEnv } from '../../utils/domTestEnv.ts';

installDomTestEnv();

const { act, createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FormGuide } = await import('./FormGuide.tsx');

async function render(value: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(FormGuide, { value }));
  });
  return container;
}

test('form results keep their own colours and the original string', async () => {
  const container = await render('L-L-D-D-D');

  assert.equal(container.textContent, 'L-L-D-D-D');
  const letters = [...container.querySelectorAll('[title]')];
  assert.deepEqual(
    letters.map((letter) => letter.textContent),
    ['L', 'L', 'D', 'D', 'D']
  );
  assert.deepEqual(
    letters.map((letter) => letter.getAttribute('title')),
    ['Loss', 'Loss', 'Draw', 'Draw', 'Draw']
  );
  assert.match(letters[0].className, /text-rose-700/);
  assert.match(letters[2].className, /text-amber-700/);
});

test('wins take the win colour and unknown form stays a dash', async () => {
  const wins = await render('D-D-L-W-L');
  const letters = [...wins.querySelectorAll('[title]')];
  assert.match(letters[3].className, /text-emerald-700/);
  assert.equal(letters[3].getAttribute('title'), 'Win');

  const empty = await render('—');
  assert.equal(empty.textContent, '—');
  assert.equal(empty.querySelectorAll('[title]').length, 0);
});
