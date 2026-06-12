import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access';

/**
 * Better Auth organization-plugin role registry, shared by the server config
 * (`lib/auth.ts`) and the browser client (`lib/auth-client.ts`). Registering
 * `scorer` here is what makes the plugin's invite / update-role endpoints
 * accept it as a role string.
 *
 * These statements govern only Better Auth's own membership management
 * (invite, remove, change role). What each role may do to series and
 * workspace data is the separate app-level table in `lib/auth/permissions.ts`.
 */
export const orgAccessControl = createAccessControl(defaultStatements);

export const orgRoles = {
  owner: orgAccessControl.newRole(ownerAc.statements),
  admin: orgAccessControl.newRole(adminAc.statements),
  // member and scorer manage no memberships — both mirror the plugin's
  // default member statements.
  member: orgAccessControl.newRole(memberAc.statements),
  scorer: orgAccessControl.newRole(memberAc.statements),
};
