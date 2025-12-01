"use client";

import React, { useState, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  IconBrandDocker,
  IconLayoutDashboard,
  IconWorldWww,
  IconTerminal2,
  IconHierarchy3,
  IconCloud,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";

import {
  Card,
  Stack,
  Text,
  Center,
  Group,
  Collapse,
  ActionIcon,
  Box,
  ThemeIcon,
} from "@mantine/core";

// -------------------------------------------------------
// Enhanced Card Node with Expandable Details
// -------------------------------------------------------

function CardNode({ data }) {
  const {
    icons = [],
    title,
    subtitle,
    highlight,
    large,
    details = [],
    badge,
  } = data;

  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      shadow="md"
      radius="md"
      withBorder
      className="card-node"
      style={{
        width: large ? 360 : 270,
        textAlign: "center",
        padding: large ? 26 : 20,
        borderColor: highlight ? "#228be6" : "#dee2e6",
        borderWidth: highlight ? 2 : 1,
        background: highlight
          ? "linear-gradient(135deg, #e8f3ff 0%, #f0f7ff 100%)"
          : "white",
        cursor: details.length > 0 ? "pointer" : "default",
        transition: "all 0.3s ease",
        boxShadow: highlight
          ? "0 4px 12px rgba(34, 139, 230, 0.15)"
          : "0 2px 8px rgba(0, 0, 0, 0.1)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = highlight
          ? "0 8px 20px rgba(34, 139, 230, 0.25)"
          : "0 4px 12px rgba(0, 0, 0, 0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = highlight
          ? "0 4px 12px rgba(34, 139, 230, 0.15)"
          : "0 2px 8px rgba(0, 0, 0, 0.1)";
      }}
      onClick={() => details.length > 0 && setExpanded(!expanded)}
    >
      {/* Icons */}
      <Center style={{ gap: 12, marginBottom: 14 }}>
        {icons.map((Icon, i) => (
          <ThemeIcon
            key={i}
            size={large ? 52 : 46}
            radius="md"
            variant="light"
            color={highlight ? "blue" : "gray"}
          >
            <Icon size={large ? 30 : 26} stroke={1.5} />
          </ThemeIcon>
        ))}
      </Center>

      {/* Title & Subtitle */}
      <Stack spacing={10}>
        <Group position="center" spacing={8}>
          <Text fw={700} size={large ? "xl" : "lg"}>
            {title}
          </Text>
          {details.length > 0 && (
            <ActionIcon size="sm" variant="subtle">
              {expanded ? (
                <IconChevronUp size={18} />
              ) : (
                <IconChevronDown size={18} />
              )}
            </ActionIcon>
          )}
        </Group>

        {Array.isArray(subtitle) ? (
          <Stack spacing={6}>
            {subtitle.map((line, i) => (
              <Text key={i} size="sm" c="dimmed" lh={1.5} fw={500}>
                {line}
              </Text>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed" lh={1.5} fw={500}>
            {subtitle}
          </Text>
        )}

        {badge && (
          <Text size="sm" c="blue" fw={600} fs="italic">
            {badge}
          </Text>
        )}
      </Stack>

      {/* Expandable Details */}
      {details.length > 0 && (
        <Collapse in={expanded}>
          <Box
            mt="md"
            pt="md"
            style={{
              borderTop: "1px solid #dee2e6",
            }}
          >
            <Stack spacing={10} align="flex-start">
              {details.map((detail, i) => (
                <Group key={i} spacing={8} style={{ width: "100%" }}>
                  <Text size="sm" c="dimmed" style={{ flex: 1 }} fw={500} lh={1.4}>
                    • {detail}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Box>
        </Collapse>
      )}

      {/* Connection Handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 12,
          height: 12,
          background: "#228be6",
          border: "2px solid white",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 12,
          height: 12,
          background: "#228be6",
          border: "2px solid white",
        }}
      />
    </Card>
  );
}

const nodeTypes = {
  card: CardNode,
};

// -------------------------------------------------------
// Enhanced Nodes with More Details
// -------------------------------------------------------

const initialNodes = [
  {
    id: "local-bootstrap",
    type: "card",
    position: { x: 50, y: 180 },
    data: {
      icons: [IconBrandDocker, IconTerminal2],
      title: "Local Bootstrap",
      subtitle: "Runs on your machine to initialize CSOC infrastructure in AWS",
      highlight: true,
      badge: "👈 You are here",
      details: [
        "Docker-based initialization scripts",
        "Terraform/CDK infrastructure provisioning",
        "AWS credential configuration",
        "Network and security setup",
      ],
    },
  },
  {
    id: "control-plane",
    type: "card",
    position: { x: 420, y: 130 },
    data: {
      icons: [IconWorldWww, IconLayoutDashboard, IconCloud],
      title: "CSOC Control Plane",
      subtitle: [
        "🌐 csoc.yourdomain.com",
        "Central dashboard for managing Gen3 deployments and cluster operations",
      ],
      highlight: true,
      large: true,
      details: [
        "Kubernetes cluster management",
        "User authentication & RBAC",
        "Deployment automation",
        "Monitoring & alerting dashboard",
        "Configuration management",
        "Audit logs & compliance",
      ],
    },
  },
  {
    id: "gen3-deployments",
    type: "card",
    position: { x: 880, y: 180 },
    data: {
      icons: [IconHierarchy3],
      title: "Gen3 Deployments",
      subtitle: "Managed Gen3 data commons environments",
      details: [
        "Multiple isolated Gen3 instances",
        "Data ingestion pipelines",
        "API gateway & services",
        "Object storage integration",
        "Metadata services",
      ],
    },
  },
];

const initialEdges = [
  {
    id: "e1",
    source: "local-bootstrap",
    target: "control-plane",
    type: "smoothstep",
    animated: true,
    style: { stroke: "#228be6", strokeWidth: 2.5 },
    label: "Initializes",
    labelStyle: { fill: "#228be6", fontWeight: 600, fontSize: 13 },
    labelBgStyle: { fill: "#e8f3ff", fillOpacity: 0.9 },
  },
  {
    id: "e2",
    source: "control-plane",
    target: "gen3-deployments",
    type: "smoothstep",
    animated: true,
    style: { stroke: "#40c057", strokeWidth: 2.5 },
    label: "Manages",
    labelStyle: { fill: "#40c057", fontWeight: 600, fontSize: 13 },
    labelBgStyle: { fill: "#e8f7ed", fillOpacity: 0.9 },
  },
];

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------

export default function CSOCDiagram() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback((event, node) => {
    console.log("Node clicked:", node);
  }, []);

  return (
    <Box
      style={{
        width: "100%",
        height: 520,
        border: "1px solid #dee2e6",
        borderRadius: 8,
        overflow: "hidden",
        background: "#fafafa",
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{
          padding: 0.15,
          includeHiddenNodes: false,
          minZoom: 0.5,
          maxZoom: 1.2,
        }}
        minZoom={0.4}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        attributionPosition="bottom-left"
      >
        <Background
          gap={16}
          size={1}
          color="#dee2e6"
          style={{ backgroundColor: "#fafafa" }}
        />
        <Controls
          style={{
            button: {
              backgroundColor: "white",
              border: "1px solid #dee2e6",
              borderRadius: 4,
            },
          }}
        />
      </ReactFlow>
    </Box>
  );
}