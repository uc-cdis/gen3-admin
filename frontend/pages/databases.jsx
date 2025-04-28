import { Container, Skeleton, Title, Text, Select } from "@mantine/core";
import dynamic from 'next/dynamic'
import { useState, useEffect } from "react";

const Terminal = dynamic(() => import('@/components/Shell/Terminal'), {
    ssr: false
})

import callK8sApi from '@/lib/k8s';
import { get } from "lodash";


export default function Databases() {

    // useState for database secrets
    const [databaseSecrets, setDatabaseSecrets] = useState([]);

    const [selectedDatabase, setSelectedDatabase] = useState(null);
    const [selectData, setSelectData] = useState([]);
    useEffect(() => {
        // fetch database secrets
        // TODO: make namespace dynamic
        callK8sApi('/api/v1/namespaces/gen3-test/secrets', 'GET', null, null, "kind", "accessToken")
            // .then(response => response.json())
            .then(data => {
                // filter out secrets that don't have the correct labels
                const filteredSecrets = data.items.filter(secret => {
                    // filter by name *-dbcreds
                    return secret.metadata.name.endsWith('-dbcreds');

                });
                setDatabaseSecrets(filteredSecrets);
                setSelectData(filteredSecrets.map(secret => {
                    return {
                        value: secret.metadata.name,
                        // strip -dbcreds from the name
                        label: secret.metadata.name.replace('-dbcreds', '')
                    }
                }));
            })
            .catch(error => {
                console.error('Error fetching database secrets:', error);
            });
    }, []);

    return <>
        <Skeleton visible={false}>
            <Container fluid my={20}>
                <Title>Database Dashboard</Title>
                <Text mt="md" size="md">
                    This is a placeholder for the database dashboard. This will be replaced with a real dashboard once it is ready.
                    The idea is that we will use the k8s secrets to store the database credentials and then use those to connect to the databases.
                    There will be a shell with psql to connect to the databases.
                </Text>
            </Container>
            {databaseSecrets.length > 0 ? <Container fluid my={20}>
                <Select
                    data={selectData}
                    placeholder="Select a database"
                    label="Database"
                    value={selectedDatabase}
                    onChange={(value) => setSelectedDatabase(value)}
                    searchable
                />
                </Container>
                : <Container fluid my={20}>
                    <Skeleton height={100} width={300} />
                    </Container>
            }
            {selectedDatabase && <Container fluid my={20}>
                <Terminal namespace={selectedDatabase.namespace} container={selectedDatabase.container} pod={selectedDatabase.pod}  />
                </Container>
            }
        </Skeleton>
    </>
}
