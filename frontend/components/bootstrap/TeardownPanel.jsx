import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Code, Group, List, Loader, Paper, Select, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { IconCheck, IconMinus, IconPlayerPlay, IconX } from '@tabler/icons-react';
import { parseApplyProgress } from '@/lib/applyProgress';

const hasCSOC = (s) => s === 'bootstrapped' || s === 'installed';
const hasInfra = (s) => s === 'applied' || s === 'partial' || hasCSOC(s);

const STEP_ICON = {
  pending: <ThemeIcon size="sm" radius="xl" variant="light" color="gray"><IconMinus size={12} /></ThemeIcon>,
  running: <Loader size={18} />,
  done: <ThemeIcon size="sm" radius="xl" color="green"><IconCheck size={12} /></ThemeIcon>,
  failed: <ThemeIcon size="sm" radius="xl" color="red"><IconX size={12} /></ThemeIcon>,
  skipped: <ThemeIcon size="sm" radius="xl" variant="light" color="gray"><IconMinus size={12} /></ThemeIcon>,
};

function runStep(env, op, doneWhen) {
  const r = env?.last_run;
  if (r?.operation === op && r.status === 'running') return 'running';
  if (r?.operation === op && r.status !== 'succeeded') return 'failed';
  return doneWhen ? 'done' : 'pending';
}

/**
 * Tears an environment down in order: what the install added outside
 * Terraform, then everything Terraform created, then, if asked, the hosted
 * zone with its delegation and the state bucket, which takes the registry
 * with it. The page runs the steps (see bootstrap.jsx); this shows them and
 * collects the options.
 */
