"use client";

import ReactFlow, { Background, Handle, MarkerType, Position } from "reactflow";
import "reactflow/dist/style.css";

import {
  IconBrandAws,
  IconBrandDocker,
  IconHexagons,
  IconLayoutDashboard,
  IconServer2,
} from "@tabler/icons-react";
import { Badge, Group, ThemeIcon, useComputedColorScheme } from "@mantine/core";

import classes from "./CSOCDiagram.module.css";

// What the bootstrap wizard does, and what follows it. Cards are marked by
// stage so the diagram does not imply the wizard delivers everything shown:
// today it provisions the network and cluster, and the CSOC and Gen3
// environments are installed onto that cluster afterwards.
const STAGE = {
  active: { label: "This wizard", color: "gen3Blue", className: classes.active },
  upcoming: { label: "Next", color: "gray", className: classes.upcoming },
};

function StepNode({ data }) {
  const { icon: Icon, title, items, stage } = data;
  const s = STAGE[stage];
  return (
    <div className={`${classes.node} ${s.className}`}>
      <Handle id="left" type="target" position={Position.Left} className={classes.handle} isConnectable={false} />
      <Handle id="top" type="target" position={Position.Top} className={classes.handle} isConnectable={false} />
      <div className={classes.header}>
        <ThemeIcon size={34} radius="md" variant={stage === "active" ? "filled" : "light"} color={s.color}>
          <Icon size={20} stroke={1.6} />
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={classes.title}>{title}</div>
          <Badge size="xs" variant="light" color={s.color} mt={4}>
            {s.label}
          </Badge>
        </div>
      </div>
      <ul className={classes.items}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <Handle id="right" type="source" position={Position.Right} className={classes.handle} isConnectable={false} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={classes.handle} isConnectable={false} />
    </div>
  );
}

function AccountNode({ data }) {
  return (
    <div className={classes.account}>
      <Group gap={6} className={classes.accountLabel}>
        <IconBrandAws size={16} stroke={1.6} />
        {data.label}
      </Group>
    </div>
  );
}

const nodeTypes = { step: StepNode, account: AccountNode };

// An L-shaped layout: the flow turns down inside the account rather than
// running as one long row, so it fits the wizard's content column at close to
// 1:1 instead of being shrunk by fitView until the text is unreadable.
const NODE_W = 210;
const NODE_H = 124; // matches .node min-height, so edges between cards run straight
const COL_GAP = 96; // room for an edge label between columns
const ROW_GAP = 64;
const PAD = 18;
const LABEL_H = 34;
const ACCOUNT_X = NODE_W + COL_GAP;

const nodes = [
  {
    id: "machine",
    type: "step",
    position: { x: 0, y: LABEL_H },
    data: {
      icon: IconBrandDocker,
      title: "Your machine",
      stage: "active",
      items: ["Runs this wizard", "Terraform in a container", "State in your S3 bucket"],
    },
  },
  {
    id: "account",
    type: "account",
    position: { x: ACCOUNT_X, y: 0 },
    data: { label: "Your AWS account" },
    style: {
      width: PAD * 2 + NODE_W * 2 + COL_GAP,
      height: LABEL_H + NODE_H * 2 + ROW_GAP + PAD,
    },
    selectable: false,
  },
  {
    id: "cluster",
    type: "step",
    parentNode: "account",
    extent: "parent",
    position: { x: PAD, y: LABEL_H },
    data: {
      icon: IconServer2,
      title: "VPC and EKS cluster",
      stage: "active",
      items: ["Subnets, NAT, egress proxy", "EKS control plane and nodes"],
    },
  },
  {
    id: "csoc",
    type: "step",
    parentNode: "account",
    extent: "parent",
    position: { x: PAD, y: LABEL_H + NODE_H + ROW_GAP },
    data: {
      icon: IconLayoutDashboard,
      title: "CSOC control plane",
      stage: "upcoming",
      items: ["This dashboard, in-cluster", "Takes over from you"],
    },
  },
  {
    id: "gen3",
    type: "step",
    parentNode: "account",
    extent: "parent",
    position: { x: PAD + NODE_W + COL_GAP, y: LABEL_H + NODE_H + ROW_GAP },
    data: {
      icon: IconHexagons,
      title: "Gen3 environments",
      stage: "upcoming",
      items: ["One namespace each", "Own hostname each"],
    },
  },
];

function edge(id, [source, sourceHandle], [target, targetHandle], label, active, colors) {
  const color = active ? colors.active : colors.upcoming;
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    label,
    type: "straight",
    animated: active,
    style: { stroke: color, strokeWidth: 2, strokeDasharray: active ? undefined : "6 5" },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    labelStyle: { fill: color, fontWeight: 600, fontSize: 12 },
    labelBgPadding: [5, 2],
    labelBgBorderRadius: 4,
  };
}

export default function CSOCDiagram() {
  // Edge strokes are SVG attributes, which cannot take light-dark(), so they
  // are picked from the resolved scheme here.
  const scheme = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const colors =
    scheme === "dark"
      ? { active: "var(--mantine-color-gen3Blue-4)", upcoming: "var(--mantine-color-gray-6)", grid: "var(--mantine-color-dark-5)" }
      : { active: "var(--mantine-color-gen3Blue-6)", upcoming: "var(--mantine-color-gray-7)", grid: "var(--mantine-color-gray-3)" };

  const edges = [
    edge("provision", ["machine", "right"], ["cluster", "left"], "provisions", true, colors),
    edge("install", ["cluster", "bottom"], ["csoc", "top"], "hosts", false, colors),
    edge("manage", ["csoc", "right"], ["gen3", "left"], "deploys", false, colors),
  ];

  return (
    <div className={classes.canvas}>
      {/* A picture of the flow, not an editor: nothing is draggable or
          connectable, and scrolling the page does not zoom the diagram. */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
        panOnDrag={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        attributionPosition="bottom-right"
      >
        <Background gap={18} size={1} color={colors.grid} />
      </ReactFlow>
    </div>
  );
}
