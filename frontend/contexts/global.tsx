import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  ReactNode,
  Dispatch,
  SetStateAction,
} from 'react';

type EnvManager = 'helm' | 'argocd' | '';

type GlobalContextType = {
  activeCluster: string;
  setActiveCluster: Dispatch<SetStateAction<string>>;

  activeGlobalEnv: string;
  setActiveGlobalEnv: Dispatch<SetStateAction<string>>;

  activeEnvManager: EnvManager;
  setActiveEnvManager: Dispatch<SetStateAction<EnvManager>>;

  activeEnvAppName: string;                         // ✅ ADD THIS
  setActiveEnvAppName: Dispatch<SetStateAction<string>>; // ✅ ADD THIS
};

const GlobalContext = createContext<GlobalContextType | null>(null);

type GlobalStateProviderProps = {
  children: ReactNode;
};

export const GlobalStateProvider = ({ children }: GlobalStateProviderProps) => {
  const [activeCluster, setActiveCluster] = useState<string>('');
  const [activeGlobalEnv, setActiveGlobalEnv] = useState<string>('');
  const [activeEnvManager, setActiveEnvManager] = useState<EnvManager>('');
  const [activeEnvAppName, setActiveEnvAppName] = useState<string>('');   // ✅ ADD THIS

  useEffect(() => {
    const savedCluster = localStorage.getItem('active-cluster') || '';
    const savedEnv = localStorage.getItem('active-environment') || '';
    const savedManager = (localStorage.getItem('active-env-manager') as EnvManager) || '';
    const savedAppName = localStorage.getItem('active-env-app-name') || ''; // ✅ ADD THIS

    setActiveCluster(savedCluster);
    setActiveGlobalEnv(savedEnv);
    setActiveEnvManager(savedManager);
    setActiveEnvAppName(savedAppName);                                      // ✅ ADD THIS
  }, []);

  useEffect(() => {
    localStorage.setItem('active-cluster', activeCluster);
  }, [activeCluster]);

  useEffect(() => {
    localStorage.setItem('active-environment', activeGlobalEnv);
  }, [activeGlobalEnv]);

  useEffect(() => {
    localStorage.setItem('active-env-manager', activeEnvManager);
  }, [activeEnvManager]);

  useEffect(() => {
    localStorage.setItem('active-env-app-name', activeEnvAppName);          // ✅ ADD THIS
  }, [activeEnvAppName]);

  const value: GlobalContextType = {
    activeCluster,
    setActiveCluster,
    activeGlobalEnv,
    setActiveGlobalEnv,
    activeEnvManager,
    setActiveEnvManager,
    activeEnvAppName,
    setActiveEnvAppName,
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

export const useActiveEnvManager = (): [EnvManager, Dispatch<SetStateAction<EnvManager>>] => {
  const { activeEnvManager, setActiveEnvManager } = useGlobalState();
  return [activeEnvManager, setActiveEnvManager];
};

export const useActiveEnvAppName = (): [string, Dispatch<SetStateAction<string>>] => {
  const { activeEnvAppName, setActiveEnvAppName } = useGlobalState();
  return [activeEnvAppName, setActiveEnvAppName];
};
