// frontend/lib/keycloak.js
import Keycloak from 'keycloak-js';

const keycloakConfig = {
  url: process.env.NEXT_PUBLIC_KEYCLOAK_URL,
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM,
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID,
};

// Debug log to check if environment variables are loaded
if (typeof window !== 'undefined') {
  console.log('Keycloak Config:', {
    url: process.env.NEXT_PUBLIC_KEYCLOAK_URL,
    realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM,
    clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID,
  });
}

let keycloak;

if (typeof window !== 'undefined') {
  // Validate required configuration
  if (!keycloakConfig.url || !keycloakConfig.realm || !keycloakConfig.clientId) {
    console.error('Missing Keycloak configuration:', keycloakConfig);
    throw new Error('Keycloak configuration is incomplete. Check your environment variables.');
  }
  
  keycloak = new Keycloak(keycloakConfig);
}

let isInitialized = false;

export const initKeycloak = () => {
  if (!keycloak) {
    console.error('Keycloak not initialized - running on server side?');
    return Promise.resolve(false);
  }

  if (!isInitialized) {
    isInitialized = true;
    return keycloak
      .init({ 
        onLoad: 'login-required', 
        checkLoginIframe: false,
        pkceMethod: 'S256' // Enable PKCE for public clients
      })
      .then(authenticated => {
        console.log('Keycloak initialized, authenticated:', authenticated);
        return authenticated;
      })
      .catch(err => {
        isInitialized = false;
        console.error('Failed to initialize Keycloak', err);
        throw err;
      });
  }
  return Promise.resolve(keycloak?.authenticated ?? false);
};

export const logout = () => {
  if (keycloak) {
    keycloak.logout({
      redirectUri: window.location.origin
    });
  }
};

export const getToken = async () => {
  if (keycloak) {
    if (keycloak.isTokenExpired()) {
      try {
        await keycloak.updateToken(30);
      } catch (error) {
        console.error('Failed to refresh the token', error);
        keycloak.logout();
        return null;
      }
    }
    return keycloak.token ?? null;
  }
  return null;
};

export const getUserInfo = () => {
  if (keycloak && keycloak.tokenParsed) {
    return {
      id: keycloak.tokenParsed.sub,
      username: keycloak.tokenParsed.preferred_username,
      email: keycloak.tokenParsed.email,
      name: keycloak.tokenParsed.name,
      firstName: keycloak.tokenParsed.given_name,
      lastName: keycloak.tokenParsed.family_name,
    };
  }
  return null;
};

export default keycloak;
