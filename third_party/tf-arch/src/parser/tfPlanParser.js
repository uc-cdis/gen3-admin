import {
  getIconForType,
  getProviderForType,
  getProvider,
  readFirstAttr
} from '../providers/index.js';

/**
 * Parses Terraform Plan JSON (`terraform show -json tfplan`) or planned-state
 * JSON into a provider-agnostic graph of nodes, containers and edges.
 *
 * Resources from AWS, Google Cloud and Azure can appear in the same plan; each
 * resource is resolved through its own provider definition, so multi-cloud
 * plans render as multiple network hierarchies in one diagram.
 */
export function parseTerraformPlan(planData) {
  let json = planData;
  if (typeof planData === 'string') {
    try {
      json = JSON.parse(planData);
    } catch (e) {
      throw new Error(`Invalid JSON format: ${e.message}`);
    }
  }

  if (!json || typeof json !== 'object') {
    throw new Error('Plan JSON must be an object produced by `terraform show -json`.');
  }

  const stats = { create: 0, update: 0, delete: 0, noop: 0, total: 0 };
  const allNodes = [];

  const resourceChanges = Array.isArray(json.resource_changes) ? json.resource_changes : [];

  resourceChanges.forEach((rc, index) => {
    // A hand-edited or truncated plan can carry nulls or partial entries;
    // skip what cannot be a resource and default what merely lacks a field.
    if (!rc || typeof rc !== 'object') return;
    const actions = Array.isArray(rc.change?.actions) ? rc.change.actions : ['no-op'];
    let action = 'noop';
    if (actions.includes('create')) action = 'create';
    else if (actions.includes('delete')) action = 'delete';
    else if (actions.includes('update')) action = 'update';

    const type = typeof rc.type === 'string' && rc.type ? rc.type : 'unknown';
    const address = typeof rc.address === 'string' && rc.address
      ? rc.address
      : `${type}.${rc.name || `resource_${index}`}`;

    allNodes.push(buildNode({
      address,
      // A deposed object is the old copy of a resource being replaced; it
      // shares the address with its successor, so give it a distinct id.
      id: rc.deposed ? `${address}#deposed-${rc.deposed}` : address,
      name: rc.name,
      type,
      providerNameRaw: rc.provider_name,
      action,
      before: rc.change?.before || {},
      after: rc.change?.after || {},
      module: rc.module_address || null
    }));
    stats[action] += 1;
    stats.total += 1;
  });

  // Fall back to planned/prior state when the plan carries no resource_changes.
  if (allNodes.length === 0) {
    for (const r of collectStateResources(json)) {
      allNodes.push(buildNode({
        address: r.address,
        name: r.name,
        type: r.type,
        providerNameRaw: r.provider_name,
        action: 'create',
        before: {},
        after: r.values || {},
        module: r.module_address || null
      }));
      stats.create += 1;
      stats.total += 1;
    }
  }

  const networkNodes = [];
  const subnetNodes = [];
  const otherNodes = [];

  allNodes.forEach(node => {
    const { hierarchy } = node.provider;
    if (hierarchy.networkTypes.includes(node.type)) networkNodes.push(node);
    else if (hierarchy.subnetTypes.includes(node.type)) subnetNodes.push(node);
    else otherNodes.push(node);
  });

  // `terraform show -json` only carries resolved values: on create, a
  // subnet_id that points at another planned resource is absent from `after`
  // (listed in `after_unknown`), so the containment hierarchy is recovered
  // from the configuration's expression references instead.
  const configReferences = collectConfigurationReferences(json.configuration);
  allNodes.forEach(node => {
    node.configReferences = configReferences.get(stripIndexes(node.address)) || null;
  });

  resolveSubnetParents(subnetNodes, networkNodes);
  resolveResourceParents(otherNodes, subnetNodes, networkNodes);

  const nodes = [...networkNodes, ...subnetNodes, ...otherNodes];
  const { edges, truncated: edgesTruncated } = inferEdges(nodes);

  const providerIds = Array.from(new Set(nodes.map(n => n.providerId)));

  return {
    nodes,
    networkNodes,
    subnetNodes,
    edges,
    edgesTruncated,
    stats,
    providerIds,
    providers: providerIds.map(id => {
      const p = getProvider(id);
      return { id: p.id, name: p.name, shortName: p.shortName, accentColor: p.accentColor };
    }),
    raw: json
  };
}

