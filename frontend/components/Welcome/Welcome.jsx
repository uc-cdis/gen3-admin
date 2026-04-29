import { useEffect, useState } from 'react'

import { callGoApi } from '@/lib/k8s';

import { useSession } from "next-auth/react"

import { useGlobalState } from '@/contexts/global';
import { OnboardingStepper } from './OnboardingStepper';

export function Welcome() {
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const { activeCluster, setActiveCluster } = useGlobalState("null");
  const [clusters, setClusters] = useState([])

  const fetchClusters = async () => {
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken)
      const connectedClusterNames = data
        .filter(cluster => cluster.connected)
        .map(cluster => cluster.name);
      setClusters(connectedClusterNames)
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
    }
  };

  useEffect(() => {
    if(!accessToken) return
    fetchClusters(accessToken)
  }, [accessToken]);

  return (
    <OnboardingStepper
      accessToken={accessToken}
      onComplete={(agentName) => {
        setActiveCluster(agentName);
        fetchClusters();
      }}
    />
  );
}
