/**
 * The banner used to say "This page was edited elsewhere", which reads as a
 * claim about a colleague. The series row's version is the compare-and-swap
 * token for all of its children, so a settings save often loses the race to
 * the scorer's own competitor or finish write — and the claim is then false.
 * These pin what the copy is allowed to assert.
 */
import { describe, expect, test } from 'vitest';

import { conflictNoticeMessage } from '@/components/conflict-notice';

describe('conflictNoticeMessage', () => {
  test('says the write was lost, whoever won', () => {
    expect(conflictNoticeMessage()).toContain("Couldn't save");
  });

  test('blames nobody when the winning write was the scorer’s own', () => {
    const message = conflictNoticeMessage({
      byCurrentUser: true,
      actor: { id: 'u1', displayName: 'Sarah Byrne', email: 'sarah@example.com' },
    });
    expect(message).not.toContain('Sarah');
    expect(message).not.toContain('sarah@example.com');
  });

  test('blames nobody when the winning write is unattributed', () => {
    expect(conflictNoticeMessage({ currentVersion: 4, expectedVersion: 3 })).toBe(
      conflictNoticeMessage(),
    );
  });

  test('names the colleague who got there first', () => {
    expect(
      conflictNoticeMessage({
        actor: { id: 'u2', displayName: 'Sarah Byrne', email: 'sarah@example.com' },
      }),
    ).toContain('Sarah Byrne');
  });

  test('falls back to the email when the colleague has no display name', () => {
    expect(
      conflictNoticeMessage({ actor: { id: 'u2', email: 'sarah@example.com' } }),
    ).toContain('sarah@example.com');
  });

  test('blames nobody when all the server knows is a user id', () => {
    // The actor was deleted between the write and the conflict, so
    // `buildConflictError` surfaces the bare id. A raw id names nobody a
    // scorer would recognise.
    expect(conflictNoticeMessage({ actor: { id: 'u2' } })).toBe(
      conflictNoticeMessage(),
    );
  });
});
