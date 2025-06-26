import React, { createContext, useState, useEffect, useContext } from 'react';

// Create the context
const GlobalContext = createContext();

// Create the provider with local storage persistence
export const GlobalStateProvider = ({ children }) => {
  const [activeCluster, setActiveCluster] = useState('');
  const [activeGlobalEnv, setActiveGlobalEnv] = useState('');

  // Load the active cluster from localStorage on initial render
  useEffect(() => {
    const savedCluster = localStorage.getItem('active-cluster');
    const savedEnv = localStorage.getItem('active-environment');
    if (savedCluster) {
      setActiveCluster(savedCluster);
    }
    if (savedEnv) {
      setActiveGlobalEnv(savedEnv);
    }
  }, []);

  // Save the active cluster to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('active-cluster', activeCluster);
    localStorage.setItem('active-environment', activeGlobalEnv);
  }, [activeCluster, activeGlobalEnv]);

  return (
    <GlobalContext.Provider value={{ activeCluster, setActiveCluster, activeGlobalEnv, setActiveGlobalEnv }}>
      {children}
    </GlobalContext.Provider>
  );
};

// Create the consumer
export const useGlobalState = () => {
  return useContext(GlobalContext);
};