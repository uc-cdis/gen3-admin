import { Title, Text, Anchor } from '@mantine/core';
import Link from 'next/link';

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
  const [loading, setLoading] = useState(false)

  const fetchClusters = async () => {
    setLoading(true)
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken)
      // Only show clusters that are active
      // setClusters(data.filter(cluster => cluster.connected))
      const connectedClusterNames = data
        .filter(cluster => cluster.connected)
        .map(cluster => cluster.name);

      console.log(connectedClusterNames);
      setClusters(connectedClusterNames)
      setLoading(false)
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
      setLoading(false)
    }
  };

  useEffect(() => {
    if(!accessToken) return
    fetchClusters(accessToken)
  }, [accessToken]);


  return (
    <>
      <Title style={{ fontSize: 100, fontWeight: 900, letterSpacing: -2 }} ta="center" mt={100}>
        <Text inherit variant="gradient" component="span" gradient={{ from: 'pink', to: 'yellow' }}>
          Gen3
        </Text>
        {' '} CSOC
      </Title>


      {clusters.length == 0 ? (
        <OnboardingStepper
          accessToken={accessToken}
          onComplete={(agentName) => {
            setActiveCluster(agentName);
            fetchClusters();
          }}
        />
      ) : (
        <>
          <Text c="dimmed" ta="center" size="lg" maw={580} mx="auto" mt="xl">
            Welcome to the Gen3 CSOC dashboard for cluster <b>{activeCluster}</b>!

            <br />
            <br />
            <Anchor component={Link} href="/projects">
              Manage existing deployments
            </Anchor>{' '}
            or{' '}
            <Anchor component={Link} href="/helm/gen3/deploy">
              deploy a new Gen3 to this cluster
            </Anchor>.
            <br />
            <br />
            If you want to import new clusters{' '}
            <Anchor component={Link} href="/clusters?import=true">
              click here
            </Anchor>.

          </Text>

        </>
      )}

    </>
  );
}
