// pages/api/auth/[...nextauth].js
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import KeycloakProvider from "next-auth/providers/keycloak";
import { serialize } from "cookie";

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

const authOptions = {
  providers: [
    // Keycloak provider
    KeycloakProvider({
      clientId: process.env.NEXT_KEYCLOAK_CLIENT_ID ?? "",
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
      issuer: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
      authorization: {
        params: {
          scope: "openid profile email groups roles",
        }
      },
      profile(profile) {
        console.log("Keycloak profile:", profile);
        return {
          id: profile.sub,
          name: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim() || profile.preferred_username,
          email: profile.email,
          image: profile.picture,
          roles: profile.roles || profile.realm_access?.roles || [],
          groups: profile.groups || []
        };
      },
    }),

    CredentialsProvider({
      id: "mock-provider",
      name: "Mock Provider",
      credentials: {
        username: { label: "Username", type: "text", placeholder: "John Doe" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const user = {
          id: "1",
          name: "John Doe",
          email: "johndoe@example.com",
          image: "https://via.placeholder.com/150",
        };

        if (user) {
          return {
            ...user,
            accessToken: "fake-access-token",
            refreshToken: "fake-refresh-token",
            expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
            provider: "mock-auth"
          };
        } else {
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, account, profile }) {
      // Initial sign in
      if (account && user) {
        const expiresAt = account.expires_at ? account.expires_at * 1000 : 0;
        console.log('Initial token expires at:', new Date(expiresAt).toISOString());
        console.log('Time until expiration:', Math.round((expiresAt - Date.now()) / 1000), 'seconds');
        console.log('Account provider:', account.provider);
        console.log('Access token present:', !!account.access_token);
        console.log('Refresh token present:', !!account.refresh_token);

        // Store tokens for cookie setting in session callback
        if (account.provider === "keycloak" && account.access_token) {
          console.log('Preparing Keycloak cookies...');
          pendingCookies = [];

          // Prepare access token cookie
          pendingCookies.push(serialize(ACCESS_TOKEN_COOKIE, account.access_token, {
            ...COOKIE_OPTIONS,
            maxAge: Math.min(COOKIE_OPTIONS.maxAge, Math.floor((expiresAt - Date.now()) / 1000))
          }));

          // Prepare refresh token cookie if available
          if (account.refresh_token) {
            pendingCookies.push(serialize(REFRESH_TOKEN_COOKIE, account.refresh_token, COOKIE_OPTIONS));
          }

          console.log('Prepared cookies:', pendingCookies.length);
        }

        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: expiresAt,
          provider: account.provider,
          roles: user.roles || [],
          groups: user.groups || [],
          id: user.id,
          picture: user.image,
          // Flag to indicate cookies need to be set
          setCookies: account.provider === "keycloak"
        };
      }

      const accessTokenExpires = token.accessTokenExpires || 0;
      const timeUntilExpiry = Math.round((accessTokenExpires - Date.now()) / 1000);
      console.log('Token check - Time until expiration:', timeUntilExpiry, 'seconds');

      if (Date.now() < accessTokenExpires) {
        console.log('Token still valid, returning existing token');
        return token;
      }

      console.log('Token expired, attempting refresh...');

      const refreshedToken = await refreshAccessToken(token);

      if (refreshedToken.error) {
        console.log('Token refresh failed, forcing sign out');
        // Prepare cookies to be cleared
        pendingCookies = [
          serialize(ACCESS_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 }),
          serialize(REFRESH_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 })
        ];
        return { ...token, error: 'RefreshAccessTokenError' };
      }

      // Update cookies with refreshed tokens for Keycloak
      if (refreshedToken.provider === "keycloak" && refreshedToken.accessToken) {
        console.log('Preparing refreshed Keycloak cookies...');
        pendingCookies = [];

        const refreshedExpires = refreshedToken.accessTokenExpires || Date.now() + (60 * 60 * 1000);

        pendingCookies.push(serialize(ACCESS_TOKEN_COOKIE, refreshedToken.accessToken, {
          ...COOKIE_OPTIONS,
          maxAge: Math.min(COOKIE_OPTIONS.maxAge, Math.floor((refreshedExpires - Date.now()) / 1000))
        }));

        if (refreshedToken.refreshToken) {
          pendingCookies.push(serialize(REFRESH_TOKEN_COOKIE, refreshedToken.refreshToken, COOKIE_OPTIONS));
        }

        refreshedToken.setCookies = true;
      }

      return refreshedToken;
    },

    async session({ session, token }) {
      if (!token) {
        return session;
      }

      session.user = {
        ...session.user,
        id: token.id || token.sub || '',
        name: token.name,
        email: token.email,
        image: token.picture,
        roles: token.roles || [],
        groups: token.groups || []
      };

      session.accessToken = token.accessToken;
      session.error = token.error;

      // Add flag to session to indicate cookies need to be set
      session.setCookies = token.setCookies || false;

      return session;
    },
  },

  events: {
    async signOut({ token }) {
      console.log('User signed out');
      // Prepare cookies to be cleared
      pendingCookies = [
        serialize(ACCESS_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 }),
        serialize(REFRESH_TOKEN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 })
      ];
    },
  },

  debug: process.env.NODE_ENV === "development",
  secret: process.env.NEXTAUTH_SECRET,

  // Token session settings
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },
};

