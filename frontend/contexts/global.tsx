import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  ReactNode,
  Dispatch,
  SetStateAction,
} from 'react';

type GlobalContextType = {
  activeCluster: string;
  setActiveCluster: Dispatch<SetStateAction<string>>;
  activeGlobalEnv: string;
  setActiveGlobalEnv: Dispatch<SetStateAction<string>>;
};

const GlobalContext = createContext<GlobalContextType | null>(null);

type GlobalStateProviderProps = {
  children: ReactNode;
};

export const GlobalStateProvider = ({ children }: GlobalStateProviderProps) => {
  const [activeCluster, setActiveCluster] = useState<string>('');
  const [activeGlobalEnv, setActiveGlobalEnv] = useState<string>('');

  useEffect(() => {
    const savedCluster = localStorage.getItem('active-cluster') || '';
    const savedEnv = localStorage.getItem('active-environment') || '';

    setActiveCluster(savedCluster);
    setActiveGlobalEnv(savedEnv);
  }, []);

  useEffect(() => {
    localStorage.setItem('active-cluster', activeCluster);
  }, [activeCluster]);

  useEffect(() => {
    localStorage.setItem('active-environment', activeGlobalEnv);
  }, [activeGlobalEnv]);

  const value: GlobalContextType = {
    activeCluster,
    setActiveCluster,
    activeGlobalEnv,
    setActiveGlobalEnv,
  };

  return <GlobalContext.Provider value={value}>{children}</GlobalContext.Provider>;
};

export const useGlobalState = () => {
  const context = useContext(GlobalContext);

  if (!context) {
    throw new Error('useGlobalState must be used within a GlobalStateProvider');
  }

  return context;
};

export const useActiveCluster = (): [string, Dispatch<SetStateAction<string>>] => {
  const { activeCluster, setActiveCluster } = useGlobalState();
  return [activeCluster, setActiveCluster];
};

export const useActiveGlobalEnv = (): [string, Dispatch<SetStateAction<string>>] => {
  const { activeGlobalEnv, setActiveGlobalEnv } = useGlobalState();
  return [activeGlobalEnv, setActiveGlobalEnv];
};
