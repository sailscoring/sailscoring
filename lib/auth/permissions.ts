/**
 * Workspace roles and the app-level permissions they grant.
 *
 * Deliberately NOT `server-only`: the same table drives server-side
 * enforcement (the `workspaceRoute` wrapper / `requirePermission`) and
 * client-side UI gating (hiding edit affordances a role can't use), so the
 * two can never disagree. Keep this module pure — no imports beyond types.
 *
 * Better Auth stores the role as free text on the `member` row; its own
 * access control only governs membership management (invite / remove /
 * change role — owner and admin). Everything under `/api/v1` is governed
 * here instead.
 */

export type Permission =
  /** See everything in the workspace: series, standings, activity, history. */
  | 'read'
  /** Race-day operations: races, start sequences, finishes, per-race rating
   *  overrides, publishing results. */
  | 'score'
  /** Series configuration: series CRUD, fleets, competitors, handicaps,
   *  categories, revision restore, trash. */
  | 'manage-series'
  /** Workspace configuration: logos, FTP servers, workspace settings.
   *  (Membership management is enforced separately by Better Auth.) */
  | 'manage-workspace';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'scorer';

const ALL_PERMISSIONS: readonly Permission[] = [
  'read',
  'score',
  'manage-series',
  'manage-workspace',
];

/**
 * `member` is the read-only tier — and, being Better Auth's default
 * invitation role, the safe default for new invitees: they can see
 * everything but change nothing until promoted. Existing members from
 * before role enforcement were promoted to `admin` by a one-off data
 * migration, so no one lost access when enforcement landed.
 */
export const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  scorer: ['read', 'score'],
  member: ['read'],
};

export function isWorkspaceRole(role: string): role is WorkspaceRole {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}

/**
 * Whether `role` grants `permission`. The role comes from the database as
 * free text, so an unrecognised value fails closed to read-only rather
 * than throwing — a typo'd or future role must never grant writes.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  if (!isWorkspaceRole(role)) return permission === 'read';
  return ROLE_PERMISSIONS[role].includes(permission);
}
