// pages/api/auth/[...nextauth].ts
import NextAuth, { Account, Session, User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import KeycloakProvider from "next-auth/providers/keycloak";
import { JWT } from "next-auth/jwt";

export default NextAuth({
  providers: [
    // Keycloak provider
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_CLIENT_ID     ?? "",
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET    ?? "",
      issuer: "http://localhost:8080/realms/master",
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    }),

    // Custom provider for mock authentication in development
    CredentialsProvider({
      id: "mock-provider",
      name: "Mock Provider",
      credentials: {
        username: { label: "Username", type: "text", placeholder: "John Doe" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // You can return any mock user object here
        const user = {
          id: "1",
          name: "John Doe",
          email: "johndoe@example.com",
          image: "https://via.placeholder.com/150", // Fake profile image
        };

        // This is a mock authentication, so we ignore credentials and always return the mock user
        if (user) {
          return user;
        } else {
          return null;
        }
      },
    }),
  ],

  callbacks: {
    // Add access token, refresh token, and expiry to JWT
    async jwt({ token, user, account }) {
      // Initial sign in
      if (account && user) {
        // Save the initial token details in the JWT
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0, // Convert to ms
          id: user.id,
        };
      }

      // Return the previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires)) {
        return token;
      }

      // Access token has expired, try to refresh it
      return refreshAccessToken(token);
    },

    // Send token data to the client-side session
    async session({ session, token }) {
      // Add user info and token details to the session
      session.user = {
        ...session.user,
        id: token.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      };

      // Add access token to the session so client can use it
      session.accessToken = token.accessToken;
      session.error = token.error;

      return session;
    },
  },

  // Enable debug mode for easier development
  debug: process.env.NODE_ENV === "development",
  secret: process.env.NEXTAUTH_SECRET, // Secret for signing JWT

  // Token session settings
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    // maxAge: 60, // for testing purposes set it to 1 min
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
        client_id:     process.env.KEYCLOAK_CLIENT_ID     ?? "",
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
