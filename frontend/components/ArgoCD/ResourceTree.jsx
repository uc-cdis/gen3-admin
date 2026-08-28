import { useCallback, useMemo, useState } from 'react';

import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconHierarchy,
  IconList,
} from '@tabler/icons-react';
import ReactFlow, { Background, Controls, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';

import { EmptyState, StatusBadge } from '@/components/ui';

/**
 * Resource topology for an ArgoCD application.
 *
 * Uses reactflow, which is already a dependency (see components/CSOCDiagram for
 * the existing precedent), so this adds no new package. The graph is a genuine
 * tree, so layout is a small hand-rolled layered pass rather than dagre/elkjs.
 *
 * A nested-list view is offered alongside the canvas: a reactflow canvas is not
 * keyboard navigable or screen-reader friendly, so the list is the accessible
 * path to the same data, not a fallback afterthought.
 */

const NODE_WIDTH = 230;
const NODE_HEIGHT = 64;
const H_GAP = 90;
const V_GAP = 14;

/** Pods are numerous and rarely individually interesting; collapse past this. */
const AUTO_COLLAPSE_CHILDREN = 5;

function nodeKey(node) {
  return node.uid || `${node.kind}/${node.namespace || '-'}/${node.name}`;
}

/**
 * Build parent -> children adjacency from ArgoCD's parentRefs.
 *
 * Roots are nodes with no parentRefs, plus any whose parent is missing from the
 * response (ArgoCD can return a child whose parent was filtered out).
 */
function buildGraph(nodes) {
  const byKey = new Map();
  nodes.forEach((n) => byKey.set(nodeKey(n), n));

  const childrenOf = new Map();
  const hasParent = new Set();

  nodes.forEach((node) => {
    const refs = node.parentRefs || [];
    refs.forEach((ref) => {
      const parentKey = ref.uid || `${ref.kind}/${ref.namespace || '-'}/${ref.name}`;
      if (!byKey.has(parentKey)) return;
      if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
      childrenOf.get(parentKey).push(nodeKey(node));
      hasParent.add(nodeKey(node));
    });
  });

  const roots = nodes.map(nodeKey).filter((key) => !hasParent.has(key));
  return { byKey, childrenOf, roots };
}

function healthValue(node) {
  return node.health?.status || (node.kind ? 'Unknown' : undefined);
}

/** Custom node: kind, name, and health as a shared StatusBadge. */
function TreeNode({ data }) {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Paper
        p="xs"
        withBorder
        radius="md"
        style={{ width: NODE_WIDTH, cursor: data.onSelect ? 'pointer' : 'default' }}
        onClick={data.onSelect}
      >
        <Group gap={6} justify="space-between" wrap="nowrap">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed">
              {data.kind}
            </Text>
            <Text size="sm" fw={500} truncate title={data.name}>
              {data.name}
            </Text>
          </Stack>
          {data.health && (
            <StatusBadge domain="argoHealth" value={data.health} size="xs" withTooltip={false} />
          )}
        </Group>
        {data.childCount > 0 && (
          <Group gap={4} mt={4}>
            <ActionIcon
              size="xs"
              variant="subtle"
              onClick={(event) => {
                event.stopPropagation();
                data.onToggle?.();
              }}
              aria-label={data.collapsed ? 'Expand children' : 'Collapse children'}
            >
              {data.collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
            </ActionIcon>
            <Text size="xs" c="dimmed">
              {data.childCount} {data.childCount === 1 ? 'child' : 'children'}
            </Text>
          </Group>
        )}
      </Paper>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
}

const nodeTypes = { argoResource: TreeNode };

export default function ResourceTree({ tree, onSelectResource }) {
  const nodes = tree?.nodes || [];
  const { byKey, childrenOf, roots } = useMemo(() => buildGraph(nodes), [nodes]);

  const [view, setView] = useState('graph');
  const [collapsed, setCollapsed] = useState(() => {
    // Default-collapse noisy subtrees so the first render is readable.
    const initial = new Set();
    childrenOf.forEach((children, key) => {
      if (children.length > AUTO_COLLAPSE_CHILDREN) initial.add(key);
    });
    return initial;
  });

  const toggle = useCallback((key) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Layered left-to-right layout: depth sets the column, running offset sets the
  // row. Enough for a tree, and avoids pulling in a layout engine.
  const { flowNodes, flowEdges } = useMemo(() => {
    const outNodes = [];
    const outEdges = [];
    let cursorY = 0;

    const walk = (key, depth) => {
      const node = byKey.get(key);
      if (!node) return;

      const children = childrenOf.get(key) || [];
      const isCollapsed = collapsed.has(key);

      const myY = cursorY;
      cursorY += NODE_HEIGHT + V_GAP;

      outNodes.push({
        id: key,
        type: 'argoResource',
        position: { x: depth * (NODE_WIDTH + H_GAP), y: myY },
        data: {
          kind: node.kind,
          name: node.name,
          health: healthValue(node),
          childCount: children.length,
          collapsed: isCollapsed,
          onToggle: children.length ? () => toggle(key) : undefined,
          onSelect: onSelectResource ? () => onSelectResource(node) : undefined,
        },
        draggable: false,
      });

      if (isCollapsed) return;

      children.forEach((childKey) => {
        outEdges.push({
          id: `${key}->${childKey}`,
          source: key,
          target: childKey,
          type: 'smoothstep',
        });
        walk(childKey, depth + 1);
      });
    };

    roots.forEach((root) => walk(root, 0));
    return { flowNodes: outNodes, flowEdges: outEdges };
  }, [byKey, childrenOf, roots, collapsed, toggle, onSelectResource]);

  if (!nodes.length) {
    return (
      <EmptyState
        title="No resources reported"
        description="ArgoCD has not reported any managed resources for this application yet."
      />
    );
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {nodes.length} resources
        </Text>
        <SegmentedControl
          size="xs"
          value={view}
          onChange={setView}
          data={[
            { value: 'graph', label: (<Group gap={4}><IconHierarchy size={14} /><span>Graph</span></Group>) },
            { value: 'list', label: (<Group gap={4}><IconList size={14} /><span>List</span></Group>) },
          ]}
        />
      </Group>

      {view === 'graph' ? (
        <Paper withBorder radius="md" style={{ height: 620 }}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </Paper>
      ) : (
        <Paper withBorder radius="md" p="md">
          <NestedList
            roots={roots}
            byKey={byKey}
            childrenOf={childrenOf}
            collapsed={collapsed}
            onToggle={toggle}
            onSelectResource={onSelectResource}
          />
        </Paper>
      )}
    </Stack>
  );
}

/** Keyboard-navigable equivalent of the canvas. */
function NestedList({ roots, byKey, childrenOf, collapsed, onToggle, onSelectResource, depth = 0 }) {
  return (
    <Stack gap={2}>
      {roots.map((key) => {
        const node = byKey.get(key);
        if (!node) return null;
        const children = childrenOf.get(key) || [];
        const isCollapsed = collapsed.has(key);

        return (
          <Stack key={key} gap={2}>
            <Group gap="xs" pl={depth * 20} wrap="nowrap">
              {children.length > 0 ? (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  onClick={() => onToggle(key)}
                  aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                </ActionIcon>
              ) : (
                <span style={{ width: 18 }} />
              )}

              <Badge size="xs" variant="default">
                {node.kind}
              </Badge>

              <Text
                size="sm"
                style={{ cursor: onSelectResource ? 'pointer' : 'default' }}
                onClick={onSelectResource ? () => onSelectResource(node) : undefined}
              >
                {node.name}
              </Text>

              {node.namespace && (
                <Text size="xs" c="dimmed">
                  {node.namespace}
                </Text>
              )}

              {healthValue(node) && (
                <StatusBadge domain="argoHealth" value={healthValue(node)} size="xs" />
              )}

              {children.length > AUTO_COLLAPSE_CHILDREN && isCollapsed && (
                <Tooltip label="Collapsed by default because there are many children">
                  <Text size="xs" c="dimmed">
                    ({children.length})
                  </Text>
                </Tooltip>
              )}
            </Group>

            {!isCollapsed && children.length > 0 && (
              <NestedList
                roots={children}
                byKey={byKey}
                childrenOf={childrenOf}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelectResource={onSelectResource}
                depth={depth + 1}
              />
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}
