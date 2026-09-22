import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { initKeycloak, keycloak, logout } from "@/lib/keycloak";


const KeycloakContext = createContext({
  initialized: false,
  authenticated: false,
  user: null,
  logout: () => { },
});


export const KeycloakProvider = ({ children }) => {
  const [initialized, setInitialized] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      initKeycloak()
        .then(auth => {
          setAuthenticated(auth);
          if (keycloak && auth) {
            setUser({
              name: keycloak.tokenParsed?.preferred_username,
              email: keycloak.tokenParsed?.email,
            });
          }
          setInitialized(true);
        })
        .catch(err => console.error('Failed to initialize Keycloak', err));
    }
  }, []);


  const value = useMemo(
    () => ({ initialized, authenticated, user, logout }),
    [initialized, authenticated, user]
  );

  return (
    <KeycloakContext.Provider value={value}>
      {children}
    </KeycloakContext.Provider>
  );
};

export const useKeycloak = () => useContext(KeycloakContext);
