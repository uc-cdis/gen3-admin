// =============================================================================
// plan-diagram.mjs - Architecture diagram data for a saved plan
//
// Run by the runner prelude after `terraform show -json`, with the plan JSON
// and an output path:
//
//   node plan-diagram.mjs <plan.json> <diagram.json>
//
// It parses the plan with the vendored tf-arch parser (third_party/tf-arch),
// folds plumbing into the resource it belongs to, lays the rest out with
// tf-arch's layout engine, and writes only what the portal draws: addresses,
// types, actions, services, containment, positions, edges, and the icons in
// use. The plan's attribute values, which can be secret, are never written.
// The API decodes the output into a fixed shape before storing it, so a field
// added here by mistake is dropped there too.
// =============================================================================
import fs from 'node:fs';

const VENDOR = process.env.TF_ARCH_DIR || '/gen3-admin/third_party/tf-arch';
const { parseTerraformPlan } = await import(`${VENDOR}/src/parser/tfPlanParser.js`);
const { computeArchitectureLayout } = await import(`${VENDOR}/src/canvas/layoutEngine.js`);

// Resources that configure another resource rather than being one. Each is
// shown as a count on its owner (the resource of ownerType it references).
const PLUMBING = [
  { match: /^aws_(main_)?route_table_association$/, owner: ['aws_route_table', 'aws_subnet'] },
  { match: /^aws_route$/, owner: ['aws_route_table'] },
  { match: /^aws_iam_(role_policy_attachment|role_policy|policy_attachment|instance_profile)$/, owner: ['aws_iam_role'] },
  { match: /^aws_iam_policy$/, owner: ['aws_iam_role', 'aws_iam_user', 'aws_iam_group'] },
  { match: /^aws_iam_(access_key|user_policy|user_policy_attachment|user_group_membership)$/, owner: ['aws_iam_user'] },
  { match: /^aws_(vpc_)?security_group_(rule|ingress_rule|egress_rule)$/, owner: ['aws_security_group'] },
  { match: /^aws_s3_bucket_.+$/, owner: ['aws_s3_bucket'] },
  { match: /^aws_kms_(alias|key_policy|grant)$/, owner: ['aws_kms_key'] },
  { match: /^aws_acm_certificate_validation$/, owner: ['aws_acm_certificate'] },
  { match: /^aws_cloudwatch_event_target$/, owner: ['aws_cloudwatch_event_rule'] },
  { match: /^aws_launch_template$/, owner: ['aws_autoscaling_group', 'aws_eks_node_group'] },
  { match: /^aws_cloudwatch_log_(subscription_filter|metric_filter|stream)$/, owner: ['aws_cloudwatch_log_group'] },
  { match: /^aws_lambda_permission$/, owner: ['aws_lambda_function'] },
  { match: /^aws_(eip_association|network_interface_attachment|autoscaling_attachment|lb_target_group_attachment)$/, owner: [] },
  { match: /^aws_eks_(addon|access_policy_association|access_entry)$/, owner: ['aws_eks_cluster'] },
  { match: /^aws_sns_topic_(policy|subscription)$/, owner: ['aws_sns_topic'] },
  { match: /^aws_sqs_queue_policy$/, owner: ['aws_sqs_queue'] },
];

// Terraform's own bookkeeping; nothing in the cloud.
const HELPER = /^(random_|time_|null_|archive_|terraform_data$|local_|tls_)/;

