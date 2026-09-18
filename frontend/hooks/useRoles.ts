import { useMemo } from 'react';

import { useGoApi } from './useK8s';

/**
 * What the current user may do, from `GET /api/me`.
 *
 * Keycloak roles were already being extracted at login and then dropped: every
 * user saw every button and learned their real permissions by clicking one and
 * reading a 403. This surfaces the same roles the API enforces with, so the UI
 * can explain a restriction up front instead of after the fact.
 *
 * This is for rendering only. Every route is still checked server-side; a
 * `canWrite` of true is a prediction about what the API will allow, never a
 * grant. Failing *open* is deliberate for that reason -- see below.
 */

export type Me = {
  username: string;
  email: string;
  name: string;
  roles: string[];
  readableAgents: string[];
  writableAgents: string[];
  isSuperAdmin: boolean;
};

export type RolesResult = {
  me: Me | undefined;
  loading: boolean;
  /** True once we have a real answer, so callers can avoid flashing a disabled button. */
  resolved: boolean;
  isSuperAdmin: boolean;
  canRead: (agent: string | null | undefined) => boolean;
  canWrite: (agent: string | null | undefined) => boolean;
};

export function useRoles(): RolesResult {
  // callGoApi prefixes /api, so this resolves to /api/me.
  const { data, error, isLoading } = useGoApi<Me>('/me', {
    // Roles change when an admin edits them in Keycloak, not while the user
    // is clicking around; the token would need refreshing anyway.
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return useMemo(
    () => ({
      me: data,
      loading: isLoading,
      resolved: Boolean(data) || Boolean(error),
      isSuperAdmin: data?.isSuperAdmin ?? false,
      ...permissionPredicates(data),
    }),
    [data, error, isLoading]
  );
}

/**
 * The allow/deny decisions, separated from the data fetching so they can be
 * tested directly rather than through a mocked SWR.
 *
 * Fails *open* when `me` is undefined: disabling every control because a
 * metadata call failed would make the console look broken for users who are
 * in fact fully authorized. The server still rejects anything they may not
 * do, so the cost is a clearer error later rather than a greyed button now.
 */
export function permissionPredicates(me: Me | undefined): Pick<RolesResult, 'canRead' | 'canWrite'> {
  const permissive = !me;
  const readable = new Set(me?.readableAgents ?? []);
  const writable = new Set(me?.writableAgents ?? []);
  const superAdmin = me?.isSuperAdmin ?? false;

  return {
    canRead: (agent) => {
      if (permissive || superAdmin) return true;
      return agent ? readable.has(agent) : false;
    },
    canWrite: (agent) => {
      if (permissive || superAdmin) return true;
      return agent ? writable.has(agent) : false;
    },
  };
}

/**
 * How to describe the permission a disabled control needs.
 *
 * Names superadmin as the alternative because the middleware accepts either,
 * and "requires the dev0-write role" alone reads as though that specific role
 * is the only way in.
 */
export function writeRoleFor(agent: string | null | undefined): string {
  return agent ? `${agent}-write or superadmin` : 'write access';
}

export function readRoleFor(agent: string | null | undefined): string {
  return agent ? `${agent}-read or superadmin` : 'read access';
}
