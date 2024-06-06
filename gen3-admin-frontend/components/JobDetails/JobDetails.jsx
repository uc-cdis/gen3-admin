import { Modal, Image, Text, Timeline, Badge, Table, ScrollArea } from '@mantine/core';
import React, { useEffect, useState } from 'react';
import { getJobDetails } from '@/components/CronJobsPage/functions';


const  JobDetails = ({name}) => {

  const [details, setDetails] = useState([]);

  useEffect(() => {
    getJobDetails(name)
    .then(data => setDetails(data))
    .catch(error => console.error(error));
  }, []);
  
  
  console.log("details: ", details)
  const containers = details?.spec?.template.spec.containers
  console.log("containers: ", containers)
  const rows = containers?.map((container, index) => (
    <tr key={index}>
      <td>{container?.name}</td>
      <td>{container?.image}</td>
      <td>{container?.state?.terminated?.reason}</td>
      <td>{new Date(container?.state?.terminated?.finished_at).toLocaleString()}</td>
      <td>{container?.state?.terminated?.exit_code}</td>
    </tr>
  ));
  return (
    <>
        <Text size="lg" weight={500} style={{ marginBottom: 10 }}>
          {details?.parent}
        </Text>
        <Badge color={details?.status === 'Succeeded' ? 'green' : 'red'} size="lg">
          {/* {details?.status} */}
        </Badge>

        <Table highlightOnHover style={{ marginTop: 20 }}>
          <thead>
            <tr>
              <th>Container</th>
              <th>Image</th>
              <th>Status</th>
              <th>Finished At</th>
              <th>Exit Code</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </Table>
        <ScrollArea style={{ height: 400 }}>
        <Timeline active={-1} bulletSize={24} lineWidth={2} style={{ marginTop: 20 }}>
          {details?.events?.map((event, index) => (
            <Timeline.Item key={index} title={event.type}>
              <Text color="dimmed" size="sm">
                {event.status} - {event.reason || 'No reason'}
              </Text>
              <Text size="xs">{new Date(event.time).toLocaleString()}</Text>
            </Timeline.Item>
          ))}
        </Timeline>
        </ScrollArea>
        </>
  );
};

export default JobDetails;