/** Walks `planned_values` / `prior_state` root and child modules for resources. */
function collectStateResources(json) {
  const roots = [
    json.planned_values?.root_module,
    json.prior_state?.values?.root_module,
    json.values?.root_module
  ].filter(Boolean);

  const out = [];
  const walk = (module) => {
    (module.resources || []).forEach(r => out.push(r));
    (module.child_modules || []).forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

function buildNode({ address, id = address, name, type, providerNameRaw, action, before, after, module }) {
  const provider = getProviderForType(type);
  const { hierarchy } = provider;
  const values = [after, before];

  return {
    id,
    address,
    name: name || address,
    type,
    providerId: provider.id,
    provider,
    providerName: providerNameRaw || provider.id,
    module,
    action,
    icon: getIconForType(type),
    before: before || {},
    after: after || {},
    parentNetworkId: null,
    parentSubnetId: null,
    zone: stringifyRef(readFirstAttr(values, hierarchy.zoneKeys)),
    region: stringifyRef(readFirstAttr(values, hierarchy.regionKeys)),
    cidr: stringifyRef(readFirstAttr(values, hierarchy.cidrKeys)),
    group: stringifyRef(readFirstAttr(values, hierarchy.groupKeys)),
    tags: readFirstAttr(values, hierarchy.tagKeys) || {},
    dependencies: [],
    configReferences: null
  };
}

/** `module.m["a"].aws_instance.web[0]` → `module.m.aws_instance.web` */
function stripIndexes(address) {
  // Linear scan rather than /\[[^\]]*\]/g: addresses come from the plan, and
  // a run of unmatched '[' makes that regex quadratic. Same semantics — an
  // unterminated '[' is kept verbatim.
  const text = String(address || '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('[', i);
    if (open === -1) { out += text.slice(i); break; }
    const close = text.indexOf(']', open + 1);
    if (close === -1) { out += text.slice(i); break; }
    out += text.slice(i, open);
    i = close + 1;
  }
  return out;
}

/**
 * `aws_subnet.private[0].id`, `aws_subnet.private.id`, `aws_subnet.private`
 * and `data.aws_vpc.main.id` → the resource address without index/attribute.
 */
function referenceBase(reference) {
  const parts = stripIndexes(reference).split('.');
  const keep = parts[0] === 'data' ? 3 : 2;
  if (parts.length < keep || parts.some(p => !p)) return null;
  return parts.slice(0, keep).join('.');
}

/**
 * Maps every configured resource address to the set of resource addresses its
 * expressions reference, walking nested blocks and child modules (whose
 * references are module-relative, so they are prefixed with the module path).
 */
function collectConfigurationReferences(configuration) {
  const refs = new Map();
  if (!configuration || typeof configuration !== 'object') return refs;

  const visitExpressions = (value, onReference, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 32) return;
    if (Array.isArray(value)) {
      value.forEach(v => visitExpressions(v, onReference, depth + 1));
      return;
    }
    if (Array.isArray(value.references)) {
      value.references.forEach(r => { if (typeof r === 'string') onReference(r); });
    }
    Object.values(value).forEach(v => visitExpressions(v, onReference, depth + 1));
  };

  const visitModule = (module, prefix) => {
    if (!module || typeof module !== 'object') return;
    (module.resources || []).forEach(resource => {
      if (!resource || typeof resource !== 'object' || typeof resource.address !== 'string') return;
      const address = prefix ? `${prefix}.${resource.address}` : resource.address;
      const targets = new Set();
      visitExpressions(resource.expressions, (reference) => {
        const base = referenceBase(reference);
        if (base) targets.add(prefix ? `${prefix}.${base}` : base);
      });
      if (targets.size > 0) refs.set(address, targets);
    });
    Object.entries(module.module_calls || {}).forEach(([name, call]) => {
      visitModule(call?.module, prefix ? `${prefix}.module.${name}` : `module.${name}`);
    });
  };

  visitModule(configuration.root_module, '');
  return refs;
}

/** Groups nodes by provider once so parent resolution is linear, not n × containers. */
function groupByProvider(nodes) {
  const groups = new Map();
  nodes.forEach(n => {
    if (!groups.has(n.providerId)) groups.set(n.providerId, []);
    groups.get(n.providerId).push(n);
  });
  return groups;
}

/**
 * Finds the container a node belongs to: first by the attribute value Terraform
 * resolved (address, self-link, cloud id), then by the configuration reference
 * when the value is only known after apply.
 */
function findParent(node, ref, candidates) {
  if (ref) {
    const match = candidates.find(c => referenceMatches(ref, c));
    if (match) return match;
  }
  if (node.configReferences) {
    return candidates.find(c => node.configReferences.has(stripIndexes(c.address))) || null;
  }
  return null;
}

function stringifyRef(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

/**
 * Matches a reference value (which in a plan is often an unresolved address,
 * a self-link, or an Azure resource id) against a candidate container node.
 */
function referenceMatches(ref, candidate) {
  if (!ref) return false;
  const value = String(ref);
  const haystack = value.toLowerCase();
  // Real plans hold cloud ids (`subnet-0f9e…`, ARM paths, self-links) rather
  // than Terraform addresses, so the container's own id is a candidate too.
  const candidates = [
    candidate.address, candidate.name,
    candidate.after?.id, candidate.before?.id,
    candidate.after?.name, candidate.before?.name,
    candidate.after?.arn, candidate.before?.arn
  ]
    .filter(v => typeof v === 'string' || typeof v === 'number')
    .map(String)
    .filter(v => v.length >= 3); // never let a stray "a" match everything

  return candidates.some(c => {
    const needle = c.toLowerCase();
    // Terraform ids and self-links are path-like; compare the last segment too.
    const lastSegment = haystack.split('/').pop();
    return haystack.includes(needle) || needle.includes(haystack) || lastSegment === needle;
  });
}

function resolveSubnetParents(subnetNodes, networkNodes) {
  const networksByProvider = groupByProvider(networkNodes);

  subnetNodes.forEach(subnet => {
    const sameProviderNetworks = networksByProvider.get(subnet.providerId) || [];
    const ref = readFirstAttr([subnet.after, subnet.before], subnet.provider.hierarchy.networkRefKeys);

    const match = findParent(subnet, ref, sameProviderNetworks);
    if (match) subnet.parentNetworkId = match.id;
    if (!subnet.parentNetworkId && sameProviderNetworks.length > 0) {
      subnet.parentNetworkId = sameProviderNetworks[0].id;
    }
  });
}

function resolveResourceParents(otherNodes, subnetNodes, networkNodes) {
  const subnetsByProvider = groupByProvider(subnetNodes);
  const networksByProvider = groupByProvider(networkNodes);

  otherNodes.forEach(node => {
    const { hierarchy } = node.provider;
    const values = [node.after, node.before];
    const sameProviderSubnets = subnetsByProvider.get(node.providerId) || [];
    const sameProviderNetworks = networksByProvider.get(node.providerId) || [];

    const subnet = findParent(node, readFirstAttr(values, hierarchy.subnetRefKeys), sameProviderSubnets);
    if (subnet) {
      node.parentSubnetId = subnet.id;
      node.parentNetworkId = subnet.parentNetworkId;
    }

    if (!node.parentNetworkId) {
      const network = findParent(node, readFirstAttr(values, hierarchy.networkRefKeys), sameProviderNetworks);
      if (network) node.parentNetworkId = network.id;
    }
  });
}

/**
 * Upper bound on inferred edges. Provider heuristics connect resources by
 * type (every instance to every bucket it might use), which is quadratic in
 * the worst case: a 5,000-resource plan produced ~400k edges, a 400 MB SVG
 * and an out-of-memory crash at 20k. Past this bound edges are counted, not
 * drawn, and the CLI/viewer say so.
 */
export const MAX_EDGES = 5000;

/**
 * Builds architecture edges by:
 * 1. Extracting real reference links from Terraform configuration expressions
 *    and attribute values (e.g. security groups, KMS keys, target groups, IAM roles).
 * 2. Delegating high-level architectural flows to each provider present in the plan.
 */
function inferEdges(nodes) {
  const edges = [];
  const edgeSet = new Set();
  let truncated = 0;

  const addEdge = (sourceId, targetId, label = '', type = 'solid') => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const key = `${sourceId}->${targetId}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    if (edges.length >= MAX_EDGES) {
      truncated += 1;
      return;
    }
    edges.push({ id: `edge-${edges.length + 1}`, source: sourceId, target: targetId, label, type, relation: type });
  };

  inferReferenceEdges(nodes, addEdge);

  const byProvider = new Map();
  nodes.forEach(n => {
    if (!byProvider.has(n.providerId)) byProvider.set(n.providerId, []);
    byProvider.get(n.providerId).push(n);
  });

  byProvider.forEach((providerNodes, providerId) => {
    getProvider(providerId).inferEdges(providerNodes, addEdge);
  });

  return { edges, truncated };
}

/**
 * Extracts architectural edges from explicit Terraform expressions and attributes.
 */
function inferReferenceEdges(nodes, addEdge) {
  const byAddressBase = new Map();
  nodes.forEach(n => {
    byAddressBase.set(stripIndexes(n.address), n);
  });

  const byProvider = groupByProvider(nodes);

  nodes.forEach(source => {
    // 1. Configuration expression references
    if (source.configReferences && source.configReferences.size > 0) {
      source.configReferences.forEach(targetAddressBase => {
        const target = byAddressBase.get(targetAddressBase);
        if (!target || target.id === source.id) return;
        if (target.providerId !== source.providerId) return;

        // Skip parent container containment (already rendered as visual boxes)
        if (target.id === source.parentSubnetId || target.id === source.parentNetworkId) return;
        if (source.id === target.parentSubnetId || source.id === target.parentNetworkId) return;

        const { label, type, reverse } = classifyRelation(source, target);
        if (reverse) {
          addEdge(target.id, source.id, label, type);
        } else {
          addEdge(source.id, target.id, label, type);
        }
      });
    }

    // 2. Resolved attribute references in values (after / before)
    const sameProviderCandidates = byProvider.get(source.providerId) || [];
    findAttributeMatches(source, sameProviderCandidates, (target, attrKey) => {
      if (!target || target.id === source.id) return;
      if (target.id === source.parentSubnetId || target.id === source.parentNetworkId) return;
      if (source.id === target.parentSubnetId || source.id === target.parentNetworkId) return;

      const { label, type, reverse } = classifyRelation(source, target, attrKey);
      if (reverse) {
        addEdge(target.id, source.id, label, type);
      } else {
        addEdge(source.id, target.id, label, type);
      }
    });
  });
}

function findAttributeMatches(source, candidates, onMatch) {
  const values = [source.after, source.before];
  const seenTargets = new Set();

  const scan = (val, keyPath = '', depth = 0) => {
    if (!val || depth > 16) return;
    if (typeof val === 'string' || typeof val === 'number') {
      const str = String(val);
      if (str.length < 3) return;
      for (const candidate of candidates) {
        if (candidate.id === source.id || seenTargets.has(candidate.id)) continue;
        if (referenceMatches(str, candidate)) {
          seenTargets.add(candidate.id);
          onMatch(candidate, keyPath);
        }
      }
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((item, idx) => scan(item, `${keyPath}.${idx}`, depth + 1));
      return;
    }
    if (typeof val === 'object') {
      Object.entries(val).forEach(([k, v]) => {
        // Skip tags or huge metadata blobs
        if (k === 'tags' || k === 'labels' || k === 'tags_all') return;
        scan(v, k, depth + 1);
      });
    }
  };

  values.forEach(v => scan(v));
}

function classifyRelation(source, target, attrKey = '') {
  const sType = source.type.toLowerCase();
  const tType = target.type.toLowerCase();
  const key = String(attrKey).toLowerCase();

  // KMS / Encryption
  if (tType.includes('kms') || key.includes('kms') || key.includes('encryption')) {
    return { label: 'KMS', type: 'security', reverse: false };
  }
  if (sType.includes('kms')) {
    return { label: 'KMS', type: 'security', reverse: true };
  }

  // Security Groups / Firewalls / NSG
  if (tType.includes('security_group') || tType.includes('firewall') || tType.includes('_nsg') || key.includes('security_group') || key.includes('nsg')) {
    return { label: 'Secured By', type: 'security', reverse: false };
  }

  // IAM Role / Identity / Secrets
  if (tType.includes('iam_role') || tType.includes('service_account') || key.includes('role_arn') || key.includes('role')) {
    return { label: 'IAM Role', type: 'security', reverse: false };
  }
  if (tType.includes('secret') || key.includes('secret') || tType.includes('key_vault')) {
    return { label: 'Secrets', type: 'security', reverse: false };
  }

  // Load balancing & listeners
  if ((sType.includes('listener') || sType.includes('lb_rule')) && (tType.includes('target_group') || tType.includes('backend'))) {
    return { label: 'Forward', type: 'traffic', reverse: false };
  }
  if (sType.includes('lb') && (tType.includes('target_group') || tType.includes('backend'))) {
    return { label: 'Routes To', type: 'traffic', reverse: false };
  }
  if ((tType.includes('lb') || tType.includes('load_balancer')) && (sType.includes('listener') || sType.includes('target_group'))) {
    return { label: 'Forward', type: 'traffic', reverse: true };
  }
  if (tType.includes('target_group') && (sType.includes('instance') || sType.includes('ecs') || sType.includes('app'))) {
    return { label: 'Target', type: 'traffic', reverse: true };
  }

  // Container registries
  if (tType.includes('ecr') || tType.includes('artifact_registry') || tType.includes('container_registry')) {
    return { label: 'Image Pull', type: 'dependency', reverse: false };
  }

  // Peering & gateways
  if (tType.includes('peering') || sType.includes('peering')) {
    return { label: 'VPC Peering', type: 'peering', reverse: false };
  }
  if (tType.includes('transit_gateway') || sType.includes('transit_gateway')) {
    return { label: 'TGW', type: 'peering', reverse: false };
  }
  if (sType.includes('route') && (tType.includes('gateway') || tType.includes('nat'))) {
    return { label: 'Route', type: 'dependency', reverse: false };
  }

  // DNS & Edge
  if (sType.includes('route53') || sType.includes('dns')) {
    return { label: 'DNS', type: 'traffic', reverse: false };
  }
  if (tType.includes('route53') || tType.includes('dns')) {
    return { label: 'DNS', type: 'traffic', reverse: true };
  }

  // Databases & Storage
  if (tType.includes('db') || tType.includes('rds') || tType.includes('sql') || tType.includes('cosmos') || tType.includes('spanner')) {
    return { label: 'Data', type: 'solid', reverse: false };
  }
  if (tType.includes('s3') || tType.includes('storage') || tType.includes('bucket')) {
    return { label: 'Storage', type: 'solid', reverse: false };
  }
  if (tType.includes('queue') || tType.includes('topic') || tType.includes('sqs') || tType.includes('sns') || tType.includes('pubsub')) {
    return { label: 'Messaging', type: 'solid', reverse: false };
  }

  return { label: 'References', type: 'solid', reverse: false };
}

