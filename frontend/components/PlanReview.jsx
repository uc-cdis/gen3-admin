import { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Code, Group, Loader, Paper, Progress, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { PlanDiagramLoader, displayName, iconSrc } from '@/components/PlanDiagram';
import { IconAlertTriangle, IconX } from '@tabler/icons-react';
import { ChangeChip, ChangeLegend } from '@/components/ApplyState';
import { STATE_COLOR } from '@/lib/applyProgress';

const ACTIONS = {
  create: { color: 'green', label: 'to create', sign: '+' },
  update: { color: 'yellow', label: 'to update', sign: '~' },
  replace: { color: 'orange', label: 'to replace', sign: '±' },
  delete: { color: 'red', label: 'to destroy', sign: '−' },
};

const countBy = (changes) =>
  changes.reduce((acc, c) => ({ ...acc, [c.action]: (acc[c.action] || 0) + 1 }), {});

function ActionBadges({ counts }) {
  return (
    <Group gap={6}>
      {Object.entries(ACTIONS).map(([action, a]) =>
        counts[action] ? (
          <Badge key={action} color={a.color} variant="outline" size="sm" radius="sm" style={{ textTransform: 'none' }}>{a.sign}{counts[action]} {a.label}</Badge>
        ) : null,
      )}
    </Group>
  );
}

const tally = (changes, progress) => changes.reduce((acc, c) => {
  const s = progress.get(c.address)?.state || 'waiting';
  return { ...acc, [s]: (acc[s] || 0) + 1 };
}, {});

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// What a plan would change, grouped by part of the system. Without runId it
// shows the
// environment's latest successful plan, so a resumed setup has one to review.
// progress, while an apply of this plan is shown, maps each address to where
// it is (see lib/applyProgress); running says whether that apply is going.
export default function PlanReview({ target, environment, runId, progress = null, running = false }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // The run shown, once resolved from runId or the registry's latest plan.
  const [shownRunId, setShownRunId] = useState(null);
  const [view, setView] = useState('list');
  // Open groups. During an apply a group opens by itself the first time
  // something in it starts or fails; closing it again is the operator's call.
  const [opened, setOpened] = useState([]);
  const autoOpened = useRef(new Set());
  // Readable names for the list, from the plan's diagram: a resource's Name
  // tag, or its address shortened, with the service it belongs to.
  const [diagram, setDiagram] = useState(null);
  useEffect(() => {
    if (!shownRunId) return;
    let cancelled = false;
    post('/api/environments/plan-diagram', { ...target, name: environment, run_id: shownRunId })
      .then((d) => { if (!cancelled) setDiagram(d); })
      .catch(() => {}); // the list falls back to addresses
    return () => { cancelled = true; };
  }, [shownRunId]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => {
    const m = new Map();
    if (!diagram) return m;
    const icons = diagram.icons || {};
    for (const n of diagram.nodes || []) {
      const icon = n.icon && icons[n.icon] ? iconSrc(icons[n.icon]) : null;
      m.set(n.address, { name: displayName(n), service: n.service, icon });
      for (const f of n.folded || []) {
        m.set(f.address, { name: displayName(f), service: `part of ${displayName(n)}`, icon });
      }
    }
    return m;
  }, [diagram]);
  useEffect(() => {
    if (!progress || !plan) return;
    const fresh = (plan.groups || []).filter((g) => !autoOpened.current.has(g.name) && g.changes.some((c) => {
      const st = progress.get(c.address)?.state;
      return st === 'running' || st === 'failed';
    })).map((g) => g.name);
    if (fresh.length === 0) return;
    fresh.forEach((n) => autoOpened.current.add(n));
    setOpened((o) => Array.from(new Set([...o, ...fresh])));
  }, [progress, plan]);

  useEffect(() => {
    if (!environment || !target?.bucket) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      let id = runId;
      if (!id) {
        const { runs = [] } = await post('/api/environments/runs', { ...target, name: environment });
        id = runs.find((r) => r.operation === 'plan' && r.status === 'succeeded')?.id;
        if (!id) return null;
      }
      if (!cancelled) setShownRunId(id);
      // The run is recorded a moment after its log stream ends.
      for (let attempt = 0; ; attempt++) {
        try {
          return await post('/api/environments/plan', { ...target, name: environment, run_id: id });
        } catch (err) {
          if (attempt >= 5 || !/not found/.test(err.message)) throw err;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })()
      .then((p) => { if (!cancelled) setPlan(p); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [environment, runId, target?.bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Group gap="xs"><Loader size="xs" /><Text size="sm">Loading the plan…</Text></Group>;
  if (error) return <Text size="sm" c="red">Could not load the plan: {error}</Text>;
  if (!plan) return null;

  const all = (plan.groups || []).flatMap((g) => g.changes || []);
  const counts = countBy(all);
  const risky = all.filter((c) => c.action === 'delete' || c.action === 'replace');
  const applying = progress !== null;
  const totals = applying ? tally(all, progress) : {};
  const failed = applying ? all.filter((c) => progress.get(c.address)?.state === 'failed') : [];
  // Errors about things the plan does not list (lookups, providers).
  const planned = new Set(all.map((c) => c.address));
  const otherErrors = applying ? (progress.errors || []).filter((e) => !planned.has(e.address)) : [];
  const pct = (n) => (all.length ? ((n || 0) / all.length) * 100 : 0);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600}>{applying ? (running ? 'Applying the plan' : 'Last apply of this plan') : 'Plan review'}</Text>
            <Text size="xs" c="dimmed">
              {all.length === 0 ? 'No changes.'
                : applying ? `${totals.done || 0} of ${all.length} done${totals.running ? `, ${totals.running} in progress` : ''}${totals.failed ? `, ${totals.failed} failed` : ''}.`
                  : `${all.length} resources change. Nothing is created until you apply.`}
            </Text>
          </div>
          <SegmentedControl size="xs" value={view} onChange={setView}
            data={[{ label: 'List', value: 'list' }, { label: 'Diagram', value: 'diagram' }]} />
        </Group>

        <Group justify="space-between">
          <ActionBadges counts={counts} />
          <ChangeLegend applying={applying} />
        </Group>

        {applying && all.length > 0 && (
          <Progress.Root size="lg">
            <Progress.Section value={pct(totals.done)} color={STATE_COLOR.done} />
            <Progress.Section value={pct(totals.running)} color={STATE_COLOR.running} animated={running} striped />
            <Progress.Section value={pct(totals.failed)} color={STATE_COLOR.failed} />
          </Progress.Root>
        )}

        {(failed.length > 0 || otherErrors.length > 0) && (
          <Alert color="red" icon={<IconX />}
            title={failed.length > 0 ? `${failed.length} resource${failed.length > 1 ? 's' : ''} failed` : 'The apply failed'}>
            <Stack gap={4}>
              {failed.map((c) => (
                <Text size="xs" key={c.address}><Code>{c.address}</Code>: {progress.get(c.address).error}</Text>
              ))}
              {otherErrors.map((e) => (
                <Text size="xs" key={e.address}><Code>{e.address}</Code>: {e.error}</Text>
              ))}
            </Stack>
          </Alert>
        )}

        {risky.length > 0 && !applying && (
          <Alert color="red" icon={<IconAlertTriangle />} title={`${risky.length} resource${risky.length === 1 ? '' : 's'} will be destroyed or replaced`}>
            <Stack gap={2}>
              {risky.map((c) => (
                <Text size="xs" key={c.address}>
                  <Code>{c.address}</Code> {c.action === 'replace' ? `is replaced${c.reason ? ` (${c.reason.replaceAll('_', ' ')})` : ''}` : 'is destroyed'}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}

        {view === 'diagram' && <PlanDiagramLoader target={target} environment={environment} runId={shownRunId} progress={progress} />}

        {view === 'list' && <Accordion variant="separated" multiple value={opened} onChange={setOpened}>
          {(plan.groups || []).map((g) => (
            <Accordion.Item key={g.name} value={g.name}>
              <Accordion.Control>
                <Group gap="sm">
                  <Text size="sm" fw={500}>{g.name}</Text>
                  <ActionBadges counts={countBy(g.changes)} />
                  {applying && <GroupProgress changes={g.changes} progress={progress} />}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Table fz="xs" verticalSpacing={4} highlightOnHover>
                  <Table.Tbody>
                    {g.changes.map((c) => {
                      const st = applying ? progress.get(c.address) : null;
                      const bg = st?.state === 'running' ? 'var(--mantine-color-blue-light)'
                        : st?.state === 'failed' ? 'var(--mantine-color-red-light)' : undefined;
                      return (
                        <Table.Tr key={c.address} style={bg ? { background: bg } : undefined}>
                          <Table.Td w={170} style={{ whiteSpace: "nowrap" }}><ChangeChip action={c.action} state={st} applying={applying} /></Table.Td>
                          <Table.Td>
                            <Group gap={8} wrap="nowrap">
                              {names.get(c.address)?.icon && <img src={names.get(c.address).icon} alt="" width={18} height={18} />}
                              <div style={{ minWidth: 0 }}>
                                <Text size="sm" fw={500} truncate>{names.get(c.address)?.name || displayName({ address: c.address, type: c.type })}</Text>
                                <Text size="xs" c="dimmed" ff="monospace" truncate title={c.address}>{c.address}</Text>
                              </div>
                            </Group>
                          </Table.Td>
                          <Table.Td c="dimmed">{names.get(c.address)?.service || c.type}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>}
      </Stack>
    </Paper>
  );
}

function GroupProgress({ changes, progress }) {
  const t = tally(changes, progress);
  const color = t.failed ? 'red' : t.running ? 'blue' : (t.done || 0) === changes.length ? 'green' : 'gray';
  return (
    <Badge size="sm" variant="outline" color={color}>
      {t.done || 0}/{changes.length} done{t.failed ? ` · ${t.failed} failed` : ''}
    </Badge>
  );
}
