import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DataTableColumn } from './DataTable.tsx';
import { installDomTestEnv } from '../../utils/domTestEnv.ts';

installDomTestEnv();

const { act, createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DataTable } = await import('./DataTable.tsx');

type Root = ReturnType<typeof createRoot>;
type Row = { id: string; name: string };
let mounted: { container: HTMLElement; root: Root } | null = null;

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', cell: (row) => row.name },
];
const rows = [{ id: '1', name: 'Example market' }];

async function renderTable(props: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  await act(async () => {
    root.render(
      h(DataTable<Row>, {
        columns,
        rows,
        rowKey: (row: Row) => row.id,
        caption: 'Example market table',
        ...props,
      })
    );
  });
  return container;
}

function scrollWrapper(container: HTMLElement): HTMLElement {
  const wrapper = container.querySelector<HTMLElement>('div.overflow-x-auto');
  assert.ok(wrapper, 'expected a horizontal scroll wrapper');
  return wrapper;
}

afterEach(async () => {
  if (mounted) {
    const { container, root } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
});

test('screen-reader-only table text stays inside the clipping scroll wrapper', async () => {
  const container = await renderTable();
  const wrapper = scrollWrapper(container);

  assert.ok(wrapper.classList.contains('relative'), 'wrapper must establish a containing block');
  assert.equal(wrapper.querySelector('caption.sr-only')?.textContent, 'Example market table');

  const hiddenText = [...container.querySelectorAll('.sr-only')];
  assert.ok(hiddenText.length > 0);
  for (const node of hiddenText) {
    assert.ok(wrapper.contains(node), 'sr-only content must not escape the scroll wrapper');
  }
});

test('legacy right-aligned columns render left-aligned headers and cells', async () => {
  const alignedColumns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (row) => row.name,
      align: 'right',
    },
    {
      key: 'score',
      header: 'Score',
      cell: () => '3.15',
      align: 'right',
      sortValue: (row) => row.name.length,
    },
  ];
  const container = await renderTable({ columns: alignedColumns });
  const headerCells = [...container.querySelectorAll('thead th')];
  const bodyCells = [...container.querySelectorAll('tbody tr:first-child td')];

  assert.equal(headerCells.length, 2);
  assert.equal(bodyCells.length, 2);
  for (const cell of [...headerCells, ...bodyCells]) {
    assert.ok(cell.classList.contains('text-left'), 'cells must be left-aligned');
    assert.ok(!cell.classList.contains('text-right'), 'cells must not be right-aligned');
  }

  const sortButton = container.querySelector('thead button');
  assert.ok(sortButton, 'expected a sortable header');
  assert.ok(sortButton.classList.contains('justify-start'));
  assert.ok(!sortButton.classList.contains('justify-end'));
});

test('the card-view variant keeps the same guarded scroll wrapper', async () => {
  const container = await renderTable({
    renderCard: (row: Row) => h('div', null, row.name),
  });
  const wrapper = scrollWrapper(container);

  assert.ok(wrapper.classList.contains('relative'));
  assert.ok(wrapper.classList.contains('hidden'));
  assert.ok(wrapper.classList.contains('sm:block'));
  assert.ok(container.querySelector('div.sm\\:hidden'), 'expected the phone card view');
  assert.equal(wrapper.querySelector('caption.sr-only')?.textContent, 'Example market table');
});
