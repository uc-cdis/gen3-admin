import { getProvider } from '../providers/index.js';

/**
 * Hierarchical layout engine with container bounds computation.
 *
 * The layout is provider-agnostic: each cloud present in the plan gets its own
 * band containing that cloud's entry services, network/zone/subnet hierarchy
 * and regional services. Terminology (VPC vs VPC Network vs Virtual Network)
 * comes from the provider definition.
 */

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 24;
const BAND_PAD = 28;
const MIN_NETWORK_WIDTH = 480;

export function computeArchitectureLayout(parsedData) {
  const { nodes, networkNodes, subnetNodes, edges } = parsedData;
  const providerIds = parsedData.providerIds?.length
    ? parsedData.providerIds
    : Array.from(new Set(nodes.map(n => n.providerId)));
  const isMultiCloud = providerIds.length > 1;

  const containers = [];
  let currentY = 60;
  let globalMaxX = 0;

  providerIds.forEach(providerId => {
    const provider = getProvider(providerId);
    const providerNodes = nodes.filter(n => n.providerId === providerId);
    const providerNetworks = networkNodes.filter(n => n.providerId === providerId);
    const providerSubnets = subnetNodes.filter(n => n.providerId === providerId);

    const bandX = 40;
    const bandTop = currentY;
    let y = bandTop + (isMultiCloud ? 44 : 0);
    let bandMaxX = bandX + MIN_NETWORK_WIDTH;

    const contentX = bandX + (isMultiCloud ? BAND_PAD : 20);

    // ---- 1. Entry services (DNS, CDN, API gateways, public IPs) ----
    const { entryNodes, downstreamNodes } = splitExternalNodes(provider, providerNodes, providerNetworks, providerSubnets);

    if (entryNodes.length > 0) {
      let x = contentX;
      entryNodes.forEach((node, i) => {
        if (i > 0 && i % 5 === 0) {
          x = contentX;
          y += NODE_HEIGHT + NODE_GAP_Y;
        }
        placeNode(node, x, y);
        x += NODE_WIDTH + NODE_GAP_X;
        bandMaxX = Math.max(bandMaxX, x);
      });
      y += NODE_HEIGHT + 60;
    }

    // ---- 2. Networks with nested zones and subnets ----
    providerNetworks.forEach(network => {
      const networkSubnets = providerSubnets.filter(s => s.parentNetworkId === network.id);
      const networkOnlyNodes = providerNodes.filter(
        n => n.parentNetworkId === network.id && !n.parentSubnetId &&
          !providerNetworks.includes(n) && !providerSubnets.includes(n)
      );

      // Subnets of this network, ordered public-facing first for readability.
      networkSubnets.sort((a, b) =>
        Number(isPublicSubnet(provider, b)) - Number(isPublicSubnet(provider, a)));

      const result = layoutNetwork({
        provider,
        network,
        networkSubnets,
        networkOnlyNodes,
        providerNodes,
        x: contentX,
        y,
        containers
      });

      bandMaxX = Math.max(bandMaxX, contentX + result.width);
      y += result.height + 50;
    });

    // ---- 3. Regional / global services outside any network ----
    if (downstreamNodes.length > 0) {
      let x = contentX;
      let rowIndex = 0;
      downstreamNodes.forEach(node => {
        placeNode(node, x, y);
        x += NODE_WIDTH + NODE_GAP_X;
        rowIndex += 1;
        bandMaxX = Math.max(bandMaxX, x);
        if (rowIndex >= 4) {
          rowIndex = 0;
          x = contentX;
          y += NODE_HEIGHT + NODE_GAP_Y;
        }
      });
      if (rowIndex > 0) y += NODE_HEIGHT + NODE_GAP_Y;
    }

    const bandHeight = Math.max(140, y - bandTop + (isMultiCloud ? BAND_PAD : 10));

    if (isMultiCloud) {
      containers.unshift({
        id: `cloud-${provider.id}`,
        type: 'cloud',
        providerId: provider.id,
        title: provider.name,
        subtitle: `${providerNodes.length} resources`,
        accentColor: provider.accentColor,
        x: bandX,
        y: bandTop,
        width: Math.max(bandMaxX - bandX + BAND_PAD, MIN_NETWORK_WIDTH),
        height: bandHeight
      });
    }

    globalMaxX = Math.max(globalMaxX, bandMaxX);
    currentY = bandTop + bandHeight + 60;
  });

  // Nodes that no provider band claimed (unknown providers with no hierarchy).
  const orphanNodes = nodes.filter(n => n.x === undefined && !providerIds.includes(n.providerId));
  if (orphanNodes.length > 0) {
    let x = 60;
    orphanNodes.forEach(node => {
      placeNode(node, x, currentY);
      x += NODE_WIDTH + NODE_GAP_X;
      globalMaxX = Math.max(globalMaxX, x);
    });
    currentY += NODE_HEIGHT + 60;
  }

  const routedEdges = routeEdges(nodes, edges);
  const bounds = computeBounds(nodes, containers, globalMaxX, currentY);

  return { nodes, containers, edges: routedEdges, bounds, providerIds };
}

