// pages/api/auth/[...nextauth].js
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import KeycloakProvider from "next-auth/providers/keycloak";
import { serialize } from "cookie";

const ENABLE_MOCK_AUTH =
  process.env.ENABLE_MOCK_AUTH === "true"
  ||
  process.env.NODE_ENV === "development";

// Cookie configuration
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 8, // 8 hours
};

const ACCESS_TOKEN_COOKIE = "keycloak-access-token";
const REFRESH_TOKEN_COOKIE = "keycloak-refresh-token";

// Store for passing cookies between callbacks
let pendingCookies = [];

/** ================= PROVIDERS ================= */

const providers = [
  KeycloakProvider({
    clientId: process.env.NEXT_KEYCLOAK_CLIENT_ID ?? "",
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
    issuer: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    authorization: {
      params: {
        scope: "openid profile email groups roles",
      },
    },
    profile(profile) {
      return {
        id: profile.sub,
        name:
          profile.name ||
          `${profile.given_name || ""} ${profile.family_name || ""}`.trim() ||
          profile.preferred_username,
        email: profile.email,
        image: profile.picture,
        roles: profile.roles || profile.realm_access?.roles || [],
        groups: profile.groups || [],
      };
    },
  }),
];

if (ENABLE_MOCK_AUTH) {
  providers.push(
    CredentialsProvider({
      id: "mock-provider",
      name: "Mock Provider",
      async authorize() {
        console.log("MOCK AUTHORIZE CALLED");

        return {
          id: "1",
          name: "John Doe",
          email: "johndoe@example.com",
          image: "https://via.placeholder.com/150",
          accessToken: `fake-access-token-${Date.now()}`,
          refreshToken: `fake-refresh-token-${Date.now()}`,
          expiresAt: Date.now() + 60 * 60 * 1000,
          provider: "mock-provider",
        };
      },
    })
  );
}

/** ================= NEXTAUTH OPTIONS ================= */

const authOptions = {
  providers,

  callbacks: {
    async jwt({ token, user, account }) {
      if (account && user) {
        const expiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3600 * 1000;


        const accessToken =
          account.provider === "mock-provider"
            ? user.accessToken
            : account.access_token;

        const refreshToken =
          account.provider === "mock-provider"
            ? user.refreshToken
            : account.refresh_token;

        if (account.provider === "keycloak" && account.access_token) {
          pendingCookies = [];

          pendingCookies.push(
            serialize(ACCESS_TOKEN_COOKIE, account.access_token, {
              ...COOKIE_OPTIONS,
              maxAge: Math.min(
                COOKIE_OPTIONS.maxAge,
                Math.floor((expiresAt - Date.now()) / 1000)
              ),
            })
          );

          if (account.refresh_token) {
            pendingCookies.push(
              serialize(REFRESH_TOKEN_COOKIE, account.refresh_token, COOKIE_OPTIONS)
            );
          }
        }

        return {
          ...token,
          accessToken,
          refreshToken,
          accessTokenExpires: expiresAt,
          provider: account.provider,
          roles: user.roles || [],
          groups: user.groups || [],
          id: user.id,
          picture: user.image,
          setCookies: account.provider === "keycloak",
        };
      }

      if (Date.now() < (token.accessTokenExpires || 0)) {
        return token;
      }

      const refreshedToken = await refreshAccessToken(token);

      if (refreshedToken.provider === "keycloak" && refreshedToken.accessToken) {
        pendingCookies = [];

        const refreshedExpires =
          refreshedToken.accessTokenExpires || Date.now() + 3600 * 1000;

        pendingCookies.push(
          serialize(ACCESS_TOKEN_COOKIE, refreshedToken.accessToken, {
            ...COOKIE_OPTIONS,
            maxAge: Math.min(
              COOKIE_OPTIONS.maxAge,
              Math.floor((refreshedExpires - Date.now()) / 1000)
            ),
          })
        );

        if (refreshedToken.refreshToken) {
          pendingCookies.push(
            serialize(REFRESH_TOKEN_COOKIE, refreshedToken.refreshToken, COOKIE_OPTIONS)
          );
        }

        refreshedToken.setCookies = true;
      }

      return refreshedToken;
    },

    async session({ session, token }) {
      if (!token) return session;

      session.user = {
        ...session.user,
        id: token.id || token.sub || "",
        name: token.name,
        email: token.email,
        image: token.picture,
        roles: token.roles || [],
        groups: token.groups || [],
      };

      session.accessToken = token.accessToken;
      session.error = token.error;
      session.setCookies = token.setCookies || false;

      return session;
    },
  },

  events: {
    async signOut() {
      pendingCookies = [
        serialize(ACCESS_TOKEN_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 }),
        serialize(REFRESH_TOKEN_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 }),
      ];
    },
  },

  debug: process.env.NODE_ENV === "development",
  secret: process.env.NEXTAUTH_SECRET,

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },
};

/** ================= TOKEN REFRESH ================= */

async function refreshAccessToken(token) {
  try {
    if (token.provider === "mock-provider") {
      if (!ENABLE_MOCK_AUTH) {
        return { ...token, error: "MockAuthDisabled" };
      }

      return {
        ...token,
        accessToken: `fake-access-token-${Date.now()}`,
        refreshToken: `fake-refresh-token-${Date.now()}`,
        accessTokenExpires: Date.now() + 3600 * 1000,
      };
    }

    if (!token.refreshToken) throw new Error("No refresh token");

    const url = `${process.env.NEXT_PUBLIC_KEYCLOAK_URL}/realms/${process.env.NEXT_PUBLIC_KEYCLOAK_REALM}/protocol/openid-connect/token`;

    const response = await fetch(url, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshedTokens = await response.json();
    if (!response.ok) throw refreshedTokens;

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      error: undefined,
    };
  } catch (error) {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

/** ================= HANDLER ================= */

export default async function handler(req, res) {
  const originalSetHeader = res.setHeader.bind(res);
  const originalEnd = res.end.bind(res);

  res.setHeader = function (name, value) {
    if (name.toLowerCase() === "set-cookie" && pendingCookies.length > 0) {
      const existing = Array.isArray(value) ? value : [value];
      value = [...existing, ...pendingCookies];
      pendingCookies = [];
    }
    return originalSetHeader(name, value);
  };

  res.end = function (...args) {
    if (pendingCookies.length > 0) {
      const existingCookies = res.getHeader("Set-Cookie") || [];
      const cookieArray = Array.isArray(existingCookies)
        ? existingCookies
        : [existingCookies];

      res.setHeader("Set-Cookie", [...cookieArray, ...pendingCookies]);
      pendingCookies = [];
    }
    return originalEnd.apply(res, args);
  };

  return NextAuth(req, res, authOptions);
}
