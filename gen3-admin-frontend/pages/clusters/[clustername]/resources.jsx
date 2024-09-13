import React, { useState, useEffect, useCallback } from 'react';
import { DataTable } from 'mantine-datatable';
import { Card, Text, Group, MultiSelect, Tabs, Badge } from '@mantine/core';
import callK8sAPI from '@/lib/k8s';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';

const resourceTypes = [
  { value: 'pods', label: 'Pods' },
  { value: 'deployments', label: 'Deployments' },
  { value: 'nodes', label: 'Nodes' },
  { value: 'replicasets', label: 'ReplicaSets' },
];

const K8sDashboard = () => {
  const [selectedResources, setSelectedResources] = useState(['pods']);
  const [resourceData, setResourceData] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pods');
  const [namespace] = useState('default');

  const { data } = useSession();
  const accessToken = data?.accessToken;
  const clusterName = useParams()?.clustername;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const newData = {};
      for (const resource of selectedResources) {
        let endpoint = `api/v1/namespaces/${namespace}/${resource}`;
        if (resource === 'deployments' || resource === 'replicasets') {
          endpoint = `apis/apps/v1/namespaces/${namespace}/${resource}`;
        } else if (resource === 'nodes') {
          endpoint = `api/v1/${resource}`;
        }
        const response = await callK8sAPI(endpoint, 'GET', null, null, clusterName, accessToken);
        newData[resource] = response.items;
      }
      setResourceData(newData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedResources, namespace, clusterName, accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // useEffect(() => {
  //   if (selectedResources.length > 0 && !selectedResources.includes(activeTab)) {
  //     setActiveTab(selectedResources[0]);
  //   }
  // }, [selectedResources, activeTab]);

  const handleResourceChange = (newSelectedResources) => {
    setSelectedResources(newSelectedResources);
    if (newSelectedResources.length > 0 && !newSelectedResources.includes(activeTab)) {
      setActiveTab(newSelectedResources[0]);
    }
  };

  const generateColumns = (resourceType) => {
    if (!resourceData[resourceType] || resourceData[resourceType].length === 0) return [];

    const columns = [
      { accessor: 'metadata.name', title: 'Name' },
      { accessor: 'metadata.namespace', title: 'Namespace' },
      {
        accessor: 'metadata.labels',
        title: 'Labels',
        render: (item) => (
          <Group spacing="xs">
            {Object.entries(item.metadata.labels || {}).map(([key, value]) => (
              <Badge key={key} size="sm">{`${key}: ${value}`}</Badge>
            ))}
          </Group>
        ),
      },
      {
        accessor: 'status.phase',
        title: 'Status',
        render: (item) => (
          <Text c={item.status?.phase === 'Running' ? 'green' : 'orange'}>
            {item.status?.phase || item.status?.conditions?.[0]?.type || 'N/A'}
          </Text>
        ),
      },
    ];

    // Add resource-specific columns
    if (resourceType === 'pods') {
      columns.push({ accessor: 'spec.nodeName', title: 'Node' });
    } else if (resourceType === 'deployments') {
      columns.push({ 
        accessor: 'spec.replicas', 
        title: 'Replicas',
        render: (item) => `${item.status.readyReplicas || 0}/${item.spec.replicas}`
      });
    } else if (resourceType === 'nodes') {
      columns.push({ 
        accessor: 'status.conditions', 
        title: 'Conditions',
        render: (item) => item.status.conditions.map(cond => 
          cond.status === 'True' ? <Badge key={cond.type} color="green">{cond.type}</Badge> : null
        )
      });
    }

    return columns;
  };

  return (
    <Card shadow="sm" padding="lg">
      <Group position="apart" mb="md">
        <Text size="xl" weight={500}>Kubernetes Dashboard</Text>
        <MultiSelect
          data={resourceTypes}
          value={selectedResources}
          onChange={handleResourceChange}
          label="Select Resources"
          placeholder="Choose resources to display"
        />
      </Group>
      <Tabs value={activeTab} onTabChange={setActiveTab}>
        <Tabs.List>
          {selectedResources.map((resource) => (
            <Tabs.Tab key={resource} value={resource}>
              {resource.charAt(0).toUpperCase() + resource.slice(1)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {selectedResources.map((resource) => (
          <Tabs.Panel key={resource} value={resource}>
            <DataTable
              columns={generateColumns(resource)}
              records={resourceData[resource] || []}
              fetching={loading}
              loaderVariant="dots"
              loaderBackgroundBlur={2}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Card>
  );
};

export default K8sDashboard;