function placeNode(node, x, y) {
  node.x = x;
  node.y = y;
  node.width = NODE_WIDTH;
  node.height = NODE_HEIGHT;
}

function splitExternalNodes(provider, providerNodes, providerNetworks, providerSubnets) {
  const networkIds = new Set(providerNetworks.map(n => n.id));
  // Only subnets that hang off a network in this plan become containers; an
  // orphan subnet (its network lives outside the plan) renders as a plain node.
  const containerSubnetIds = new Set(
    providerSubnets.filter(s => networkIds.has(s.parentNetworkId)).map(s => s.id)
  );

  const external = providerNodes.filter(n => {
    if (networkIds.has(n.id) || containerSubnetIds.has(n.id)) return false;
    if (n.parentSubnetId && containerSubnetIds.has(n.parentSubnetId)) return false;
    if (n.parentNetworkId && networkIds.has(n.parentNetworkId)) return false;
    return true;
  });

  const entryNodes = external.filter(n => provider.isEntryResource(n.type));
  const downstreamNodes = external.filter(n => !entryNodes.includes(n));
  return { entryNodes, downstreamNodes };
}

function isPublicSubnet(provider, subnet) {
  const { hierarchy } = provider;
  const name = `${subnet.name || ''} ${subnet.after?.name || ''}`.toLowerCase();
  const tagValues = Object.values(subnet.tags || {}).join(' ').toLowerCase();
  const haystack = `${name} ${tagValues}`;

  if (hierarchy.publicSubnetHints.some(hint => haystack.includes(hint))) return true;
  try {
    return hierarchy.isPublicSubnet({ ...subnet.before, ...subnet.after }) === true;
  } catch {
    return false;
  }
}

function layoutNetwork({ provider, network, networkSubnets, networkOnlyNodes, providerNodes, x, y, containers }) {
  const terms = provider.terms;
  const innerTop = y + 46;
  let innerBottom = innerTop;
  let width = MIN_NETWORK_WIDTH;

  // Group subnets by zone (AWS AZ / GCP zone-region / Azure zone) so multi-AZ
  // deployments read as parallel columns.
  const zoneGroups = new Map();
  networkSubnets.forEach(subnet => {
    const key = subnet.zone || subnet.region || `Default ${terms.zone}`;
    if (!zoneGroups.has(key)) zoneGroups.set(key, []);
    zoneGroups.get(key).push(subnet);
  });

  if (zoneGroups.size > 0) {
    let zoneX = x + 24;

    zoneGroups.forEach((subnets, zoneKey) => {
      const zoneTop = innerTop;
      let subnetY = zoneTop + 30;
      let zoneWidth = NODE_WIDTH + 64;

      subnets.forEach(subnet => {
        const subnetX = zoneX + 16;
        const members = providerNodes.filter(n => n.parentSubnetId === subnet.id);

        let nodeY = subnetY + 42;
        members.forEach(member => {
          placeNode(member, subnetX + 16, nodeY);
          nodeY += NODE_HEIGHT + NODE_GAP_Y;
        });

        const subnetHeight = Math.max(120, (nodeY - subnetY) + 12);
        const subnetWidth = NODE_WIDTH + 32;
        zoneWidth = Math.max(zoneWidth, subnetWidth + 32);

        subnet.renderedAsContainer = true;
        containers.push({
          id: subnet.id,
          type: 'subnet',
          providerId: provider.id,
          title: `${terms.subnet}: ${subnet.name || subnet.cidr || terms.subnet}`,
          subtitle: subnet.cidr || subnet.zone || subnet.region || '',
          action: subnet.action,
          x: subnetX,
          y: subnetY,
          width: subnetWidth,
          height: subnetHeight,
          tier: isPublicSubnet(provider, subnet) ? 'public' : 'private'
        });

        subnetY += subnetHeight + 24;
      });

      const zoneHeight = subnetY - zoneTop + 8;
      containers.push({
        id: `zone-${provider.id}-${network.id}-${zoneKey}`,
        type: 'zone',
        providerId: provider.id,
        title: `${terms.zone}: ${zoneKey}`,
        x: zoneX,
        y: zoneTop,
        width: zoneWidth,
        height: zoneHeight
      });

      innerBottom = Math.max(innerBottom, zoneTop + zoneHeight);
      zoneX += zoneWidth + 28;
      width = Math.max(width, zoneX - x + 24);
    });
  }

  // Network-scoped resources that sit outside any subnet.
  if (networkOnlyNodes.length > 0) {
    let nodeX = x + 24;
    let nodeY = innerBottom + (zoneGroups.size > 0 ? 24 : 0);
    networkOnlyNodes.forEach((node, i) => {
      if (i > 0 && i % 3 === 0) {
        nodeX = x + 24;
        nodeY += NODE_HEIGHT + NODE_GAP_Y;
      }
      placeNode(node, nodeX, nodeY);
      nodeX += NODE_WIDTH + NODE_GAP_X;
      width = Math.max(width, nodeX - x + 24);
    });
    innerBottom = nodeY + NODE_HEIGHT;
  }

  const height = Math.max(200, innerBottom - y + 28);

  network.renderedAsContainer = true;
  containers.push({
    id: network.id,
    type: 'network',
    providerId: provider.id,
    title: `${terms.network}: ${network.name || terms.network}`,
    subtitle: network.cidr || network.region || '',
    action: network.action,
    accentColor: provider.accentColor,
    x,
    y,
    width,
    height
  });

  return { width, height };
}