export default function TeardownPanel({
  env, teardown, onStart, onCancel, runner, zoneName, setZoneName, parentAccess, setParentAccess, profiles = [], stateBucket, blocked,
  mode = 'form',
}) {
  const [typed, setTyped] = useState('');
  const [force, setForce] = useState(true);
  const [zone, setZone] = useState(false);
  const [bucket, setBucket] = useState(false);
  const status = env?.status;
  const armed = teardown.armed;
  const plan = teardown.plan || { uninstall: hasCSOC(status), destroy: hasInfra(status) };

  const destroyProgress = useMemo(() => {
    if (runner.run?.operation !== 'destroy') return null;
    const p = parseApplyProgress(runner.lines);
    let done = 0;
    let going = 0;
    p.forEach((v) => {
      if (v.op !== 'delete') return;
      if (v.state === 'done') done += 1;
      else if (v.state === 'running') going += 1;
    });
    return { done, going, errors: p.errors || [] };
  }, [runner.run, runner.lines]);

  const allSteps = [
    {
      key: 'uninstall', label: 'Uninstall the CSOC',
      detail: 'Load balancers, volumes, Karpenter nodes, DNS records and secrets the install added outside Terraform.',
      // Done once nothing of the CSOC is recorded; skipped only if it was
      // never installed, or the operator chose to destroy without it.
      state: teardown.skipUninstall || (!plan.uninstall && !env?.install) ? 'skipped'
        : runStep(env, 'uninstall-csoc', !hasCSOC(status) && (!armed || teardown.uninstalled)),
    },
    {
      key: 'destroy', label: 'Destroy the infrastructure',
      detail: destroyProgress && (destroyProgress.done || destroyProgress.going)
        ? `${destroyProgress.done} destroyed${destroyProgress.going ? `, ${destroyProgress.going} in progress` : ''}.`
        : 'terraform destroy: the cluster, VPC, Squid, IAM roles and the certificate. 20 to 30 minutes.',
      state: !plan.destroy && status !== 'partial' && status !== 'destroyed' ? 'skipped'
        : armed && env?.last_run?.operation === 'init' && env.last_run.status === 'running' ? 'running'
          : runStep(env, 'destroy', status === 'destroyed'),
    },
    {
      key: 'zone', label: `Delete the hosted zone ${zoneName || ''}`,
      detail: 'And the NS records that delegate it from its parent. Only a zone the bootstrap created is deleted.',
      state: !(armed ? teardown.zone : zone) ? 'skipped' : teardown.results.zone?.error ? 'failed'
        : teardown.results.zone?.done ? 'done' : teardown.phase === 'zone' ? 'running' : 'pending',
      result: teardown.results.zone,
    },
    {
      key: 'bucket', label: `Delete the state bucket ${stateBucket}`,
      detail: 'Every version of every object, then the bucket. This removes the registry: the wizard forgets every environment in it.',
      state: !(armed ? teardown.bucket : bucket) ? 'skipped' : teardown.results.bucket?.error ? 'failed'
        : teardown.results.bucket?.done ? 'done' : teardown.phase === 'bucket' ? 'running' : 'pending',
      result: teardown.results.bucket,
    },
  ];
  // Without a zone of ours (DNS run elsewhere) there is none to delete.
  const steps = allSteps.filter((st) => st.key !== 'zone' || zoneName);
  const confirmName = env?.name || '';

  return (
    <Paper withBorder p="md" radius="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Text fw={600}>Tear down {confirmName}</Text>
            <Text size="xs" c="dimmed">
              {mode === 'form'
                ? 'Each step starts once the one before it has succeeded. Choose what goes, then confirm.'
                : 'A failed step stops the teardown here; its errors and log are below, and the banner retries it.'}
            </Text>
          </div>
          {armed && <Badge color="red" variant="light">in progress</Badge>}
          {!armed && mode === 'progress' && <Badge color="red" variant="light">stopped</Badge>}
        </Group>

        <Stack gap="sm">
          {steps.map((s) => (
            <Group key={s.key} gap="sm" align="flex-start" wrap="nowrap" opacity={s.state === 'skipped' ? 0.5 : 1}>
              <div style={{ width: 20, paddingTop: 2 }}>{STEP_ICON[s.state]}</div>
              <Stack gap={2} style={{ flex: 1 }}>
                <Group gap="xs">
                  <Text size="sm" fw={500}>{s.label}</Text>
                  {s.state === 'skipped' && <Text size="xs" c="dimmed">skipped</Text>}
                </Group>
                <Text size="xs" c="dimmed">{s.detail}</Text>
                {s.result?.error && <Text size="xs" c="red">{s.result.error}</Text>}
                {s.result?.remaining?.length > 0 && (
                  <List size="xs">{s.result.remaining.map((r) => <List.Item key={r}><Code>{r}</Code></List.Item>)}</List>
                )}
                {s.result?.note && <Text size="xs" c="dimmed">{s.result.note}</Text>}
              </Stack>
            </Group>
          ))}
        </Stack>

        {destroyProgress?.errors.length > 0 && (
          <Alert color="red" icon={<IconX />} title="The destroy reported errors">
            <Stack gap={4}>
              {destroyProgress.errors.map((e) => (
                <Text size="xs" key={e.address}><Code>{e.address}</Code>: {e.error}</Text>
              ))}
            </Stack>
          </Alert>
        )}

        {mode === 'form' && !armed && (
          <Stack gap="sm">
            {(plan.uninstall || hasInfra(status) || status === 'partial') && (
              <Checkbox checked={force} onChange={(e) => setForce(e.currentTarget.checked)}
                label="Force: don't wait for anything graceful"
                description="Terminates the cluster's nodes instead of draining them, drops stuck finalizers and deletes its volumes directly. Right for a test or workshop environment." />
            )}
            {zoneName && (
              <Checkbox checked={zone} onChange={(e) => setZone(e.currentTarget.checked)}
                label="Also delete the hosted zone and its delegation" />
            )}
            {zone && zoneName && (
              <Group grow align="flex-start">
                <TextInput size="xs" label="Zone" value={zoneName} onChange={(e) => setZoneName(e.target.value.trim().toLowerCase())} />
                <Select size="xs" label="Parent zone reached with" value={parentAccess} onChange={(v) => setParentAccess(v || 'same')}
                  data={[{ value: 'same', label: 'These credentials' }, { value: 'manual', label: 'Nothing: I remove the NS records myself' },
                    ...profiles.map((p) => ({ value: p, label: `Profile: ${p}` }))]} />
              </Group>
            )}
            <Checkbox checked={bucket} onChange={(e) => setBucket(e.currentTarget.checked)}
              label="Also empty and delete the state bucket"
              description="Last, and only if every environment in it is destroyed and it holds nothing else. Back to a blank account." />
            <TextInput
              label={<>Type <Code>{confirmName}</Code> to confirm</>}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <Group justify="flex-end">
              {onCancel && <Button variant="default" onClick={onCancel}>Cancel</Button>}
              <Button color="red" leftSection={<IconPlayerPlay size={16} />}
                disabled={typed !== confirmName || blocked || runner.running}
                onClick={() => onStart({ force, zone, bucket, skipUninstall: teardown.skipUninstall })}>
                Tear down
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
