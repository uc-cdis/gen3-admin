

import { useRouter } from 'next/router'


import { Title, Text, Anchor, Badge, Progress, Button, Table, HoverCard, Tooltip, Accordion, Box, Group, Stack } from '@mantine/core';
import { useEffect, useState } from 'react';
import { DataTable } from 'mantine-datatable';
import { differenceInMinutes, differenceInHours, differenceInDays, format } from 'date-fns';
import '@mantine/core/styles.layer.css';
import 'mantine-datatable/styles.layer.css';



async function fetchDeployment(name) {
    
    try {
        const response = await fetch("/admin-api-go/deployments/" + name); // This endpoint will be redirected by your proxy
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

export function DeploymentDetails({ name }) {
    const [deployments, setDeployments] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    
    useEffect(() => {
        if (!name) {
            return;
        }
        setIsLoading(true);
        fetchDeployment(name).then((data) => {
            console.log(data);
            setDeployments(data);
            setIsLoading(false);
        });
    }, [name]);
  



  return (
    <DataTable
        withTableBorder
        withColumnBorders
        columns={[{ accessor: 'ready', title: "Ready", render: ({ready}) => ({ready} ? <Badge variant="gradient" gradient={{ from: 'green', to: 'lime', deg: 90 }}>Active</Badge> : <Badge variant="gradient" gradient={{ from: 'red', to: 'orange', deg: 90 }}>Inactive</Badge>),}, { accessor: 'name', title: "Pod Name" }]}
        records={deployments}
        idAccessor="name"
        rowExpansion={{
          content: ({ record }) => (
            <Stack>
            {record.containers.map((container, index) => 
            <div>
              <Group>
                <div>Name: </div>
                <div>
                  {container.name}
                </div>
              </Group>
              <Group>
                <div>Status: </div>
                <div>
                  {container.status}
                </div>
              </Group>
              <Group> 
                <div>Image: </div>
                <div>
                  {container.image}
                </div>
              </Group>
              <Group>
                <div>Resources: </div>
                <div>Limit: {container.resources.hasOwnProperty('limit') ? container.resources.limits.cpu || "Unset" : "Unset"} CPU / {container.resources.hasOwnProperty('limit') ? container.resources.limits.memory || "Unset" : "Unset"} Memory <br></br>
                  Requests: {container.resources.hasOwnProperty('requests') ? container.resources.requests.cpu || "Unset" : "Unset"} CPU / {container.resources.hasOwnProperty('requests') ? container.resources.requests.memory || "Unset" : "Unset"} Memory            
                </div>
              </Group>  
              <Group>  
                <div>Name: </div>
                <div>
                  {container.image}
                </div>                                                                
              </Group>
              </div>
            )}
            </Stack>
          )
        }} 
      />
  );

}