function routeEdges(nodes, edges) {
  const nodeMap = new Map();
  nodes.forEach(n => {
    if (n.x !== undefined && n.y !== undefined) {
      nodeMap.set(n.id, n);
    }
  });

  return edges
    .map(edge => {
      const srcNode = nodeMap.get(edge.source);
      const tgtNode = nodeMap.get(edge.target);
      if (!srcNode || !tgtNode) return null;

      const { srcPos, tgtPos, srcSide, tgtSide } = computePerimeterAnchor(srcNode, tgtNode);
      return {
        ...edge,
        srcPos,
        tgtPos,
        srcSide,
        tgtSide,
        x1: srcPos.x,
        y1: srcPos.y,
        x2: tgtPos.x,
        y2: tgtPos.y
      };
    })
    .filter(Boolean);
}

/**
 * Calculates connection anchor points at the outer boundaries of the source
 * and target node cards so arrowheads and flow lines sit cleanly on the borders
 * rather than terminating hidden beneath opaque card surfaces.
 */
function computePerimeterAnchor(srcNode, tgtNode) {
  const w1 = srcNode.width || NODE_WIDTH;
  const h1 = srcNode.height || NODE_HEIGHT;
  const w2 = tgtNode.width || NODE_WIDTH;
  const h2 = tgtNode.height || NODE_HEIGHT;

  const cx1 = srcNode.x + w1 / 2;
  const cy1 = srcNode.y + h1 / 2;
  const cx2 = tgtNode.x + w2 / 2;
  const cy2 = tgtNode.y + h2 / 2;

  const dx = cx2 - cx1;
  const dy = cy2 - cy1;

  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return {
      srcPos: { x: cx1, y: cy1 },
      tgtPos: { x: cx2, y: cy2 },
      srcSide: 'bottom',
      tgtSide: 'top'
    };
  }

  // Source box boundary ray intersection
  const hw1 = w1 / 2;
  const hh1 = h1 / 2;
  const tx1 = Math.abs(dx) > 0 ? hw1 / Math.abs(dx) : Infinity;
  const ty1 = Math.abs(dy) > 0 ? hh1 / Math.abs(dy) : Infinity;
  const t1 = Math.min(tx1, ty1);

  const srcX = cx1 + dx * t1;
  const srcY = cy1 + dy * t1;
  const srcSide = t1 === ty1 ? (dy > 0 ? 'bottom' : 'top') : (dx > 0 ? 'right' : 'left');

  // Target box boundary ray intersection
  const hw2 = w2 / 2;
  const hh2 = h2 / 2;
  const tx2 = Math.abs(dx) > 0 ? hw2 / Math.abs(dx) : Infinity;
  const ty2 = Math.abs(dy) > 0 ? hh2 / Math.abs(dy) : Infinity;
  const t2 = Math.min(tx2, ty2);

  // Leave a 2px gap at the target perimeter for the arrowhead marker tip
  const dist = Math.hypot(dx, dy);
  const offset = Math.min(t2 + (dist > 0 ? 2 / dist : 0), 1);

  const tgtX = cx2 - dx * offset;
  const tgtY = cy2 - dy * offset;
  const tgtSide = t2 === ty2 ? (dy > 0 ? 'top' : 'bottom') : (dx > 0 ? 'left' : 'right');

  return {
    srcPos: { x: Math.round(srcX * 10) / 10, y: Math.round(srcY * 10) / 10 },
    tgtPos: { x: Math.round(tgtX * 10) / 10, y: Math.round(tgtY * 10) / 10 },
    srcSide,
    tgtSide
  };
}

function computeBounds(nodes, containers, minWidth, minHeight) {
  // Track the real extent of the drawing: padding the canvas out to arbitrary
  // minimums makes fit-to-screen zoom out further than necessary and leaves
  // dead space in exported SVGs.
  let maxX = 0;
  let maxY = 0;

  nodes.forEach(n => {
    if (n.x === undefined) return;
    maxX = Math.max(maxX, n.x + (n.width ?? NODE_WIDTH));
    maxY = Math.max(maxY, n.y + (n.height ?? NODE_HEIGHT));
  });
  containers.forEach(c => {
    maxX = Math.max(maxX, c.x + c.width);
    maxY = Math.max(maxY, c.y + c.height);
  });

  const PADDING = 40;
  return {
    // The floor keeps an empty plan from collapsing to a zero-sized canvas.
    width: Math.max(maxX + PADDING, 400),
    height: Math.max(maxY + PADDING, 300)
  };
}
