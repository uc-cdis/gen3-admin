// pages/api/auth/[...nextauth].ts
import NextAuth, { Account, Session, User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import KeycloakProvider from "next-auth/providers/keycloak";
import { JWT } from "next-auth/jwt";

export default NextAuth({
  providers: [
    // Keycloak provider
    KeycloakProvider({
      clientId: process.env.NEXT_KEYCLOAK_CLIENT_ID ?? "",
      clientSecret: process.env.NEXT_KEYCLOAK_CLIENT_SECRET ?? "",
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
        
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: expiresAt,
          id: profile.sub,
          name: profile.name || profile.preferred_username,
          email: profile.email,
          image: profile.picture,
          roles: user?.roles || profile.roles || [],
          groups: user?.groups || profile.groups || [],
          provider: account.provider // Store the provider info
        };
      }

      const timeUntilExpiry = Math.round((token.accessTokenExpires - Date.now()) / 1000);
      console.log('Token check - Time until expiration:', timeUntilExpiry, 'seconds');
      
      if (Date.now() < (token.accessTokenExpires)) {
        console.log('Token still valid, returning existing token');
        return token;
      }

      console.log('Token expired, attempting refresh...');

      const refreshedToken = await refreshAccessToken(token);
      
      if (refreshedToken.error) {
        console.log('Token refresh failed, forcing sign out');
        return null; // This will trigger automatic sign out
      }
      
      return refreshedToken;
    },

    async session({ session, token }) {
      if (!token) {
        return null;
      }

      session.user = {
        ...session.user,
        id: token.id,
        name: token.name,
        email: token.email,
        image: token.picture,
        roles: token.roles || [],
        groups: token.groups || []
      };

      session.accessToken = token.accessToken;
      session.error = token.error;

      return session;
    },
  },

  events: {
    async signOut({ token }) {
      console.log('User signed out due to token expiration');
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
});

/**
 * Refreshes the access token using the refresh token
 */
async function refreshAccessToken(token) {
  try {
    // Check if this is a mock provider token
    if (token.provider === "mock-provider") {
      const tokenAge = Date.now() - (token.accessTokenExpires - (3600 * 1000));
      if (tokenAge > 60000) {
        throw new Error("Mock refresh token expired");
      }
      
      return {
        ...token,
        accessToken: `fake-access-token-${Date.now()}`,
        refreshToken: `fake-refresh-token-${Date.now()}`,
        accessTokenExpires: Date.now() + (3600 * 1000), // 1 hour from now
      };
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