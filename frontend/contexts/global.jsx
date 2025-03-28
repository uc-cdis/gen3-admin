import React, { createContext, useState, useEffect, useContext } from 'react';

// Create the context
const GlobalContext = createContext();

// Create the provider with local storage persistence
export const GlobalStateProvider = ({ children }) => {
  const [activeCluster, setActiveCluster] = useState('');

  // Load the active cluster from localStorage on initial render
  useEffect(() => {
    const savedCluster = localStorage.getItem('active-cluster');
    if (savedCluster) {
      setActiveCluster(savedCluster);
    }
  }, []);

  // Save the active cluster to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('active-cluster', activeCluster);
  }, [activeCluster]);

  return (
    <GlobalContext.Provider value={{ activeCluster, setActiveCluster }}>
      {children}
    </GlobalContext.Provider>
  );
};

// Create the consumer
export const useGlobalState = () => {
  return useContext(GlobalContext);
};