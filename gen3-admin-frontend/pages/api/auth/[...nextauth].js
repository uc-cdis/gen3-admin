import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getCookie, setCookie, deleteCookie } from 'cookies-next';

// Function to parse JWT token
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error parsing JWT:', error);
    return null;
  }
}

// NextAuth configuration
const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'API Key',
      credentials: {
        apiKey: { label: 'API Key', type: 'text' },
      },
      async authorize(credentials, req) {
        try {
          const apiKeyData = credentials;
          
          if (!apiKeyData || !apiKeyData.apiKey) {
            throw new Error('Invalid API key data');
          }

          const parsedToken = parseJwt(apiKeyData.apiKey);
          if (!parsedToken || !parsedToken.iss) {
            throw new Error('Unable to extract URL from API key');
          }

          const baseUrl = parsedToken.iss;
          const fenceApiUrl = `${baseUrl}/credentials/api/access_token`;

          const response = await fetch(fenceApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              api_key: apiKeyData.apiKey,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const json = await response.json();
          const { access_token } = json;

          // Validate the token
          const payload = parseJwt(access_token);

          if (!payload) {
            throw new Error('Invalid access token');
          }

          // Set cookie for access token
          setCookie('access_token', access_token);

          return { ...payload, accessToken: access_token };
        } catch (error) {
          console.error('Authorization error:', error);
          deleteCookie('access_token');
          return null;
        }
      },
    }),
  ],
  // Callbacks and other configurations
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken;
        token.user = user;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.user = token.user;
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
};

export default NextAuth(authOptions);
