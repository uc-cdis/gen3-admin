"use client";

import React from "react";
import ReactFlow, { Background, Controls, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";

import {
  IconBrandDocker,
  IconLayoutDashboard,
  IconWorldWww,
  IconTerminal2,
  IconHierarchy3,
  IconGauge,
  IconCloud
} from "@tabler/icons-react";

import { Card, Stack, Text, Center } from "@mantine/core";

function CardNode({ data }) {
  const { icons = [], title, subtitle, highlight, large } = data;

  return (
    <Card
      shadow="sm"
      radius="md"
      withBorder
      style={{
        width: large ? 340 : 260,
        textAlign: "center",
        padding: large ? 24 : 18,
        borderColor: highlight ? "#228be6" : undefined,
        background: highlight ? "#e8f3ff" : "white",
      }}
    >
      <Center style={{ gap: 10 }}>
        {icons.map((Icon, i) => (
          <Icon key={i} size={36} stroke={1.5} />
        ))}
      </Center>

      <Stack spacing={6} mt="sm">
        <Text fw={700} size={large ? "lg" : "md"}>
          {title}
        </Text>

        {Array.isArray(subtitle) ? (
          <Stack spacing={2}>
            {subtitle.map((line, i) => (
              <Text key={i} size="sm" c="dimmed" lh={1.35}>
                {line}
              </Text>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">{subtitle}</Text>
        )}
      </Stack>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </Card>
  );
}


const nodeTypes = {
  card: CardNode,
};

// -------------------------------------------------------
// Nodes
// -------------------------------------------------------

const nodes = [
  {
    id: "local-bootstrap",
    type: "card",
    position: { x: 0, y: 150 },
    data: {
      icons: [IconBrandDocker, IconTerminal2],
      title: "Local Bootstrap (You Are Here)",
      subtitle: "This tool runs locally and deploys the CSOC cluster into your AWS account",
      highlight: true,
    },
  },

  {
    id: "control-plane",
    type: "card",
    position: { x: 380, y: 100 },
    data: {
      icons: [IconWorldWww, IconLayoutDashboard, IconCloud],
      title: "CSOC Control Plane",
      subtitle: [
        "Available at: csoc.yourdomain.com",
        "Your portal for deployments, monitoring, and cluster management."
      ],
      highlight: true,
      large: true,
    },
  },

  {
    id: "hubspoke",
    type: "card",
    position: { x: 800, y: 150 },
    data: {
      icons: [IconHierarchy3],
      title: "Hub / Spoke Clusters",
      subtitle: "Deploy one or many Gen3 environments",
    },
  },
];

const edges = [
  { id: "e1", source: "local-bootstrap", target: "control-plane", type: "smoothstep" },
  { id: "e2", source: "control-plane", target: "hubspoke", type: "smoothstep" },
];


// -------------------------------------------------------
// Component
// -------------------------------------------------------

export default function CSOCDiagram() {
  return (
    <div style={{ width: "100%", height: 460 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.5}
        maxZoom={1.2}
      >
        <Background gap={12} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
