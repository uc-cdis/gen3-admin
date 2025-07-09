import React, { createContext, useState, useEffect, useContext } from 'react';

// Create the context with default values
const GlobalContext = createContext({
  activeCluster: '',
  setActiveCluster: () => {},
  activeGlobalEnv: '',
  setActiveGlobalEnv: () => {}
});

// Create the provider with persistence
export const GlobalStateProvider = ({ children }) => {
  const [activeCluster, setActiveCluster] = useState('');
  const [activeGlobalEnv, setActiveGlobalEnv] = useState('');

  // Load saved values on initial render
  useEffect(() => {
    const savedCluster = localStorage.getItem('active-cluster') || '';
    const savedEnv = localStorage.getItem('active-environment') || '';

    setActiveCluster(savedCluster);
    setActiveGlobalEnv(savedEnv);
  }, []);

  // Save values whenever they change
  useEffect(() => {
    localStorage.setItem('active-cluster', activeCluster);
  }, [activeCluster]);

  useEffect(() => {
    localStorage.setItem('active-environment', activeGlobalEnv);
  }, [activeGlobalEnv]);

  const value = {
    activeCluster,
    setActiveCluster,
    activeGlobalEnv,
    setActiveGlobalEnv
  };

  return (
    <GlobalContext.Provider value={value}>
      {children}
    </GlobalContext.Provider>
  );
};

// Custom hook with error handling
export const useGlobalState = () => {
  const context = useContext(GlobalContext);

  if (!context) {
    throw new Error('useGlobalState must be used within a GlobalStateProvider');
  }

  return context;
};

// Optional: Individual hooks for specific values
export const useActiveCluster = () => {
  const { activeCluster, setActiveCluster } = useGlobalState();
  return [activeCluster, setActiveCluster];
};

export const useActiveGlobalEnv = () => {
  const { activeGlobalEnv, setActiveGlobalEnv } = useGlobalState();
  return [activeGlobalEnv, setActiveGlobalEnv];
};
