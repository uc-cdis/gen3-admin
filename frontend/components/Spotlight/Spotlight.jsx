import { Spotlight } from '@mantine/spotlight';

import { Text, rem } from '@mantine/core';
import { IconHome, IconSettings, IconServer, IconKey, IconFile, IconGauge, IconStar, IconLock, IconSearch } from '@tabler/icons-react';

import '@mantine/spotlight/styles.css';


import { useRouter } from 'next/router';

export default function SpotlightComponent() {

    const router = useRouter(); // Initialize the router from Next.js

    const activeCluster  = "kind"

    const actions = [
        {
            id: 'pods',
            label: 'Pods',
            description: 'View and manage all Kubernetes pods within your cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/workloads/pods`),
            leftSection: <IconHome size={18} />,
        },
        {
            id: 'deployments',
            label: 'Deployments',
            description: 'Manage deployment configurations, scaling, and rollout statuses',
            onClick: () => {console.log("hello"); router.push(`/clusters/${activeCluster}/workloads/deployments`)},
            leftSection: <IconSettings size={18} />,
        },
        {
            id: 'daemonsets',
            label: 'DaemonSets',
            description: 'Oversee and control daemon sets across your entire cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/workloads/daemonsets`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'StatefulSets',
            description: 'Handle stateful applications and manage persistent workloads',
            onClick: () => router.push(`/clusters/${activeCluster}/workloads/statefulsets`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'ReplicaSets',
            description: 'Control replica sets to ensure consistent scaling of pods',
            onClick: () => router.push(`/clusters/${activeCluster}/workloads/replicasets`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'Jobs',
            description: 'Monitor and manage batch jobs and their executions',
            onClick: () => router.push(`/clusters/${activeCluster}/workloads/jobs`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'CronJobs',
            description: 'Schedule and automate recurring tasks with cron jobs',
            onClick: () => router.push(`/clusters/${activeCluster}/workloads/cronjobs`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'Services',
            description: 'View and manage network services exposed by your cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/network/services`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'Ingresses',
            description: 'Configure and control external access to services in your cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/network/ingresses`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'Endpoints',
            description: 'Monitor service endpoints and their connections',
            onClick: () => router.push(`/clusters/${activeCluster}/network/endpoints`),
            leftSection: <IconSettings size={18} />,
        },
        {
            label: 'Nodes',
            description: 'View and manage nodes in your Kubernetes cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/cluster/nodes`),
            leftSection: <IconServer size={18} />,
        },
        {
            label: 'Namespaces',
            description: 'View and manage namespaces within the cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/cluster/namespaces`),
            leftSection: <IconServer size={18} />,
        },
        {
            label: 'Secrets',
            description: 'Manage sensitive information such as Kubernetes secrets',
            onClick: () => router.push(`/clusters/${activeCluster}/configurations/secrets`),
            leftSection: <IconKey size={18} />,
        },
        {
            label: 'ConfigMaps',
            description: 'View and manage configuration data stored in ConfigMaps',
            onClick: () => router.push(`/clusters/${activeCluster}/configurations/configmaps`),
            leftSection: <IconFile size={18} />,
        },
        {
            label: 'Horizontal Pod Autoscalers (HPA)',
            description: 'Monitor and configure pod autoscalers in the cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/configurations/hpa`),
            leftSection: <IconGauge size={18} />,
        },
        {
            label: 'Priority Classes',
            description: 'Manage priority classes for workloads within the cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/configurations/priorityclasses`),
            leftSection: <IconStar size={18} />,
        },
        {
            label: 'Runtime Classes',
            description: 'View and configure runtime classes for the Kubernetes cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/configurations/runtimeclasses`),
            leftSection: <IconStar size={18} />,
        },
        {
            label: 'Pod Disruption Budgets',
            description: 'Manage pod disruption budgets to ensure workload stability',
            onClick: () => router.push(`/clusters/${activeCluster}/configurations/poddisruptionbudgets`),
            leftSection: <IconStar size={18} />,
        },
        {
            label: 'Service Accounts',
            description: 'Manage service accounts for access control within the cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/access-control/serviceaccounts`),
            leftSection: <IconLock size={18} />,
        },
        {
            label: 'Roles',
            description: 'View and manage roles for RBAC (Role-Based Access Control)',
            onClick: () => router.push(`/clusters/${activeCluster}/access-control/roles`),
            leftSection: <IconLock size={18} />,
        },
        {
            label: 'Role Bindings',
            description: 'Bind roles to users or groups to control access',
            onClick: () => router.push(`/clusters/${activeCluster}/access-control/rolebindings`),
            leftSection: <IconLock size={18} />,
        },
        {
            label: 'Cluster Roles',
            description: 'View and manage cluster-wide roles for access control',
            onClick: () => router.push(`/clusters/${activeCluster}/access-control/clusterroles`),
            leftSection: <IconLock size={18} />,
        },
        {
            label: 'Cluster Role Bindings',
            description: 'Bind cluster-wide roles to users or groups for access control',
            onClick: () => router.push(`/clusters/${activeCluster}/access-control/clusterrolebindings`),
            leftSection: <IconLock size={18} />,
        },
        {
            label: 'Persistent Volume Claims',
            description: 'Manage persistent storage claims within your cluster',
            onClick: () => router.push(`/clusters/${activeCluster}/storage/persistentvolumeclaims`),
            leftSection: <IconFile size={18} />,
        },
        {
            label: 'Persistent Volumes',
            description: 'View and manage persistent storage volumes',
            onClick: () => router.push(`/clusters/${activeCluster}/storage/persistentvolumes`),
            leftSection: <IconFile size={18} />,
        },
        {
            label: 'Storage Classes',
            description: 'Manage storage classes to handle different storage policies',
            onClick: () => router.push(`/clusters/${activeCluster}/storage/storageclasses`),
            leftSection: <IconFile size={18} />,
        },
    ];
    return (
        <Spotlight
            actions={actions}
            highlightQuery
            searchProps={{
                leftSection: <IconSearch style={{ width: rem(20), height: rem(20) }} stroke={1.5} />,
                placeholder: 'Search...',
              }}      
            shortcut="mod+k"
            nothingFoundMessage="Nothing found..."
        >
            <Text>Press Cmd + K or Ctrl + K to open the Spotlight search</Text>
        </Spotlight>
    );
}
