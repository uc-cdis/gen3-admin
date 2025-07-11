import { Container, Skeleton, Title, Text, Select } from "@mantine/core";
import dynamic from 'next/dynamic'
import { useState, useEffect, useContext } from "react";

const Terminal = dynamic(() => import('@/components/Shell/Terminal'), {
    ssr: false
})

import callK8sApi from '@/lib/k8s';
import { get } from "lodash";
import { useGlobalState } from '@/contexts/global';

import { useSession } from "next-auth/react";

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
    }, [activeGlobalEnv]);

    return <>
        <Skeleton visible={false}>
            <Container fluid my={20}>
                <Title>Database Dashboard</Title>
                <Text mt="md" size="md">
                    Connect to databases in the selected environment using stored credentials.
                    {activeGlobalEnv ? (
                        <Text size="sm" mt="xs" c="dimmed">
                            Current environment: {activeGlobalEnv} (Agent: {clusterName}, Namespace: {namespace})
                        </Text>
                    ) : (
                        <Text size="sm" mt="xs" c="orange">
                            Please select an environment first to view available databases.
                        </Text>
                    )}
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
                    <Select
                        data={selectData}
                        placeholder="Select a database"
                        label="Database"
                        value={selectedDatabase}
                        onChange={(value) => {
                            setSelectedDatabase(value);
                        }}
                        searchable
                    />
                </Container>
            ) : (
                <Container fluid my={20}>
                    <Text c="dimmed">No database credentials found in namespace "{namespace}"</Text>
                </Container>
            )}

            {selectedDatabase && (
                <Container fluid my={20}>
                    <Terminal
                        namespace={namespace}
                        cluster={clusterName}
                        database={selectedDatabase}
                    />
                </Container>
            )}
        </Skeleton>
    </>
}
