import { memo, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, Handle, MarkerType, Position, ReactFlowProvider, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import { Badge, Box, Button, CloseButton, Code, Collapse, Group, Loader, Paper, Select, Stack, Text, UnstyledButton, useComputedColorScheme } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconSearch } from '@tabler/icons-react';
import ApplyState from '@/components/ApplyState';
import { STATE_COLOR, combineStates } from '@/lib/applyProgress';

const ACTION_COLOR = { create: 'green', update: 'yellow', replace: 'red', delete: 'red' };
const ACTION_SIGN = { create: '+', update: '~', replace: '±', delete: '−' };

const EDGE_STYLE = {
  traffic: { stroke: '#228be6' },
  peering: { stroke: '#7950f2' },
  security: { stroke: '#f59f00', strokeDasharray: '6 4' },
  dependency: { stroke: '#868e96', strokeDasharray: '2 4' },
  solid: { stroke: '#868e96' },
};

// The services column, laid out here so blocks can open and close.
const CARD_W = 180;
const CARD_H = 88;
const COLS = 3;
const GAP = 20;
const PAD = 16;
const HEAD = 34;
const BLOCK_W = COLS * CARD_W + (COLS - 1) * GAP + 2 * PAD;
const SUMMARY_H = 64;

// A plain reference says only that one resource names another; the labelled
// kinds (IAM Role, Secured By, DNS, NAT, ...) are what is worth drawing.
const isPlain = (e) => e.label === 'References';

// `module.eks.aws_iam_role.irsa["csoc-api"]` reads as "irsa · csoc-api", so
// for_each siblings can be told apart.
export function displayName(n) {
  if (n?.label) return n.label;
  if (!n?.address) return n?.title || n?.name || '';
  const last = n.address.slice(n.address.lastIndexOf(n.type ? `${n.type}.` : '.') + (n.type ? n.type.length + 1 : 1));
  const m = last.match(/^([^[]+)\[(.+)\]$/);
  if (!m) return last;
  const key = m[2].replace(/^"|"$/g, '');
  return /^\d+$/.test(key) ? `${m[1]} #${Number(key) + 1}` : `${m[1]} · ${key}`;
}

// Icons are shown as images, never inlined, so an SVG cannot run anything.
export const iconSrc = (svg) => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null);

const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };
const handles = (
  <>
    <Handle type="target" position={Position.Top} style={hidden} />
    <Handle type="source" position={Position.Bottom} style={hidden} />
  </>
);

// While an apply is shown, a card's border and badge say where it is.
const CHANGES = new Set(['create', 'update', 'delete', 'replace']);
const applyBorder = (s) => (s && s !== 'waiting' ? `var(--mantine-color-${STATE_COLOR[s]}-5)` : undefined);

