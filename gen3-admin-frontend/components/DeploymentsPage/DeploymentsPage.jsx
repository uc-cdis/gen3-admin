import { Title, Text, Anchor, Badge, Progress, Button, Table, HoverCard, Tooltip } from '@mantine/core';
import { useEffect, useState } from 'react';
import { differenceInMinutes, differenceInHours, differenceInDays, format } from 'date-fns';


const calculateAge = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
  
    const minutes = differenceInMinutes(now, date);
    if (minutes < 60) {
      return `${minutes} minutes old`;
    }
  
    const hours = differenceInHours(now, date);
    if (hours < 24) {
      return `${hours} hours old`;
    }
  
    const days = differenceInDays(now, date);
    return `${days} days old`;
  };
  

async function fetchDeployments() {
    try {
        const response = await fetch('/admin-api-go/deployments'); // This endpoint will be redirected by your proxy
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const data = await response.json();
        console.log(data)
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
            if (!data) {
                return;
            }
            console.log(data);
            setDeployments(data);
        });
        setIsLoading(false);
    }, []);

    const Body = deployments.map((deployment, index) => 
    
            {
                const age = calculateAge(deployment.created);
                return(
                <Table.Tr key={index}>
                    <Table.Td>
                        {deployment.ready ? <Badge 
                                variant="gradient"
                                gradient={{ from: 'green', to: 'lime', deg: 90 }}>Active</Badge> 
                        : <Badge 
                                variant="gradient"
                                gradient={{ from: 'red', to: 'orange', deg: 90 }}>Inactive</Badge>}
                    </Table.Td>
                    <Table.Td>
                        {/* <HoverCard width={100}>
                            <HoverCard.Target> */}
                                <Anchor href={"deployments/"+deployment.name}>{deployment.name}</Anchor>
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
                    <Table.Td><Tooltip label={format(new Date(deployment.created), "PPpp")}><Text>{age}</Text></Tooltip></Table.Td>
                    <Table.Td>

                        {deployment.ready ? <Progress color="green" value={100}> </Progress> : deployment.readyReplicas == 0 ? <Progress color="red" value={100}> </Progress>: <Progress color="yellow" value={deployment.ready/deployment.desired}> </Progress>}                       

                    </Table.Td>
                    <Table.Td><Button>..</Button> </Table.Td>
                </Table.Tr>
        )});

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
                            <Table.Th>Age</Table.Th>
                            <Table.Th>Health</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {Body}
                    </Table.Tbody>
                </Table>
            ) : (
                !isLoading ? <p>No deployments found.</p> : <p>Loading deployment...</p>
            )}
        </>
    )
}