function main() {
  const [planPath, outPath] = process.argv.slice(2);
  if (!planPath || !outPath) throw new Error('usage: plan-diagram.mjs <plan.json> <diagram.json>');
  const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const parsed = parseTerraformPlan(raw);

  // A readable name for each resource: its name attribute or Name tag, the
  // one value from the plan the diagram keeps. Values Terraform marks
  // sensitive are skipped, and anything but short printable text. A value
  // that many resources share (a provider default_tags Name, say) does not
  // tell them apart, so it is skipped too.
  const sensitive = new Map((raw.resource_changes || []).map((rc) => [rc.address, rc.change?.after_sensitive || {}]));
  const candidatesOf = (n) => {
    const s = sensitive.get(n.address) || {};
    const a = n.after || {};
    return [
      [a.name, s === true || s.name],
      [a.tags?.Name, s === true || s.tags === true || s.tags?.Name],
      [a.tags_all?.Name, s === true || s.tags_all === true || s.tags_all?.Name],
    ].filter(([v, secret]) => !secret && typeof v === 'string' && /^[\x20-\x7E]{1,128}$/.test(v)).map(([v]) => v);
  };
  const shared = new Map();
  for (const n of parsed.nodes) {
    for (const v of new Set(candidatesOf(n))) shared.set(v, (shared.get(v) || 0) + 1);
  }
  const labelOf = (n) => candidatesOf(n).find((v) => shared.get(v) < 4) || '';

  const isData = (n) => /(^|\.)data\./.test(n.address);
  const hidden = { data_sources: 0, helpers: 0 };
  const plumbing = new Map(); // node id -> rule
  const kept = [];
  for (const n of parsed.nodes) {
    if (isData(n)) { hidden.data_sources++; continue; }
    if (HELPER.test(n.type)) { hidden.helpers++; continue; }
    const rule = PLUMBING.find((r) => r.match.test(n.type));
    if (rule) { plumbing.set(n.id, rule); continue; }
    kept.push(n);
  }
  const keptIds = new Set(kept.map((n) => n.id));
  const byId = new Map(parsed.nodes.map((n) => [n.id, n]));

  // Each plumbing resource folds into a kept neighbour, preferring its
  // owner type, then the nearest kept resource in the same module.
  const neighbours = new Map();
  for (const e of parsed.edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      if (!neighbours.has(a)) neighbours.set(a, []);
      neighbours.get(a).push(b);
    }
  }
  const folded = new Map(); // owner id -> [{address,type,action}]
  let unowned = 0;
  for (const [id, rule] of plumbing) {
    const n = byId.get(id);
    const near = (neighbours.get(id) || []).filter((x) => keptIds.has(x)).map((x) => byId.get(x));
    const owner =
      near.find((m) => rule.owner.includes(m.type)) ||
      near.find((m) => m.module === n.module) ||
      near[0];
    if (!owner) { unowned++; continue; }
    if (!folded.has(owner.id)) folded.set(owner.id, []);
    folded.get(owner.id).push({ address: n.address, type: n.type, action: n.action });
  }
  hidden.unowned_plumbing = unowned;

  // A module that looks up the VPC (data.aws_vpc) instead of taking its ID
  // would draw that VPC twice. When the plan creates exactly one, the lookup
  // is that VPC.
  const managedNetworks = parsed.networkNodes.filter((n) => keptIds.has(n.id));
  if (managedNetworks.length === 1) {
    const only = managedNetworks[0].id;
    for (const n of parsed.nodes) {
      const p = n.parentNetworkId && byId.get(n.parentNetworkId);
      if (p && isData(p)) n.parentNetworkId = only;
    }
  }

  // An AZ picked at apply time (random_shuffle) is unknown in the plan. These
  // subnets share one zone box, which the portal draws as a band across the
  // real zones rather than as a zone of its own.
  const PENDING_ZONE = 'picked at apply';
  for (const s of parsed.subnetNodes) {
    if (keptIds.has(s.id) && !s.zone) s.zone = PENDING_ZONE;
  }

  const edgeKey = new Set();
  const edges = [];
  for (const e of parsed.edges) {
    if (!keptIds.has(e.source) || !keptIds.has(e.target) || e.source === e.target) continue;
    const k = `${e.source}|${e.target}|${e.label}`;
    if (edgeKey.has(k)) continue;
    edgeKey.add(k);
    edges.push(e);
  }

  const layout = computeArchitectureLayout({
    nodes: kept,
    networkNodes: parsed.networkNodes.filter((n) => keptIds.has(n.id)),
    subnetNodes: parsed.subnetNodes.filter((n) => keptIds.has(n.id)),
    edges,
    // Only clouds that still have resources: hidden helpers would otherwise
    // leave an empty band.
    providerIds: parsed.providerIds.filter((id) => kept.some((n) => n.providerId === id)),
  });

  // tf-arch stacks the services that live outside any network (IAM, S3,
  // KMS, logs) below it, which makes a tall, narrow picture. Put them in a
  // block per category to the right of the networks instead.
  const networks = layout.containers.filter((c) => c.type === 'network');
  if (networks.length > 0) {
    const inside = (n) => layout.containers.some((c) => c.type !== 'cloud' &&
      n.x >= c.x && n.y >= c.y && n.x + n.width <= c.x + c.width && n.y + n.height <= c.y + c.height);
    const top = Math.min(...networks.map((c) => c.y));
    const bottom = Math.max(...networks.map((c) => c.y + c.height));
    const right = Math.max(...networks.map((c) => c.x + c.width));
    const outside = layout.nodes.filter((n) => Number.isFinite(n.x) && n.y >= bottom && !inside(n));
    const byCategory = new Map();
    for (const n of outside) {
      const key = n.icon?.categoryName || 'Other';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(n);
    }
    const COLS = 3, W = 180, H = 80, GX = 20, GY = 20, PAD = 16, HEAD = 34;
    const blockW = COLS * W + (COLS - 1) * GX + 2 * PAD;
    let y = top;
    const x = right + 60;
    for (const [category, members] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
      members.sort((a, b) => a.address.localeCompare(b.address));
      members.forEach((n, i) => {
        n.container = `services-${category}`;
        n.x = x + PAD + (i % COLS) * (W + GX);
        n.y = y + HEAD + Math.floor(i / COLS) * (H + GY);
      });
      const rows = Math.ceil(members.length / COLS);
      const height = HEAD + rows * H + (rows - 1) * GY + PAD;
      layout.containers.push({ id: `services-${category}`, type: 'services', title: category,
        subtitle: `${members.length}`, x, y, width: blockW, height });
      y += height + 24;
    }
    const all = [...layout.nodes.filter((n) => Number.isFinite(n.x)), ...layout.containers.filter((c) => c.type !== 'cloud')];
    layout.bounds = {
      width: Math.max(...all.map((b) => b.x + b.width)) + 40,
      height: Math.max(...all.map((b) => b.y + b.height)) + 40,
    };
  }

  // tf-arch falls back to the zone when a subnet's CIDR is unknown, which
  // would repeat the placeholder on every subnet.
  for (const c of layout.containers) {
    if (c.type === 'subnet' && c.subtitle === PENDING_ZONE) c.subtitle = '';
  }

  const containerIds = new Set(layout.containers.map((c) => c.id));
  // The innermost box each resource sits in, so the portal can collapse
  // and expand boxes without redoing the layout.
  const area = (c) => c.width * c.height;
  const boxes = layout.containers.filter((c) => c.type !== 'cloud').sort((a, b) => area(a) - area(b));
  const containerOf = (n) => n.container || boxes.find((c) =>
    n.x >= c.x && n.y >= c.y && n.x + n.width <= c.x + c.width && n.y + n.height <= c.y + c.height)?.id || '';
  const icons = {};
  const nodes = layout.nodes
    .filter((n) => !containerIds.has(n.id) && Number.isFinite(n.x))
    .map((n) => {
      if (n.icon?.svg) icons[n.icon.key] = n.icon.svg;
      return {
        id: n.id,
        address: n.address,
        name: n.name,
        label: labelOf(n),
        type: n.type,
        action: n.action,
        service: n.icon?.name || '',
        category: n.icon?.categoryName || '',
        color: n.icon?.categoryColor || '',
        icon: n.icon?.key || '',
        container: containerOf(n),
        x: n.x, y: n.y, width: n.width, height: n.height,
        folded: folded.get(n.id) || [],
      };
    });
  const placed = new Set(nodes.map((n) => n.id));

  const out = {
    version: 1,
    generator: 'tf-arch 1.4.2',
    stats: parsed.stats,
    hidden,
    bounds: { width: layout.bounds.width, height: layout.bounds.height },
    containers: layout.containers.map((c) => ({
      id: c.id, type: c.type, title: c.title, label: byId.has(c.id) ? labelOf(byId.get(c.id)) : '', subtitle: c.subtitle || '', tier: c.tier || '',
      action: c.action || '', x: c.x, y: c.y, width: c.width, height: c.height,
      folded: folded.get(c.id) || [],
    })),
    nodes,
    edges: edges
      .filter((e) => (placed.has(e.source) || containerIds.has(e.source)) && (placed.has(e.target) || containerIds.has(e.target)))
      .map((e) => ({ source: e.source, target: e.target, label: e.label, kind: e.type })),
    icons,
  };
  fs.writeFileSync(outPath, JSON.stringify(out), { mode: 0o600 });
  console.log(`diagram: ${nodes.length} resources, ${out.containers.length} containers, ${out.edges.length} edges ` +
    `(${plumbing.size} folded, ${hidden.data_sources} data sources and ${hidden.helpers} helpers hidden)`);
}

try {
  main();
} catch (err) {
  // A diagram is a nicety; the plan itself already succeeded.
  console.log(`warning: no architecture diagram: ${err.message}`);
}
