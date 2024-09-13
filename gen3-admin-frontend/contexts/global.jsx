import React, { createContext, useState, useContext } from 'react';

// Create the context
const GlobalContext = createContext();

// Create the provider
export const GlobalStateProvider = ({ children }) => {
  const [activeCluster, setActiveCluster] = useState('');

  console.log('activeCluster', activeCluster);

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