const ResourceNode = memo(({ data }) => {
  const { node, icon, dark, state, apply } = data;
  const color = ACTION_COLOR[node.action];
  return (
    <Paper
      withBorder radius="sm" p={8} w={CARD_W} h={CARD_H}
      style={{
        borderColor: state === 'selected' ? 'var(--mantine-color-blue-filled)' : applyBorder(apply?.state),
        borderWidth: state === 'selected' || (apply && apply.state !== 'waiting') ? 2 : 1,
        background: dark ? 'var(--mantine-color-dark-6)' : 'white',
        opacity: state === 'dim' ? 0.25 : 1,
        cursor: 'pointer',
        transition: 'opacity 120ms',
      }}
      title={`${displayName(node)}\n${node.service || node.type}\n${node.address}`}
    >
      {handles}
      <Group gap={8} wrap="nowrap" align="flex-start">
        {icon ? <img src={icon} alt="" width={32} height={32} style={{ flex: 'none' }} /> : <Box w={32} h={32} />}
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="xs" fw={600} lineClamp={2} lh={1.2} style={{ wordBreak: 'break-all' }}>{displayName(node)}</Text>
          <Text size="10px" c="dimmed" truncate>{node.service || node.type}</Text>
          <Group gap={4} mt={2} wrap="nowrap">
            {apply ? <ApplyState state={apply} size={12} />
              : color && <Badge size="xs" variant="light" color={color}>{ACTION_SIGN[node.action]} {node.action}</Badge>}
            {node.folded.length > 0 && <Badge size="xs" variant="outline" color="gray">+{node.folded.length}</Badge>}
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
});
ResourceNode.displayName = 'ResourceNode';

// A collapsed services block: what is in it, by service.
const SummaryNode = memo(({ data }) => {
  const { services, icons, state, width, apply } = data;
  return (
    <Group gap={10} px={10} h={SUMMARY_H - 12} wrap="nowrap" w={width}
      style={{ opacity: state === 'dim' ? 0.25 : 1, cursor: 'pointer', overflow: 'hidden' }}>
      {handles}
      {apply && (
        <Badge size="sm" variant="light" color={STATE_COLOR[apply.state]} style={{ flex: 'none' }}>
          {apply.done}/{apply.total}{apply.failed ? ` · ${apply.failed} failed` : ''}
        </Badge>
      )}
      {services.slice(0, 6).map((s) => (
        <Group key={s.name} gap={4} wrap="nowrap" title={s.name}>
          {icons[s.icon] && <img src={icons[s.icon]} alt="" width={24} height={24} />}
          <Text size="xs" fw={600}>{s.count}</Text>
          <Text size="10px" c="dimmed" maw={90} truncate>{s.name.replace(/^(AWS|Amazon) /, '')}</Text>
        </Group>
      ))}
    </Group>
  );
});
SummaryNode.displayName = 'SummaryNode';

const BOX = {
  network: { border: '2px solid var(--mantine-color-orange-6)', bg: 'rgba(253, 126, 20, 0.04)', title: 'orange.7' },
  zone: { border: '1px dashed var(--mantine-color-gray-5)', bg: 'transparent', title: 'dimmed' },
  subnet: { border: '1px solid var(--mantine-color-blue-4)', bg: 'rgba(34, 139, 230, 0.05)', title: 'blue.7' },
  services: { border: '1px solid var(--mantine-color-gray-4)', bg: 'rgba(134, 142, 150, 0.05)', title: 'dark' },
};

const ContainerNode = memo(({ data }) => {
  const { box, open, count, apply } = data;
  const style = BOX[box.type] || BOX.zone;
  const border = applyBorder(apply?.state);
  // The tier already says what it is: "public · eks_public", not
  // "public · Subnet: eks_public".
  const tier = box.tier ? `${box.tier} · ` : '';
  const plain = box.tier ? box.title.replace(/^Subnet: /, '') : box.title;
  const title = box.pending
    ? 'Availability zone picked at apply · one subnet of each kind per zone'
    : box.label ? (box.type === 'network' ? `VPC · ${box.label}` : box.label) : plain;
  const toggle = box.type === 'services';
  return (
    <Box w={box.width} h={box.height} style={{ border: border ? `2px solid ${border}` : style.border, background: style.bg, borderRadius: 8 }}>
      {handles}
      <Group gap={6} px={10} py={6} wrap="nowrap" style={{ cursor: toggle ? 'pointer' : 'default' }} title={`${tier}${title}`}>
        {toggle && (open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />)}
        <Text size="xs" fw={600} c={style.title} truncate>{tier}{title}</Text>
        {toggle && <Badge size="xs" variant="light" color="gray">{count}</Badge>}
        {!toggle && box.subtitle && <Text size="10px" c="dimmed" ff="monospace">{box.subtitle}</Text>}
        {box.folded.length > 0 && <Badge size="xs" variant="outline" color="gray">+{box.folded.length}</Badge>}
        {apply && box.type !== 'zone' && box.type !== 'services' && <ApplyState state={apply} size={12} />}
      </Group>
    </Box>
  );
});
ContainerNode.displayName = 'ContainerNode';

const nodeTypes = { resource: ResourceNode, container: ContainerNode, summary: SummaryNode };
// The VPC-wide block sits inside the VPC, so it draws above it.
const Z = { network: 1, zone: 2, subnet: 3, services: 4 };

// The zone box for subnets whose AZ is only chosen at apply (random_shuffle).
// Older diagrams called it "assigned at apply", and used it as the subtitle.
const PENDING = /: (picked|assigned) at apply$/;
const tierRank = (s) => ({ public: 0, private: 1 }[s.tier] ?? 2);
const isPendingText = (t) => /^(picked|assigned) at apply$/.test(t || '');

const inside = (n, c) => n.x >= c.x && n.y >= c.y && n.x + n.width <= c.x + c.width && n.y + n.height <= c.y + c.height;
const SUBNET_W = CARD_W + 32;
const ZONE_W = SUBNET_W + 24;
const SLIM = 36;

// Lays the diagram out from containment alone: zones as columns inside the
// VPC, subnets sized to what is in them, VPC-wide resources in a block of
// their own, and everything outside the VPC in a block per category to the
// right. Blocks in `open` show their cards; the others show a summary, and
// their resources are drawn as that summary (`standIn`).
function layoutDiagram(diagram, open) {
  const boxes = [];
  const cards = new Map();
  const summaries = [];
  const standIn = new Map();
  const counts = new Map();

  const block = (id, title, members, x, y, width, cols) => {
    counts.set(id, members.length);
    if (open.has(id)) {
      members.forEach((n, i) => cards.set(n.id, { x: x + PAD + (i % cols) * (CARD_W + GAP), y: y + HEAD + Math.floor(i / cols) * (CARD_H + GAP) }));
      const rows = Math.max(1, Math.ceil(members.length / cols));
      boxes.push({ id, type: 'services', title, x, y, width, height: HEAD + rows * CARD_H + (rows - 1) * GAP + PAD, folded: [] });
    } else {
      const byService = new Map();
      members.forEach((n) => {
        const k = n.service || n.type;
        byService.set(k, { name: k, icon: n.icon, count: (byService.get(k)?.count || 0) + 1 });
        standIn.set(n.id, `${id}:summary`);
      });
      summaries.push({ id: `${id}:summary`, x: x + PAD, y: y + HEAD - 4, width: width - 2 * PAD, services: [...byService.values()].sort((p, q) => q.count - p.count) });
      boxes.push({ id, type: 'services', title, x, y, width, height: HEAD + SUMMARY_H, folded: [] });
    }
    return boxes[boxes.length - 1].height;
  };

  const networks = diagram.containers.filter((c) => c.type === 'network').sort((a, b) => a.y - b.y);
  const zones = diagram.containers.filter((c) => c.type === 'zone');
  const subnets = diagram.containers.filter((c) => c.type === 'subnet');
  const inSubnet = new Map(subnets.map((s) => [s.id, []]));
  const inNetwork = new Map(networks.map((n) => [n.id, []]));
  const outside = [];
  diagram.nodes.forEach((n) => {
    if (inSubnet.has(n.container)) inSubnet.get(n.container).push(n);
    else if (inNetwork.has(n.container)) inNetwork.get(n.container).push(n);
    else outside.push(n);
  });

  let y = 0;
  let right = 0;
  networks.forEach((net) => {
    const allZones = zones.filter((z) => inside(z, net)).sort((a, b) => a.title.localeCompare(b.title));
    const netZones = allZones.filter((z) => !PENDING.test(z.title));
    const pendingZones = allZones.filter((z) => PENDING.test(z.title));
    const placeSubnet = (s, x, sy) => {
      const members = inSubnet.get(s.id);
      members.forEach((n, i) => cards.set(n.id, { x: x + 16, y: sy + HEAD + i * (CARD_H + 12) }));
      const h = members.length ? HEAD + members.length * (CARD_H + 12) : SLIM;
      boxes.push({ ...s, subtitle: isPendingText(s.subtitle) ? '' : s.subtitle, x, y: sy, width: SUBNET_W, height: h });
      return h;
    };
    let zx = 24;
    let zoneBottom = y + 46;
    netZones.forEach((z) => {
      let sy = y + 46 + 30;
      subnets.filter((s) => inside(s, z)).sort((a, b) => a.y - b.y).forEach((s) => {
        sy += placeSubnet(s, zx + 12, sy) + 10;
      });
      boxes.push({ ...z, x: zx, y: y + 46, width: ZONE_W, height: sy - (y + 46) + 4 });
      zoneBottom = Math.max(zoneBottom, sy + 4);
      zx += ZONE_W + 16;
    });
    // Subnets with no zone yet: a band under the zone columns, one column
    // per zone, a row per kind (public, then private), since each kind gets
    // one subnet per zone.
    const pending = subnets.filter((s) => pendingZones.some((z) => inside(s, z)));
    if (pending.length) {
      const cols = Math.max(1, netZones.length);
      const byTier = new Map();
      pending
        .sort((a, b) => tierRank(a) - tierRank(b) || (a.label || a.title).localeCompare(b.label || b.title, undefined, { numeric: true }))
        .forEach((s) => {
          const k = `${s.tier}|${(s.label || s.title).replace(/[-_ #[]*\d+\]?$/, '')}`;
          if (!byTier.has(k)) byTier.set(k, []);
          byTier.get(k).push(s);
        });
      const top = zoneBottom + 16;
      let sy = top + 30;
      [...byTier.values()].forEach((group) => {
        for (let i = 0; i < group.length; i += cols) {
          let rowH = SLIM;
          group.slice(i, i + cols).forEach((s, c) => {
            rowH = Math.max(rowH, placeSubnet(s, 24 + c * (ZONE_W + 16) + 12, sy));
          });
          sy += rowH + 10;
        }
      });
      const width = Math.max(cols * (ZONE_W + 16) - 16, ZONE_W);
      boxes.push({ ...pendingZones[0], id: pendingZones[0].id, pending: true, x: 24, y: top, width, height: sy - top + 4 });
      zx = Math.max(zx, 24 + width + 16);
      zoneBottom = sy + 4;
    }
    const innerW = Math.max(zx - 16 - 24, COLS * CARD_W + (COLS - 1) * GAP + 2 * PAD);
    const wide = inNetwork.get(net.id);
    let netBottom = zoneBottom;
    if (wide.length) {
      netBottom += 16;
      const cols = Math.max(1, Math.floor((innerW - 2 * PAD + GAP) / (CARD_W + GAP)));
      netBottom += block(`${net.id}:wide`, 'Gateways, routing and firewall rules', wide, 24, netBottom, innerW, cols);
    }
    boxes.push({ ...net, x: 0, y, width: innerW + 48, height: netBottom - y + 20 });
    right = Math.max(right, innerW + 48);
    y = netBottom + 60;
  });

  // Outside the networks: one block per category, largest first.
  const byCategory = new Map();
  outside.forEach((n) => {
    const k = n.category || 'Other';
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k).push(n);
  });
  const sx = networks.length ? right + 48 : 0;
  let sy = 0;
  [...byCategory].sort((a, b) => b[1].length - a[1].length).forEach(([category, members]) => {
    members.sort((a, b) => a.address.localeCompare(b.address));
    sy += block(`services:${category}`, category, members, sx, sy, BLOCK_W, COLS) + 24;
  });

  return { boxes, cards, summaries, standIn, counts };
}

