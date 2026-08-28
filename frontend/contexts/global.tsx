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

  activeEnvAppName: string;
  setActiveEnvAppName: Dispatch<SetStateAction<string>>;

  activeClusterProvider: string;
  setActiveClusterProvider: Dispatch<SetStateAction<string>>;

  activeClusterK8sVersion: string;
  setActiveClusterK8sVersion: Dispatch<SetStateAction<string>>;

  /**
   * False until the values above have been read back from localStorage.
   *
   * State is restored inside an effect, so every value is empty on the first
   * render even when one is stored. Consumers that would otherwise report
   * "nothing selected" need to wait for this rather than acting on that gap.
   */
  hydrated: boolean;
};

const GlobalContext = createContext<GlobalContextType | null>(null);

type GlobalStateProviderProps = {
  children: ReactNode;
};

export const GlobalStateProvider = ({ children }: GlobalStateProviderProps) => {
  const [activeCluster, setActiveCluster] = useState<string>('');
  const [activeGlobalEnv, setActiveGlobalEnv] = useState<string>('');
  const [activeEnvManager, setActiveEnvManager] = useState<EnvManager>('');
  const [activeEnvAppName, setActiveEnvAppName] = useState<string>('');

  const [activeClusterProvider, setActiveClusterProvider] = useState<string>('');
  const [activeClusterK8sVersion, setActiveClusterK8sVersion] = useState<string>('');
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    const savedCluster = localStorage.getItem('active-cluster') || '';
    const savedEnv = localStorage.getItem('active-environment') || '';
    const savedManager = (localStorage.getItem('active-env-manager') as EnvManager) || '';
    const savedAppName = localStorage.getItem('active-env-app-name') || ''; // ✅ ADD THIS

    setActiveCluster(savedCluster);
    setActiveGlobalEnv(savedEnv);
    setActiveEnvManager(savedManager);
    setActiveEnvAppName(savedAppName);
    setActiveClusterProvider(localStorage.getItem('active-cluster-provider') || '');
    setActiveClusterK8sVersion(localStorage.getItem('active-cluster-k8s-version') || '');

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('active-cluster', activeCluster);
  }, [hydrated, activeCluster]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('active-environment', activeGlobalEnv);
  }, [hydrated, activeGlobalEnv]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('active-env-manager', activeEnvManager);
  }, [hydrated, activeEnvManager]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('active-env-app-name', activeEnvAppName);
  }, [hydrated, activeEnvAppName]);

  // Persist effects are gated on `hydrated`: without that guard the initial
  // empty state is written over the stored values before restore runs.
  // These two were also memory-only before, so they reset on every reload.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('active-cluster-provider', activeClusterProvider);
  }, [hydrated, activeClusterProvider]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('active-cluster-k8s-version', activeClusterK8sVersion);
  }, [hydrated, activeClusterK8sVersion]);

  const value: GlobalContextType = {
    hydrated,
    activeCluster,
    setActiveCluster,
    activeGlobalEnv,
    setActiveGlobalEnv,
    activeEnvManager,
    setActiveEnvManager,
    activeEnvAppName,
    setActiveEnvAppName,
    activeClusterProvider,
    setActiveClusterProvider,
    activeClusterK8sVersion,
    setActiveClusterK8sVersion,
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
