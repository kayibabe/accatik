import test from 'node:test';
import assert from 'node:assert/strict';
import {
  originFromTicketName,
  renameLegacyTicketName,
  ticketName,
} from './ticketNaming.ts';

test('new ticket names lead with their origin', () => {
  assert.equal(
    ticketName({
      origin: 'positive-reads',
      legCount: 17,
      strategy: 'balanced',
      totalOdds: 1112.03,
    }),
    'Positive Reads and Analytics · 17-Leg Balanced Acca (1112.03 Odds)'
  );
  assert.equal(
    ticketName({
      origin: 'ai-desk',
      legCount: 5,
      strategy: 'balanced',
      totalOdds: 41.9,
    }),
    'AI Desk · 5-Leg Balanced Acca (41.90 Odds)'
  );
  assert.equal(
    ticketName({
      origin: 'slate',
      legCount: 2,
      strategy: 'high-yield',
      totalOdds: 7.17,
    }),
    'Slate · 2-Leg High-yield Acca (7.17 Odds)'
  );
});

test('origin is read back from an origin-prefixed ticket name', () => {
  assert.equal(
    originFromTicketName('Positive Reads and Analytics · 17-Leg Balanced Acca (1112.03 Odds)'),
    'positive-reads'
  );
  assert.equal(
    originFromTicketName('Positive Reads · 17-Leg Balanced Acca (1112.03 Odds)'),
    'positive-reads'
  );
  assert.equal(
    originFromTicketName('AI Desk · 5-Leg Balanced Acca (41.90 Odds)'),
    'ai-desk'
  );
  assert.equal(
    originFromTicketName('2-Leg High-yield Acca (7.17 Odds)'),
    null
  );
});

test('the five legacy tickets are renamed from their known origins', () => {
  assert.equal(
    renameLegacyTicketName('2-Leg High-yield Acca (7.17 Odds)'),
    'Slate · 2-Leg High-yield Acca (7.17 Odds)'
  );
  assert.equal(
    renameLegacyTicketName('3-Leg Goals Acca (4.41 Odds)'),
    'Slate · 3-Leg Goals Acca (4.41 Odds)'
  );
  assert.equal(
    renameLegacyTicketName('3-Leg Balanced Acca (3.68 Odds)'),
    'Slate · 3-Leg Balanced Acca (3.68 Odds)'
  );
  assert.equal(
    renameLegacyTicketName('5-Leg Balanced Acca (41.90 Odds)'),
    'AI Desk · 5-Leg Balanced Acca (41.90 Odds)'
  );
  assert.equal(
    renameLegacyTicketName('17-Leg Balanced Acca (1112.03 Odds)'),
    'Positive Reads and Analytics · 17-Leg Balanced Acca (1112.03 Odds)'
  );
  assert.equal(renameLegacyTicketName('Some other ticket'), null);
});
