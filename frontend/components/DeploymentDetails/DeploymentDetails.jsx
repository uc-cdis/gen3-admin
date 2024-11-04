

import { useRouter } from 'next/router'



import { Title, Text, Anchor, Badge, Progress, Button, Table, HoverCard, Tooltip, Menu } from '@mantine/core';
import { useEffect, useState } from 'react';
import { differenceInMinutes, differenceInHours, differenceInDays, format } from 'date-fns';
import { IconSearch } from '@tabler/icons-react';



async function fetchDeployment(name) {

    try {
        const response = await fetch("/admin-api-go/deployments/" + name); // This endpoint will be redirected by your proxy
        if (!response.ok) {
            return null
        }
        const data = await response.json();
        console.log(data)
        return data;
    } catch (error) {
        console.error('Failed to fetch jobs:', error);
        return null;
    }
}

export function DeploymentDetails({ name }) {
    const [deployments, setDeployments] = useState([]);
    const [isLoading, setIsLoading] = useState(false);


    useEffect(() => {
        if (!name) {
            return;
        }
        setIsLoading(true);
        fetchDeployment(name).then((data) => {
            if (data) {
                console.log(data);
                setDeployments(data);
            }
            setIsLoading(false);
        });
    }, [name]);

    const Body = deployments?.map((deployment, index) => {
        return (
            <Table.Tr key={index}>
                <Table.Td>
                    {deployment.status === "Running" ? <Badge
                        variant="gradient"
                        gradient={{ from: 'green', to: 'lime', deg: 90 }}>{deployment.status}</Badge>
                        : <Badge
                            variant="gradient"
                            gradient={{ from: 'red', to: 'orange', deg: 90 }}>{deployment.status}</Badge>}
                </Table.Td>
                <Table.Td>
                    {/* <HoverCard width={100}>
                            <HoverCard.Target> */}
                    <Anchor href={"/logs/" + deployment.namespace + "/" + deployment.name + "/" + deployment.containers[0].name}>{deployment.name}</Anchor>
                    {/* </HoverCard.Target>
                            <HoverCard.Dropdown>
                                {
                                    // Print labels as string
                                    Object.keys(deployment.labels).map((key, index) => (
                                        <p key={index}>{key}: {deployment.labels[key]}</p>
                                    ))
                                }
                            </HoverCard.Dropdown>
                        </HoverCard> */}
                </Table.Td>
                <Table.Td>{deployment.image}</Table.Td>
                <Table.Td>{deployment.ready}/{deployment.desired}</Table.Td>
                <Table.Td>1</Table.Td>
                <Table.Td>1</Table.Td>
                <Table.Td>21</Table.Td>
                <Table.Td>

                    {deployment.status === "Running" ? <Progress color="green" value={100}> </Progress> : deployment.readyReplicas == 0 ? <Progress color="red" value={100}> </Progress> : <Progress color="yellow" value={deployment.ready / deployment.desired}> </Progress>}

                </Table.Td>
                <Table.Td>
                    <Menu transitionProps={{ transition: 'rotate-right', duration: 150 }}>
                        <Menu.Target>
                            <Button>...</Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item>
                                <Anchor href={"/shell/" + deployment.namespace + "/" + deployment.name + "/" + deployment.containers[0].name}>Shell</Anchor>
                            </Menu.Item>
                            
                            <Menu.Item>
                                <Anchor href={"/logs/" + deployment.namespace + "/" + deployment.name + "/" + deployment.containers[0].name}>Logs</Anchor>
                            </Menu.Item>

                        </Menu.Dropdown>
                    </Menu>
                </Table.Td>
            </Table.Tr>
        )
    });

    return (
        <>
            <Title ta="center" my={20}>
                This is the {' '}
                <Text inherit variant="gradient" component="span" gradient={{ from: 'blue', to: 'black' }}>
                    Deployments
                </Text>
                {' '} Overview Page
            </Title>

            {deployments.length > 0 ? (
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Ready</Table.Th>
                            <Table.Th>Deployment Name</Table.Th>
                            <Table.Th>Image</Table.Th>
                            <Table.Th>Ready</Table.Th>
                            <Table.Th>Up To Date</Table.Th>
                            <Table.Th>Available</Table.Th>
                            <Table.Th>Restarts</Table.Th>
                            <Table.Th>Health</Table.Th>
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
