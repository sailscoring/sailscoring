import { describe, expect, test } from 'vitest';

import {
  hasPermission,
  isWorkspaceRole,
  ROLE_PERMISSIONS,
  type Permission,
} from '@/lib/auth/permissions';

const ALL: Permission[] = ['read', 'score', 'manage-series', 'manage-workspace'];

describe('ROLE_PERMISSIONS', () => {
  test('owner and admin hold every permission', () => {
    for (const p of ALL) {
      expect(hasPermission('owner', p)).toBe(true);
      expect(hasPermission('admin', p)).toBe(true);
    }
  });

  test('scorer holds read + score only', () => {
    expect(hasPermission('scorer', 'read')).toBe(true);
    expect(hasPermission('scorer', 'score')).toBe(true);
    expect(hasPermission('scorer', 'manage-series')).toBe(false);
    expect(hasPermission('scorer', 'manage-workspace')).toBe(false);
  });

  test('member is the read-only tier', () => {
    expect(hasPermission('member', 'read')).toBe(true);
    expect(hasPermission('member', 'score')).toBe(false);
    expect(hasPermission('member', 'manage-series')).toBe(false);
    expect(hasPermission('member', 'manage-workspace')).toBe(false);
  });

  test('every role grants read', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect(hasPermission(role, 'read')).toBe(true);
    }
  });

  test('an unknown role fails closed to read-only', () => {
    expect(isWorkspaceRole('superuser')).toBe(false);
    expect(hasPermission('superuser', 'read')).toBe(true);
    expect(hasPermission('superuser', 'score')).toBe(false);
    expect(hasPermission('superuser', 'manage-series')).toBe(false);
    expect(hasPermission('superuser', 'manage-workspace')).toBe(false);
  });
});