// The plan's architecture as an overview: resources in their VPC, zone and
// subnet boxes, the rest in service blocks that open on click. Connections
// are drawn only for the selected resource.
export default function PlanDiagram(props) {
  return (
    <ReactFlowProvider>
      <Diagram {...props} />
    </ReactFlowProvider>
  );
}

const CAMERA = { duration: 350, maxZoom: 1 };
// The zoom below which card text cannot be read.
const READABLE = 0.55;

function Diagram({ diagram, progress = null }) {
  const dark = useComputedColorScheme('light', { getInitialValueInEffect: true }) === 'dark';
  const flow = useReactFlow();
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  // Where to point the camera once the layout has caught up: 'all', or
  // { id, peers } to frame a resource (or block) and what it connects to.
  const [focus, setFocus] = useState(null);
  const [query, setQuery] = useState(null);

  useEffect(() => { setSelected(null); setOpen(new Set()); }, [diagram]);

  const byId = useMemo(() => new Map([...diagram.nodes, ...diagram.containers].map((n) => [n.id, n])), [diagram]);
  const icons = useMemo(() => Object.fromEntries(Object.entries(diagram.icons || {}).map(([k, v]) => [k, iconSrc(v)])), [diagram]);
  const services = useMemo(() => layoutDiagram(diagram, open), [diagram, open]);

  // What a selection touches, with hidden resources shown as their block.
  const shownAs = (id) => services.standIn.get(id) || id;
  const related = useMemo(() => {
    if (!selected) return null;
    const ids = new Set([selected.id]);
    diagram.edges.forEach((e) => {
      if (isPlain(e)) return;
      if (e.source === selected.id) ids.add(shownAs(e.target));
      if (e.target === selected.id) ids.add(shownAs(e.source));
    });
    return ids;
  }, [selected, diagram, services]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where each card is in the apply: its own state and that of what is folded
  // into it, rolled into one.
  const applyOf = useMemo(() => {
    if (!progress) return () => null;
    const memo = new Map();
    return (n) => {
      if (!n) return null;
      if (!memo.has(n.id)) {
        // Only what the plan changes; an unchanged resource has nothing to wait for.
        const changing = [n, ...(n.folded || [])].filter((r) => CHANGES.has(r.action));
        const mine = progress.get(n.address || n.id);
        memo.set(n.id, changing.length ? { ...mine, state: combineStates(changing.map((r) => progress.get(r.address || r.id))) } : null);
      }
      return memo.get(n.id);
    };
  }, [progress]);
  const stateOf = (id) => (!related ? 'normal' : id === selected.id ? 'selected' : related.has(id) ? 'related' : 'dim');

  // A closed block's tally: how many of its cards are done.
  const summaryApply = (summaryId) => {
    if (!progress) return null;
    const members = diagram.nodes.filter((n) => services.standIn.get(n.id) === summaryId).map(applyOf).filter(Boolean);
    if (!members.length) return null;
    const count = (st) => members.filter((m) => m.state === st).length;
    const done = count('done');
    const failed = count('failed');
    return { done, failed, total: members.length, state: failed ? 'failed' : done === members.length ? 'done' : count('running') || done ? 'running' : 'waiting' };
  };

  const nodes = useMemo(() => {
    const out = [];
    services.boxes.forEach((b) => out.push({
      id: b.id, type: 'container', position: { x: b.x, y: b.y },
      data: { box: b, open: open.has(b.id), count: services.counts.get(b.id), apply: b.type === 'subnet' || b.type === 'network' ? applyOf(byId.get(b.id)) : null },
      draggable: false, selectable: false, zIndex: Z[b.type] ?? 0,
    }));
    services.summaries.forEach((s) => out.push({
      id: s.id, type: 'summary', position: { x: s.x, y: s.y },
      data: { services: s.services, icons, state: stateOf(s.id), width: s.width, apply: summaryApply(s.id) },
      draggable: false, selectable: false, zIndex: 10,
    }));
    diagram.nodes.forEach((n) => {
      if (services.standIn.has(n.id)) return;
      out.push({
        id: n.id, type: 'resource', position: services.cards.get(n.id) || { x: n.x, y: n.y },
        data: { node: n, icon: icons[n.icon], dark, state: stateOf(n.id), apply: applyOf(n) },
        draggable: false, zIndex: 10,
      });
    });
    return out;
  }, [diagram, services, icons, dark, related, applyOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges = useMemo(() => {
    if (!selected) return [];
    const seen = new Set();
    return diagram.edges
      .filter((e) => (e.source === selected.id || e.target === selected.id) && !isPlain(e))
      .map((e) => ({ ...e, source: shownAs(e.source), target: shownAs(e.target) }))
      .filter((e) => {
        const k = `${e.source}|${e.target}|${e.label}`;
        if (seen.has(k) || e.source === e.target) return false;
        seen.add(k);
        return true;
      })
      .map((e, i) => {
        const style = EDGE_STYLE[e.kind] || EDGE_STYLE.solid;
        return {
          id: `e${i}`, source: e.source, target: e.target, type: 'smoothstep', label: e.label,
          labelStyle: { fontSize: 10, fontWeight: 600 }, labelBgPadding: [4, 2], labelBgBorderRadius: 4,
          style: { ...style, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 16, height: 16 },
          zIndex: 20,
        };
      });
  }, [selected, diagram, services]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs after React Flow has the new nodes, so their positions are known.
  useEffect(() => {
    if (!focus) return undefined;
    // A short wait, so nodes that just appeared have been measured too.
    const t = setTimeout(() => {
      setFocus(null);
      if (focus === 'all') { flow.fitView({ ...CAMERA, padding: 0.04 }); return; }
      // Frame the most of it that stays readable: the resource, its peers
      // and the blocks they are folded into; else without the blocks; else
      // just the resource.
      const W = canvas.current?.clientWidth || 800;
      const H = canvas.current?.clientHeight || 600;
      const rectOf = (ids) => {
        const ns = [...new Set(ids)].map((id) => flow.getNode(id)).filter((n) => n?.width);
        if (!ns.length) return null;
        const x = Math.min(...ns.map((n) => n.positionAbsolute.x));
        const y = Math.min(...ns.map((n) => n.positionAbsolute.y));
        return { x, y, width: Math.max(...ns.map((n) => n.positionAbsolute.x + n.width)) - x, height: Math.max(...ns.map((n) => n.positionAbsolute.y + n.height)) - y };
      };
      const visible = focus.peers.filter((id) => flow.getNode(id));
      const candidates = [[focus.id, ...visible, ...focus.peers.map(shownAs)], [focus.id, ...visible], [focus.id]];
      for (const ids of candidates) {
        const r = rectOf(ids);
        if (r && Math.min(W / (r.width * 1.3), H / (r.height * 1.3)) >= READABLE) {
          flow.fitBounds(r, { padding: 0.15, duration: CAMERA.duration });
          return;
        }
      }
      // Too big to frame: show its top, at a zoom where it can be read.
      const n = flow.getNode(focus.id);
      const zoom = 0.8;
      if (n) {
        const top = n.positionAbsolute.y - 16 / zoom;
        flow.setCenter(n.positionAbsolute.x + n.width / 2, Math.min(top + H / (2 * zoom), n.positionAbsolute.y + n.height / 2), { zoom, duration: CAMERA.duration });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [focus, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockOf = (id) => services.standIn.get(id)?.replace(/:summary$/, '');

  // Select a resource, opening its block if it is folded away, and bring it
  // and what it connects to into view.
  const pick = (n, { zoom = true } = {}) => {
    if (!n || selected?.id === n.id) { setSelected(null); return; }
    setSelected(n);
    const block = blockOf(n.id);
    if (block) setOpen((prev) => new Set(prev).add(block));
    if (!zoom) return;
    const peers = diagram.edges
      .filter((e) => !isPlain(e) && (e.source === n.id || e.target === n.id))
      .map((e) => (e.source === n.id ? e.target : e.source));
    setFocus({ id: n.id, peers });
  };

  const toggleBlock = (id) => {
    const opening = !open.has(id);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setFocus(opening ? { id, peers: [] } : 'all');
  };

  const blockIds = useMemo(() => [...services.counts.keys()], [services]);
  const allOpen = blockIds.length > 0 && blockIds.every((id) => open.has(id));

  const searchData = useMemo(() => diagram.nodes
    .map((n) => ({ value: n.id, label: `${displayName(n)} · ${n.service || n.type}` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [diagram]);
  // Every word typed must appear in the name, service or address, with _ and
  // - read as spaces: "eks clus" finds eks_cluster.
  const searchFilter = useMemo(() => {
    const words = (t) => t.toLowerCase().replace(/[_\-.[\]"]+/g, ' ');
    const hay = new Map(diagram.nodes.map((n) => [n.id, words(`${displayName(n)} ${n.service} ${n.type} ${n.address}`)]));
    return ({ options, search, limit }) => {
      const terms = words(search).split(/\s+/).filter(Boolean);
      return options.filter((o) => terms.every((t) => hay.get(o.value)?.includes(t))).slice(0, limit);
    };
  }, [diagram]);

  const wrapper = useRef(null);
  const canvas = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelected(null); };
    const el = wrapper.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, []);

  const hiddenCount = Object.values(diagram.hidden || {}).reduce((a, b) => a + b, 0);
  const connections = selected ? diagram.edges.filter((e) => e.source === selected.id || e.target === selected.id) : [];

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Click a resource to see what it connects to, or find one by name; click a service block to open it; Esc clears. Settings such as policy
        attachments are folded into the resource they configure (+N){hiddenCount > 0 && `; ${hiddenCount} lookups and helpers are left out`}.
      </Text>
      {/* The details sit beside the canvas, not over it, so they never hide
          the lines a selection draws. */}
      <Box ref={wrapper} tabIndex={-1} h="max(640px, calc(100vh - 220px))"
        style={{ display: 'flex', border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, outline: 'none', overflow: 'hidden' }}>
        <Box ref={canvas} pos="relative" style={{ flex: 1, minWidth: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => {
              if (n.type === 'resource') pick(byId.get(n.id));
              else if (n.type === 'summary') toggleBlock(n.id.replace(/:summary$/, ''));
              else if (n.data?.box?.type === 'services') toggleBlock(n.id);
            }}
            onPaneClick={() => setSelected(null)}
            nodesConnectable={false}
            // With the service blocks collapsed the whole picture fits at a
            // zoom where the cards can still be read. The prop, unlike a call
            // in onInit, waits until the nodes have been measured.
            fitView
            fitViewOptions={{ padding: 0.04, minZoom: 0.45, maxZoom: 1 }}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} fitViewOptions={{ ...CAMERA, padding: 0.04 }} />
          </ReactFlow>
          <Group gap="xs" pos="absolute" top={10} left={10} style={{ zIndex: 20 }} wrap="nowrap">
            <Select
              size="xs" w={300} searchable clearable limit={30} placeholder="Find a resource…"
              leftSection={<IconSearch size={14} />}
              data={searchData} filter={searchFilter} value={query} nothingFoundMessage="No match"
              onChange={(id) => { setQuery(null); if (id) { const n = byId.get(id); if (n && selected?.id !== n.id) pick(n); } }}
              comboboxProps={{ withinPortal: false }}
            />
            <Button size="xs" variant="default" onClick={() => { setOpen(allOpen ? new Set() : new Set(blockIds)); setFocus('all'); }}>
              {allOpen ? 'Close all blocks' : 'Open all blocks'}
            </Button>
          </Group>
        </Box>
        {selected && (
          <Box p="sm" w={340} style={{ flex: 'none', overflow: 'auto', borderLeft: '1px solid var(--mantine-color-default-border)' }}>
            <Group justify="space-between" wrap="nowrap" mb={4}>
              <Group gap={6} wrap="nowrap">
                {icons[selected.icon] && <img src={icons[selected.icon]} alt="" width={20} height={20} />}
                <Text size="sm" fw={600} truncate>{selected.service || selected.type}</Text>
              </Group>
              <CloseButton size="sm" onClick={() => setSelected(null)} />
            </Group>
            <Code block fz="xs">{selected.address}</Code>
            <Group gap={6} mt={6}>
              {ACTION_COLOR[selected.action] && <Badge size="sm" variant="light" color={ACTION_COLOR[selected.action]}>{selected.action}</Badge>}
              <Text size="xs" c="dimmed">{selected.type}</Text>
              {progress && <ApplyState state={applyOf(selected)} />}
            </Group>
            {progress && applyOf(selected)?.error && <Text size="xs" c="red" mt={4}>{applyOf(selected).error}</Text>}
            {selected.folded.length > 0 && (
              <>
                <Text size="xs" fw={600} mt="sm">Configured by ({selected.folded.length})</Text>
                <Stack gap={2} mt={4}>
                  {selected.folded.map((f) => <Text key={f.address} size="xs" ff="monospace" truncate title={f.address}>{f.address}</Text>)}
                </Stack>
              </>
            )}
            <Connections connections={connections} selected={selected} byId={byId} onPick={(p) => pick(p)} />
          </Box>
        )}
      </Box>
    </Stack>
  );
}

// A selection's connections, grouped by kind, peers deduplicated, with the
// plain references tucked away.
function Connections({ connections, selected, byId, onPick }) {
  const [showPlain, setShowPlain] = useState(false);
  useEffect(() => setShowPlain(false), [selected]);
  const groups = new Map();
  connections.forEach((e) => {
    const out = e.source === selected.id;
    const peer = byId.get(out ? e.target : e.source);
    const key = `${isPlain(e) ? '~' : ''}${out ? '→' : '←'} ${e.label}`;
    if (!groups.has(key)) groups.set(key, new Map());
    if (peer) groups.get(key).set(peer.id, peer);
  });
  const entries = [...groups].sort(([a], [b]) => a.localeCompare(b));
  const labelled = entries.filter(([k]) => !k.startsWith('~'));
  const plain = entries.filter(([k]) => k.startsWith('~'));
  const plainCount = plain.reduce((n, [, peers]) => n + peers.size, 0);
  const row = ([key, peers]) => (
    <Box key={key}>
      <Text size="xs" fw={600}>{key.replace(/^~/, '')} <Text span size="xs" c="dimmed">({peers.size})</Text></Text>
      <Group gap={4} mt={2} mb={4}>
        {[...peers.values()].map((p) => (
          <UnstyledButton key={p.id} onClick={() => p.address && onPick(p)} disabled={!p.address}>
            <Badge size="sm" variant="light" color="gray" tt="none" style={{ cursor: p.address ? 'pointer' : 'default' }}>
              {displayName(p)}
            </Badge>
          </UnstyledButton>
        ))}
      </Group>
    </Box>
  );
  return (
    <>
      <Text size="xs" fw={600} mt="sm" mb={4}>Connections</Text>
      {labelled.length === 0 && plainCount === 0 && <Text size="xs" c="dimmed">None.</Text>}
      {labelled.map(row)}
      {plainCount > 0 && (
        <>
          <UnstyledButton onClick={() => setShowPlain((v) => !v)}>
            <Text size="xs" c="dimmed">{showPlain ? '▾' : '▸'} Other references ({plainCount})</Text>
          </UnstyledButton>
          <Collapse in={showPlain}><Box mt={4}>{plain.map(row)}</Box></Collapse>
        </>
      )}
    </>
  );
}

// Fetches and shows a plan run's diagram, waiting out the moment between the
// run's log ending and its diagram being stored.
export function PlanDiagramLoader({ target, environment, runId, progress = null }) {
  const [diagram, setDiagram] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setDiagram(null);
    setError(null);
    (async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch('/api/environments/plan-diagram', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...target, name: environment, run_id: runId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data;
        if (res.status !== 404 || attempt >= 5) throw new Error(res.status === 404 ? 'this plan has no diagram' : data.error || res.statusText);
        await new Promise((r) => setTimeout(r, 2000));
      }
    })()
      .then((d) => { if (!cancelled) setDiagram(d); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [runId, environment, target?.bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Text size="sm" c="dimmed">No diagram: {error}. Run the plan again to draw one.</Text>;
  if (!diagram) return <Group gap="xs"><Loader size="xs" /><Text size="sm">Drawing the architecture…</Text></Group>;
  return <PlanDiagram diagram={diagram} progress={progress} />;
}
