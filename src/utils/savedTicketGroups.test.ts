import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTicketDayLabel,
  formatTicketMonthLabel,
  groupTicketsByDate,
  sortTicketsNewestFirst,
  ticketDateIso,
} from './savedTicketGroups.ts';
import { makeTicket } from './testFactories.ts';

test('dateIso wins, with display date and saved time as fallbacks', () => {
  assert.equal(
    ticketDateIso(makeTicket({ id: 'a', dateIso: '2026-11-16' })),
    '2026-11-16'
  );

  assert.equal(
    ticketDateIso(
      makeTicket({ id: 'b', dateIso: undefined, date: '16 Nov 2026' })
    ),
    '2026-11-16'
  );

  assert.equal(
    ticketDateIso(
      makeTicket({
        id: 'c',
        dateIso: undefined,
        date: '',
        createdAt: '2026-11-16T21:30:00.000Z',
      })
    ),
    '2026-11-16'
  );
});

test('an instant saved after CAT midnight belongs to the next matchday', () => {
  assert.equal(
    ticketDateIso(
      makeTicket({
        id: 'late',
        dateIso: undefined,
        date: '',
        createdAt: '2026-11-18T22:30:00.000Z',
      })
    ),
    '2026-11-19'
  );
});

test('slips sort newest matchday first, then newest saved first', () => {
  const tickets = [
    makeTicket({
      id: 'older-day',
      dateIso: '2026-11-16',
      createdAt: '2026-11-16T12:00:00.000Z',
    }),
    makeTicket({
      id: 'earlier-save',
      dateIso: '2026-11-18',
      createdAt: '2026-11-18T07:00:00.000Z',
    }),
    makeTicket({
      id: 'later-save',
      dateIso: '2026-11-18',
      createdAt: '2026-11-18T09:00:00.000Z',
    }),
  ];

  assert.deepEqual(
    sortTicketsNewestFirst(tickets).map((ticket) => ticket.id),
    ['later-save', 'earlier-save', 'older-day']
  );
});

test('slips group by year, then month, then matchday', () => {
  const tickets = [
    makeTicket({ id: 'september', dateIso: '2026-09-30' }),
    makeTicket({
      id: 'nov-18-morning',
      dateIso: '2026-11-18',
      createdAt: '2026-11-18T07:00:00.000Z',
    }),
    makeTicket({
      id: 'nov-18-evening',
      dateIso: '2026-11-18',
      createdAt: '2026-11-18T19:00:00.000Z',
    }),
    makeTicket({ id: 'nov-10', dateIso: '2026-11-10' }),
    makeTicket({ id: 'last-year', dateIso: '2025-12-31' }),
  ];

  const groups = groupTicketsByDate(tickets);

  assert.deepEqual(
    groups.map((group) => group.year),
    [2026, 2025]
  );
  assert.deepEqual(
    groups[0].months.map((month) => month.month),
    [11, 9]
  );
  assert.deepEqual(
    groups[0].months[0].days.map((day) => day.dateIso),
    ['2026-11-18', '2026-11-10']
  );
  assert.deepEqual(
    groups[0].months[0].days[0].tickets.map((ticket) => ticket.id),
    ['nov-18-evening', 'nov-18-morning']
  );
});

test('day labels call out today and yesterday', () => {
  assert.equal(
    formatTicketDayLabel('2026-11-18', '2026-11-18'),
    'Today · Wednesday, 18 November 2026'
  );
  assert.equal(
    formatTicketDayLabel('2026-11-17', '2026-11-18'),
    'Yesterday · Tuesday, 17 November 2026'
  );
  assert.equal(
    formatTicketDayLabel('2026-10-05', '2026-11-18'),
    'Monday, 5 October 2026'
  );
});

test('month labels drop the year already shown by the section heading', () => {
  assert.equal(formatTicketMonthLabel(1), 'January');
  assert.equal(formatTicketMonthLabel(11), 'November');
});
