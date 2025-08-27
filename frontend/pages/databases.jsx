import { Container, Skeleton, Title, Text, Select, Button, Alert, LoadingOverlay, Modal, Group } from "@mantine/core";
import dynamic from 'next/dynamic'
import { useState, useEffect, useContext, useRef } from "react";
import { IconDatabase, IconAlertCircle, IconCheck } from '@tabler/icons-react';

const Terminal = dynamic(() => import('@/components/Shell/Terminal'), {
    ssr: false
})

import callK8sApi from '@/lib/k8s';
import { get } from "lodash";
import { useGlobalState } from '@/contexts/global';

import { useSession } from "next-auth/react";
import Link from "next/link";

export default function Databases() {
    // Get current context (environment, cluster, namespace, etc.)
    const { activeGlobalEnv } = useGlobalState();

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    // Parse the activeGlobalEnv to get agent and namespace
    let [env, namespace] = activeGlobalEnv ? activeGlobalEnv.split("/") : [null, null];

    // env is the agent/cluster name
    const clusterName = env;

    // useState for database secrets
    const [databaseSecrets, setDatabaseSecrets] = useState([]);
    const [selectedDatabase, setSelectedDatabase] = useState(null);
    const [selectData, setSelectData] = useState([]);
    const [loading, setLoading] = useState(false);

    const [modalOpened, setModalOpened] = useState(false);

    // Refs for DOM manipulation
    const iframeRef = useRef(null);
    const normalContainerRef = useRef(null);
    const modalContainerRef = useRef(null);

    // PgWeb states
    const [pgwebStatus, setPgwebStatus] = useState(null); // null, 'launching', 'running', 'error'
    const [pgwebError, setPgwebError] = useState(null);
    const [pgwebUrl, setPgwebUrl] = useState(null);
    const [pollingInterval, setPollingInterval] = useState(null);

    // Effect to move iframe between containers
    useEffect(() => {
        if (iframeRef.current && normalContainerRef.current && modalContainerRef.current) {
            if (modalOpened) {
                // Move iframe to modal container
                modalContainerRef.current.appendChild(iframeRef.current);
                // Update styles for fullscreen
                iframeRef.current.style.height = 'calc(100vh - 60px)';
                iframeRef.current.style.border = 'none';
                iframeRef.current.style.borderRadius = '0';
            } else {
                // Move iframe back to normal container
                normalContainerRef.current.appendChild(iframeRef.current);
                // Update styles for normal view
                iframeRef.current.style.height = '800px';
                iframeRef.current.style.border = '1px solid #e0e0e0';
                iframeRef.current.style.borderRadius = '8px';
            }
        }
    }, [modalOpened]);

    useEffect(() => {
        // Only fetch if we have the required context
        if (!activeGlobalEnv || !accessToken || !clusterName || !namespace) {
            setDatabaseSecrets([]);
            setSelectData([]);
            console.log(activeGlobalEnv, accessToken, clusterName, namespace)
            return;
        }

        setLoading(true);

        // Fetch database secrets from the current namespace
        callK8sApi(
            `/api/v1/namespaces/${namespace}/secrets`,
            'GET',
            null,
            null,
            clusterName,
            accessToken
        )
            .then(data => {
                // Filter out secrets that don't have the correct labels
                const filteredSecrets = data.items.filter(secret => {
                    // Filter by name *-dbcreds
                    return secret.metadata.name.endsWith('-dbcreds');
                });

                setDatabaseSecrets(filteredSecrets);
                setSelectData(filteredSecrets.map(secret => {
                    return {
                        value: secret.metadata.name,
                        // Strip -dbcreds from the name for display
                        label: secret.metadata.name.replace('-dbcreds', ''),
                        secret: secret // Store the full secret object for later use
                    }
                }));
            })
            .catch(error => {
                console.error('Error fetching database secrets:', error);
                setDatabaseSecrets([]);
                setSelectData([]);
            })
            .finally(() => {
                setLoading(false);
            });
    }, [activeGlobalEnv, accessToken, clusterName, namespace]);

    // Reset selected database when environment changes
    useEffect(() => {
        setSelectedDatabase(null);
        setPgwebStatus(null);
        setPgwebError(null);
        setPgwebUrl(null);
        if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
        }
    }, [activeGlobalEnv]);

    // Function to launch PgWeb
    const launchPgWeb = async (dbName) => {
        if (!clusterName || !namespace || !dbName) return;

        setPgwebStatus('launching');
        setPgwebError(null);

        try {
            const response = await fetch(`/api/agent/${clusterName}/dbui/${namespace}/${dbName}`);
            const data = await response.json();

            if (data.success) {
                // Start polling for pod status
                startPolling(dbName);
            } else {
                setPgwebStatus('error');
                setPgwebError(data.message || 'Failed to launch PgWeb');
            }
        } catch (error) {
            console.error('Error launching PgWeb:', error);
            setPgwebStatus('error');
            setPgwebError('Network error while launching PgWeb');
        }
    };

    // Function to check if proxy endpoint is ready
    const checkProxyHealth = async (dbName) => {
        const proxyUrl = `/api/k8s/${clusterName}/proxy/api/v1/namespaces/${namespace}/services/pgweb-${dbName}-service:8081/proxy/`;

        try {
            const response = await fetch(proxyUrl, {
                method: 'GET', // Use HEAD to avoid loading full content
                cache: 'no-cache'
            });
            return response.ok; // Returns true if status is 200-299
        } catch (error) {
            console.log('Proxy health check failed:', error);
            return false;
        }
    };

    // Function to poll PgWeb status
    const startPolling = (dbName) => {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/api/agent/${clusterName}/dbui/${namespace}/${dbName}`);
                const data = await response.json();

                if (data.success && (data.status === 'already_running' || data.status === 'ready')) {
                    // Pod is running, now check if proxy is healthy
                    setPgwebStatus('health_checking');

                    const isProxyHealthy = await checkProxyHealth(dbName);

                    if (isProxyHealthy) {
                        // Proxy is healthy, set up the iframe URL
                        const proxyUrl = `/api/k8s/${clusterName}/proxy/api/v1/namespaces/${namespace}/services/pgweb-${dbName}-service:8081/proxy/`;
                        setPgwebUrl(proxyUrl);
                        setPgwebStatus('running');
                        clearInterval(interval);
                        setPollingInterval(null);
                    } else {
                        // Proxy not ready yet, continue polling
                        setPgwebStatus('launching');
                    }
                } else if (data.success && data.status === 'creating') {
                    // Still creating, continue polling
                    setPgwebStatus('launching');
                } else if (!data.success) {
                    // Error occurred
                    setPgwebStatus('error');
                    setPgwebError(data.message || 'Pod failed to start');
                    clearInterval(interval);
                    setPollingInterval(null);
                }
            } catch (error) {
                console.error('Error polling PgWeb status:', error);
                setPgwebStatus('error');
                setPgwebError('Failed to check pod status');
                clearInterval(interval);
                setPollingInterval(null);
            }
        }, 3000); // Poll every 3 seconds

        setPollingInterval(interval);

        // Stop polling after 5 minutes
        setTimeout(() => {
            if (interval) {
                clearInterval(interval);
                setPollingInterval(null);
                if (pgwebStatus === 'launching') {
                    setPgwebStatus('error');
                    setPgwebError('Timeout waiting for pod to start');
                }
            }
        }, 300000); // 5 minutes
    };

    // Handle database selection
    const handleDatabaseSelect = (value) => {
        setSelectedDatabase(value);

        // Reset PgWeb state
        setPgwebStatus(null);
        setPgwebError(null);
        setPgwebUrl(null);
        if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
        }

        if (value) {
            // Extract database name from the secret name
            const dbName = value.replace('-dbcreds', '');
            launchPgWeb(dbName);
        }
    };

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
        };
    }, [pollingInterval]);

    return <>
        <Container fluid my={20}>
            <Title>Database Dashboard</Title>
            <Text mt="md" size="md">
                Connect to databases in the selected environment using stored credentials.
            </Text>
        </Container>

        {!activeGlobalEnv ? (
            <Container fluid my={20}>
                <Text c="dimmed">No environment selected. Please select an environment to view databases.</Text>
            </Container>
        ) : loading ? (
            <Container fluid my={20}>
                <Skeleton height={60} width={300} />
            </Container>
        ) : selectData.length > 0 ? (
            <Container fluid my={20}>
                <Group
                    grow
                    justify="space-between"
                >
                    <Select
                        data={selectData}
                        placeholder="Select a database"
                        label="Database"
                        value={selectedDatabase}
                        onChange={handleDatabaseSelect}
                        searchable
                        leftSection={<IconDatabase size={16} />}
                    />
                </Group>

                {pgwebStatus === 'running' && (
                    <Group
                        justify="space-between">

                        <Button
                            onClick={() => setModalOpened(true)}
                            mb="md"
                        >
                            Open Fullscreen
                        </Button>
                        <Link href={pgwebUrl} target="_blank">
                            Direct Link
                        </Link>
                    </Group>
                )}

                {/* PgWeb Status */}
                {(pgwebStatus === 'launching' || pgwebStatus === 'health_checking') && (
                    <Alert icon={<LoadingOverlay visible />} title="Launching PgWeb" color="blue" mt="md">
                        {pgwebStatus === 'health_checking'
                            ? 'Pod is ready, waiting for service to be healthy...'
                            : 'Starting database interface pod... This may take a few moments.'
                        }
                    </Alert>
                )}

                {pgwebStatus === 'error' && (
                    <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" mt="md">
                        {pgwebError}
                        <Button
                            size="xs"
                            variant="light"
                            color="red"
                            mt="xs"
                            onClick={() => {
                                const dbName = selectedDatabase?.replace('-dbcreds', '');
                                if (dbName) launchPgWeb(dbName);
                            }}
                        >
                            Retry
                        </Button>
                    </Alert>
                )}
            </Container>
        ) : (
            <Container fluid my={20}>
                <Text c="dimmed">No database credentials found in namespace "{namespace}"</Text>
            </Container>
        )}

        {/* PgWeb iframe */}
        {pgwebStatus === 'running' && pgwebUrl && (
            <Container fluid my={20} style={{ position: 'relative' }}>
                <div ref={normalContainerRef}>
                    <iframe
                        ref={iframeRef}
                        src={pgwebUrl}
                        style={{
                            width: '100%',
                            height: '800px',
                            border: '1px solid #e0e0e0',
                            borderRadius: '8px'
                        }}
                        title="PgWeb Database Interface"
                    />
                </div>

            </Container>
        )}
    </>
}
