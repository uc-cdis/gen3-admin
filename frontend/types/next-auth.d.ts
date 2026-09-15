import type { DefaultSession } from 'next-auth';

/**
 * Augments NextAuth's types with the fields our session callback attaches in
 * `pages/api/auth/[...nextauth].js`. Without this, `session.accessToken` is a
 * type error even though every authenticated fetch in the app depends on it.
 */
declare module 'next-auth' {
  interface Session {
    /** Keycloak access token, forwarded as a Bearer token to the Go API. */
    accessToken?: string;
    /** Set when a token refresh failed, e.g. 'RefreshAccessTokenError'. */
    error?: string;
    /** Signals the client to re-sync auth cookies after a refresh. */
    setCookies?: boolean;
    user?: DefaultSession['user'] & {
      id?: string;
      username?: string;
      roles?: string[];
      groups?: string[];
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    idToken?: string;
    provider?: string;
    error?: string;
    setCookies?: boolean;
  }
}