/**
 * Refreshes the access token using the refresh token
 */
async function refreshAccessToken(token) {
  try {
    // Check if this is a mock provider token
    if (token.provider === "mock-provider") {
      console.log("mock-provider refresh");

      return {
        ...token,
        accessToken: `fake-access-token-${Date.now()}`,
        refreshToken: `fake-refresh-token-${Date.now()}`,
        accessTokenExpires: Date.now() + (3600 * 1000), // 1 hour from now
      };
    }

    // Ensure we have a refresh token
    if (!token.refreshToken) {
      throw new Error('No refresh token available');
    }

    // Get the refresh URL from your Keycloak server
    const url = `${process.env.NEXT_PUBLIC_KEYCLOAK_URL}/realms/${process.env.NEXT_PUBLIC_KEYCLOAK_REALM}/protocol/openid-connect/token`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      accessTokenExpires: Date.now() + (refreshedTokens.expires_in * 1000),
      error: undefined, // Clear any previous errors
    };
  } catch (error) {
    console.error("Error refreshing access token", error);

    // Return the token with an error flag
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

// Main handler that wraps NextAuth and handles cookies
export default async function handler(req, res) {
  // Create a wrapper to intercept the response
  const originalSetHeader = res.setHeader.bind(res);
  const originalEnd = res.end.bind(res);

  // Override setHeader to add our cookies when needed
  res.setHeader = function(name, value) {
    if (name.toLowerCase() === 'set-cookie' && pendingCookies.length > 0) {
      console.log('Injecting pending cookies into response...');
      const existingCookies = Array.isArray(value) ? value : [value];
      value = [...existingCookies, ...pendingCookies];
      pendingCookies = []; // Clear after use
    }
    return originalSetHeader(name, value);
  };

  // Override end to ensure cookies are set before response ends
  res.end = function(...args) {
    if (pendingCookies.length > 0) {
      console.log('Setting cookies before response ends...');
      const existingCookies = res.getHeader('Set-Cookie') || [];

      // Handle different types that getHeader can return
      let cookieArray = [];
      if (typeof existingCookies === 'string') {
        cookieArray = [existingCookies];
      } else if (Array.isArray(existingCookies)) {
        cookieArray = existingCookies.filter(cookie => typeof cookie === 'string');
      }

      const allCookies = [...cookieArray, ...pendingCookies];
      res.setHeader('Set-Cookie', allCookies);
      pendingCookies = [];
    }
    return originalEnd.apply(res, args);
  };

  return NextAuth(req, res, authOptions);
}

// ============= DEBUGGING HELPERS =============
// Add this middleware to your _app.tsx or create a separate API route to check cookies

// pages/api/debug-cookies.js (create this file for debugging)
/*
export default function handler(req, res) {
  console.log('All cookies:', req.headers.cookie);

  const cookies = req.headers.cookie?.split('; ').reduce((acc, cookie) => {
    const [key, value] = cookie.split('=');
    acc[key] = value;
    return acc;
  }, {}) || {};

  res.status(200).json({
    allCookies: cookies,
    keycloakAccessToken: cookies['keycloak-access-token'] || 'Not found',
    keycloakRefreshToken: cookies['keycloak-refresh-token'] || 'Not found',
    nextAuthSession: cookies['next-auth.session-token'] || cookies['__Secure-next-auth.session-token'] || 'Not found',
  });
}
*/

// ============= CLIENT-SIDE DEBUGGING =============
// Add this to any client component to check cookies

/*
// utils/debugCookies.js
export function debugCookies() {
  if (typeof window !== 'undefined') {
    console.log('=== Cookie Debug ===');
    console.log('All cookies:', document.cookie);

    const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
      const [key, value] = cookie.split('=');
      acc[key] = value;
      return acc;
    }, {});

    console.log('Parsed cookies:', cookies);
    console.log('Keycloak Access Token:', cookies['keycloak-access-token'] || 'Not found');
    console.log('Keycloak Refresh Token:', cookies['keycloak-refresh-token'] || 'Not found');

    // Check in DevTools
    console.log('To check httpOnly cookies, go to:');
    console.log('1. DevTools -> Application -> Cookies');
    console.log('2. Or DevTools -> Network -> Check request headers');
  }
}

// Use in a component:
// import { debugCookies } from '@/utils/debugCookies';
// useEffect(() => { debugCookies(); }, []);
*/

// ============= MIDDLEWARE APPROACH (Alternative) =============
// middleware.js (create in root directory)

/*
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (token && token.accessToken && token.provider === 'keycloak') {
    const response = NextResponse.next();

    // Set cookies in middleware
    response.cookies.set('keycloak-access-token', token.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    if (token.refreshToken) {
      response.cookies.set('keycloak-refresh-token', token.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });
    }

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
*/
