import { Modal, Image, Text, Timeline, Badge, Table, ScrollArea } from '@mantine/core';

const JobsDetailsModal = ({ details, opened, onClose }) => {
  const rows = details?.containers.map((container, index) => (
    <tr key={index}>
      <td>{container.name}</td>
      <td>{container.image}</td>
      <td>{container.state.terminated?.reason}</td>
      <td>{new Date(container.state.terminated?.finished_at).toLocaleString()}</td>
      <td>{container.state.terminated?.exit_code}</td>
    </tr>
  ));
  console.log(details)
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Details for ${details?.name}`}
      size="xl"
    //   overlayOpacity={0.55}
      overlayBlur={3}
    >
       <ScrollArea style={{ height: 400 }}>
        <Text size="lg" weight={500} style={{ marginBottom: 10 }}>
          {details?.parent}
        </Text>
        <Badge color={details?.status === 'Succeeded' ? 'green' : 'red'} size="lg">
          {details?.status}
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
          {details?.events.map((event, index) => (
            <Timeline.Item key={index} title={event.type}>
              <Text color="dimmed" size="sm">
                {event.status} - {event.reason || 'No reason'}
              </Text>
              <Text size="xs">{new Date(event.time).toLocaleString()}</Text>
            </Timeline.Item>
          ))}
        </Timeline>
        </ScrollArea>
      </ScrollArea> 
    </Modal> 
  );
};

export default JobsDetailsModal;
