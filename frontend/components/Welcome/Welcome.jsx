import { useEffect, useState } from 'react'

import { callGoApi } from '@/lib/k8s';

import { useSession } from "next-auth/react"

import { useGlobalState } from '@/contexts/global';
import { OnboardingStepper } from './OnboardingStepper';
import { Center, Stack, Title, Text, Loader, Alert } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

export function Welcome() {
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const { activeCluster, setActiveCluster } = useGlobalState("null");
  const [clusters, setClusters] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchClusters = async () => {
    setLoading(true)
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken)
      const connectedClusterNames = data
        .filter(cluster => cluster.connected)
        .map(cluster => cluster.name);
      setClusters(connectedClusterNames)
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
    } finally {
      setLoading(false)
    }
  };

  useEffect(() => {
    if(!accessToken) return
    fetchClusters(accessToken)
  }, [accessToken]);

  if (!accessToken || loading) {
    return (
      <Center h="60vh">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text c="dimmed">Checking for connected agents...</Text>
        </Stack>
      </Center>
    );
  }

  if (clusters.length > 0) {
    return (
      <Center h="60vh">
        <Stack align="center" gap="lg" maw={600}>
          <IconInfoCircle size={48} stroke={1.5} color="var(--mantine-color-blue-6)" />
          <Title order={2}>Select an Environment</Title>
          <Text ta="center" c="dimmed">
            You have {clusters.length} connected agent{clusters.length !== 1 ? 's' : ''}.
            Use the environment selector in the header to choose one, or navigate to the
            Clusters page to manage your agents.
          </Text>
          <Alert variant="light" color="blue" title="Connected agents">
            {clusters.join(', ')}
          </Alert>
        </Stack>
      </Center>
    );
  }

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
