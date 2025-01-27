import React, { useState, useEffect } from 'react';
import { Navbar, Group, Tooltip, UnstyledButton, Text, Accordion, ScrollArea } from '@mantine/core';
import { IconNotes, IconChartBar, IconPentagonNumber3, IconGauge, IconStar, IconServer, IconSettings, IconKey, IconFile, IconWheel, IconShip, IconLock, IconNetwork, IconEye, IconSearch, IconDatabase, IconSwitchHorizontal, IconLogout } from '@tabler/icons-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { callGoApi } from '@/lib/k8s';

export const NavBar = () => {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;
  const [activeCluster, setActiveCluster] = useState(0);
  const [clusters, setClusters] = useState([]);

  const fetchClusters = async () => {
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken);
      setClusters(data.filter(cluster => cluster.connected));
      setActiveCluster(data.filter(cluster => cluster.connected)[0].name);
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
    }
  };

  useEffect(() => {
    fetchClusters(accessToken);
  }, [accessToken]);

  const links = [
    { label: 'Gen3', icon: IconPentagonNumber3, links: [
      { label: 'Helm deployments', link: '/projects', icon: IconChartBar },
      { label: 'Deploy Gen3', link: '/helm/gen3/deploy', icon: IconPentagonNumber3 },
      { label: 'Agents', link: `/clusters/`, icon: IconChartBar },
      { label: 'Jobs', link: `/clusters/${activeCluster}/cronjobs`, icon: IconChartBar },
      { label: 'Workspaces', link: `/clusters/${activeCluster}/workspaces`, icon: IconChartBar },
    ]},
    { label: 'Helm', icon: IconWheel, links: [
      { label: 'Deploy Gen3', link: '/helm/gen3/deploy', icon: IconPentagonNumber3 },
      { label: 'App Store', link: '/helm/repo/bitnami', icon: IconChartBar },
      { label: 'Deployments', link: '/projects', icon: IconChartBar },
    ]},
    { label: 'Kubernetes', icon: IconShip, links: [
      { label: 'Cluster', icon: IconShip, links: [
        { label: 'Nodes', link: `/clusters/${activeCluster}/cluster/nodes` },
        { label: 'Namespaces', link: `/clusters/${activeCluster}/cluster/namespaces` },
      ]},
      { label: 'Workloads', icon: IconShip, links: [
        { label: 'Pods', link: `/clusters/${activeCluster}/workloads/pods` },
        { label: 'Deployments', link: `/clusters/${activeCluster}/workloads/deployments` },
        { label: 'DaemonSets', link: `/clusters/${activeCluster}/workloads/daemonsets` },
        { label: 'StatefulSets', link: `/clusters/${activeCluster}/workloads/statefulsets` },
        { label: 'ReplicaSets', link: `/clusters/${activeCluster}/workloads/replicasets` },
        { label: 'Jobs', link: `/clusters/${activeCluster}/workloads/jobs` },
        { label: 'CronJobs', link: `/clusters/${activeCluster}/workloads/cronjobs` },
      ]},
      { label: 'Configurations', icon: IconSettings, links: [
        { label: 'Secrets', link: `/clusters/${activeCluster}/configurations/secrets`, icon: IconKey },
        { label: 'ConfigMaps', link: `/clusters/${activeCluster}/configurations/configmaps`, icon: IconFile },
        { label: 'HPA', link: `/clusters/${activeCluster}/configurations/hpa`, icon: IconGauge },
        { label: 'Priority Classes', link: `/clusters/${activeCluster}/configurations/priorityclasses`, icon: IconStar },
        { label: 'Runtime Classes', link: `/clusters/${activeCluster}/configurations/runtimeclasses`, icon: IconStar },
        { label: 'Pod Disruption Budgets', link: `/clusters/${activeCluster}/configurations/poddisruptionbudgets`, icon: IconStar },
      ]},
      { label: 'Access Control', icon: IconLock, links: [
        { label: 'Service Accounts', link: `/clusters/${activeCluster}/access-control/serviceaccounts` },
        { label: 'Roles', link: `/clusters/${activeCluster}/access-control/roles` },
        { label: 'Role Bindings', link: `/clusters/${activeCluster}/access-control/rolebindings` },
        { label: 'Cluster Roles', link: `/clusters/${activeCluster}/access-control/clusterroles` },
        { label: 'Cluster Role Bindings', link: `/clusters/${activeCluster}/access-control/clusterrolebindings` },
      ]},
      { label: 'Network', icon: IconNetwork, links: [
        { label: 'Services', link: `/clusters/${activeCluster}/network/services` },
        { label: 'Ingresses', link: `/clusters/${activeCluster}/network/ingresses` },
        { label: 'Endpoints', link: `/clusters/${activeCluster}/network/endpoints` },
      ]},
      { label: 'Storage', icon: IconServer, links: [
        { label: 'Persistent Volume Claims', link: `/clusters/${activeCluster}/storage/persistentvolumeclaims`, icon: IconFile },
        { label: 'Persistent Volumes', link: `/clusters/${activeCluster}/storage/persistentvolumes`, icon: IconFile },
        { label: 'Storage Classes', link: `/clusters/${activeCluster}/storage/storageclasses`, icon: IconFile },
      ]},
    ]},
    { label: 'Databases', icon: IconSearch, links: [
      { label: 'Search Clusters', link: `/elasticsearch/`, icon: IconSearch },
      { label: 'Search Indices', link: `/elasticsearch/`, icon: IconSearch },
      { label: 'SQL Databases', link: `/databases/`, icon: IconDatabase },
    ]},
    { label: 'Observability', icon: IconEye, links: [
      { label: 'Monitors', link: '/observability/monitors' },
      { label: 'Dashboards', link: '/observability/dashboards' },
    ]},
    { label: 'Cloud', icon: IconNetwork, links: [
      { label: 'Accounts', link: `/cloud/accounts`, icon: IconChartBar },
      { label: 'Spend', link: `/cloud/spend`, icon: IconChartBar },
    ]},
  ];

  return (
    <Navbar p="md" width={{ base: 300 }} className="double-navbar">
      <Navbar.Section grow component={ScrollArea}>
        <Accordion variant="separated" defaultValue="gen3">
          {links.map(({ label, icon: Icon, links: childLinks }) => (
            <Accordion.Item key={label} value={label.toLowerCase()}>
              <Accordion.Control
                icon={Icon && <Icon size={20} />}
              >
                <Text>{label}</Text>
              </Accordion.Control>
              <Accordion.Panel>
                {childLinks.map(({ label, link, icon: ChildIcon }) => (
                  <Navbar.Link
                    key={label}
                    icon={ChildIcon && <ChildIcon size={16} />}
                    label={label}
                    href={link}
                  />
                ))}
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Navbar.Section>

      <Navbar.Section>
        <Group position="center">
          <Tooltip label="Change account" position="right">
            <UnstyledButton component="a" href="/auth/switch">
              <IconSwitchHorizontal size={20} />
            </UnstyledButton>
          </Tooltip>
          <Tooltip label="Logout" position="right">
            <UnstyledButton component="a" href="/auth/logout">
              <IconLogout size={20} />
            </UnstyledButton>
          </Tooltip>
        </Group>
      </Navbar.Section>
    </Navbar>
  );
};