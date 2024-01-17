import { Title, Text, Anchor,  Button, Table, HoverCard } from '@mantine/core';
import { useEffect, useState } from 'react';


async function fetchDeployments() {
    try {
        const response = await fetch('/admin-api/deployments/'); // This endpoint will be redirected by your proxy
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch jobs:', error);
        return null;
    }
}

export function DeploymentsPage() {
    const [deployments, setDeployments] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        setIsLoading(true);
        fetchDeployments().then((data) => {
            setDeployments(data);
            setIsLoading(false);
        });
    }, []);

    const Body = deployments.map((deployment, index) => (
                <Table.Tr key={index}>
                    <Table.Td>{deployment.ready ? <>Ready</> : <>Not Ready</>} </Table.Td>
                    <Table.Td>
                        <HoverCard width={100}>
                            <HoverCard.Target>
                                <Button>{deployment.name}</Button>
                            </HoverCard.Target>
                            <HoverCard.Dropdown>
                                {
                                    // Print labels as string
                                    Object.keys(deployment.labels).map((key, index) => (
                                        <p key={index}>{key}: {deployment.labels[key]}</p>
                                    ))
                                }
                            </HoverCard.Dropdown>
                        </HoverCard>
                    </Table.Td>
                    <Table.Td>{deployment.image}</Table.Td>
                    <Table.Td>{deployment.created}</Table.Td>
                </Table.Tr>
        ));

    return (
        <>
        <Title ta="center" mt={100}>
                This is the {' '}
                <Text inherit variant="gradient" component="span" gradient={{ from: 'pink', to: 'yellow' }}>
                    Deployments
                    </Text>
                    {' '}Page
            </Title>

            {deployments.length > 0 ? (
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Ready</Table.Th>
                            <Table.Th>Deployment Name</Table.Th>
                            <Table.Th>Image</Table.Th>
                            <Table.Th>Created</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {Body}
                    </Table.Tbody>
                </Table>
            ) : (
                isLoading ? <p>No deployments found.</p> : <p>Loading deployment...</p>
            )}
        </>
    )
}