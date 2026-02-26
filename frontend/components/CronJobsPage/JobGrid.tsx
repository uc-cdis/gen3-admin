import React from "react";
import {
  Grid,
  Card,
  Text,
  Badge,
  Anchor,
  Group,
  Stack,
} from "@mantine/core";
import { IconCheck, IconX, IconClock } from "@tabler/icons-react";
import { useGlobalState } from "@/contexts/global";

function deriveJobStatus(item: any) {
  const succeeded = item?.status?.succeeded || 0;
  const failed = item?.status?.failed || 0;
  const active = item?.status?.active || 0;

  if (succeeded > 0) {
    return { label: "Succeeded", color: "green", icon: <IconCheck size={14} /> };
  }
  if (failed > 0) {
    return { label: "Failed", color: "red", icon: <IconX size={14} /> };
  }
  if (active > 0) {
    return { label: "Running", color: "blue", icon: <IconClock size={14} /> };
  }

  return { label: "Unknown", color: "gray", icon: <IconClock size={14} /> };
}

export default function JobGrid({
  data = [],
  parent,
}: {
  data: any[];
  parent?: string;
}) {
  const { activeCluster } = useGlobalState();
  const clusterName = activeCluster;

  if (!data.length) {
    return (
      <Text c="dimmed" size="sm">
        No job history found{parent ? ` for ${parent}` : ""}
      </Text>
    );
  }

  return (
    <Grid>
      {data.map((item) => {
        const status = deriveJobStatus(item);
        const href = `/clusters/${clusterName}/workloads/jobs/${item.metadata.namespace}/${item.metadata.name}`;

        return (
          <Grid.Col
            key={item.metadata.uid}
            span={{ base: 12, md: 6, lg: 4, xl: 3 }}
          >
            <Card withBorder radius="md" p="md">
              <Stack gap={6}>
                <Text fw={600} size="sm">
                  {item.metadata?.name}
                </Text>

                <Group gap="xs">
                  <Badge
                    color={status.color}
                    variant="light"
                    leftSection={status.icon}
                  >
                    {status.label}
                  </Badge>
                </Group>

                <Text size="xs" c="dimmed">
                  Created:{" "}
                  {item.metadata?.creationTimestamp
                    ? new Date(item.metadata.creationTimestamp).toLocaleString()
                    : "Unknown"}
                </Text>

                {item?.status?.completionTime && (
                  <Text size="xs" c="dimmed">
                    Finished:{" "}
                    {new Date(item.status.completionTime).toLocaleString()}
                  </Text>
                )}

                <Anchor size="xs" href={href} c={status.color}>
                  View details →
                </Anchor>
              </Stack>
            </Card>
          </Grid.Col>
        );
      })}
    </Grid>
  );
}
