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
          scope: "openid profile email", // Explicitly request these scopes
        }
      },
      profile(profile) {
        console.log("Keycloak profile:", profile); // Debug log
        return {
          id: profile.sub,
          name: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim() || profile.preferred_username,
          email: profile.email,
          image: profile.picture,
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
          return user;
        } else {
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, account }) {
      // Initial sign in
      if (account && user) {

        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0,
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.image,
        };
      }

      // Return the previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires)) {
        return token;
      }

      // For public clients, we typically don't refresh tokens
      // If you need refresh functionality, you'd need a confidential client
      return refreshAccessToken(token);
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.id,
        name: token.name,
        email: token.email,
        image: token.picture,
      };

      session.accessToken = token.accessToken;
      session.error = token.error;

      return session;
    },
  },

  // Enable debug mode for easier development
  debug: process.env.NODE_ENV === "development",
  secret: process.env.NEXTAUTH_SECRET,

  // Token session settings
  session: {
    strategy: "jwt",
    // maxAge: 30 * 24 * 60 * 60, // 30 days
    maxAge: 60 * 15
  },
});

/**
 * Refreshes the access token using the refresh token
 */
async function refreshAccessToken(token) {
  try {
    // Get the refresh URL from your Keycloak server
    const url = `http://localhost:8080/realms/master/protocol/openid-connect/token`;

    // Make refresh token request
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
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken, // Use new refresh token if available
      accessTokenExpires: Date.now() + (refreshedTokens.expires_in * 1000),
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
