import { useGlobalState } from '@/contexts/global';

import { useState, useEffect } from 'react';
import { Select, Text, Group, Button, rem, useMantineTheme } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

import classes from './EnvSelector.module.css';

import { useSession } from "next-auth/react"

import { callGoApi } from '@/lib/k8s';

export function EnvSelector() {
  const [clusters, setClusters] = useState([]);
  const { activeCluster, setActiveCluster } = useGlobalState();
  // const [activeCluster, setActiveCluster] = useState('');
  const [env, setEnv] = useState('default');
  const theme = useMantineTheme();

  const { data: session } = useSession();
  // Get token from next-auth 

  const fetchClusters = async () => {
    try {
      const data = await callGoApi('/agents', 'GET', null, null, session.accessToken)
      // Only show clusters that are active
      setClusters(data.filter(cluster => cluster.connected))
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    fetchClusters();
  }, [session]);

  useEffect(() => {
    console.log('activeCluster: ', activeCluster)
  }, [activeCluster]);

  return (
    <Group>
      <Select
        value={activeCluster}
        onChange={setActiveCluster}
        placeholder="Select a cluster"
        data={clusters.map(cluster => cluster?.metadata?.name)}
        rightSection={<IconChevronDown size={14} />}
        styles={(theme) => ({
          rightSection: { pointerEvents: 'none' },
          input: {
            fontWeight: 500,
            '&[dataSelected]': {
              backgroundColor: theme.colors.blue[7],
              color: theme.white
            }
          }
        })}
        className={classes.clusterSelect}
      />
      {/* <Select
        value={env}
        onChange={setEnv}
        placeholder="Select an environment"
        data={['default']} // Add your actual clusters here
        rightSection={<IconChevronDown size={14} />}
        styles={(theme) => ({
          rightSection: { pointerEvents: 'none' },
          input: {
            fontWeight: 500,
            '&[dataSelected]': {
              backgroundColor: theme.colors.blue[7],
              color: theme.white
            }
          }
        })}
        className={classes.clusterSelect}
      /> */}
    </Group>
  );
}