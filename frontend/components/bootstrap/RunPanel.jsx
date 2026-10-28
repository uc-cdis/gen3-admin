import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Code, Collapse, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconChevronUp, IconPlayerPlay, IconX } from '@tabler/icons-react';
import { TerraformConfigViewer, TerraformLogsViewer } from '@/components/TerraformExecutor';
import { OP_LABEL, runName } from '@/lib/wizardState';

// Terraform's diagnostics, and the scripts' own failures, out of a log: the
// line saying what went wrong and the few under it saying where.
function errorsOf(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] ?? '').replace(/^│\s?/, '');
    if (/^Error: /.test(line)) {
      const detail = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const next = String(lines[j] ?? '').replace(/^│\s?/, '');
        if (!next.trim() || /^Error: /.test(next)) break;
        detail.push(next);
      }
      out.push({ title: line.slice(7), detail });
    } else if (/^(FAILED|ERROR)\b|timed out waiting/i.test(line)) {
      out.push({ title: line, detail: [] });
    }
  }
  return out.slice(0, 5);
}

/**
 * The run shown on this step: why the last one could not start, what its
 * errors were, and its log, open while it runs or right after it failed and
 * folded otherwise. The Advanced fold has the single operations the state
 * allows. What runs is the page's to decide; this only shows it.
 */
export default function RunPanel({ runner, failed = false, ops = [], onRun, onTeardown = null, config, showConfig = false, disabled = false, advanced = true }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { run, lines, running, error } = runner;
  const [open, setOpen] = useState(running || failed);
  useEffect(() => { setOpen(running || failed); }, [running, failed, run?.id]);
  const logsEnd = useRef(null);
  useEffect(() => {
    if (logsEnd.current) logsEnd.current.scrollTop = logsEnd.current.scrollHeight;
  }, [lines, open]);
  const errors = useMemo(() => (failed && !running ? errorsOf(lines) : []), [failed, running, lines]);

  return (
    <Stack gap="sm">
      {error && (
        <Alert color={error.code === 'sso_expired' ? 'yellow' : 'red'} icon={<IconX />} withCloseButton onClose={runner.clearError}
          title={`The ${runName(error.operation)} did not start`}>
          <Stack gap="xs">
            <Text size="sm">{error.code === 'sso_expired' ? 'Your AWS SSO session has expired.' : error.message}</Text>
            {error.loginCommand && (
              <>
                <Text size="sm">Sign in from a terminal, then try again:</Text>
                <Code block>{error.loginCommand}</Code>
              </>
            )}
            <Text size="xs" c="dimmed">Nothing ran, so nothing in AWS or the state bucket changed.</Text>
          </Stack>
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert color="red" icon={<IconX />} title={`What the ${runName(run.operation)} reported`}>
          <Stack gap="xs">
            {errors.map((e, i) => (
              <div key={i}>
                <Text size="sm" fw={500}>{e.title}</Text>
                {e.detail.length > 0 && <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>{e.detail.join('\n')}</Text>}
              </div>
            ))}
          </Stack>
        </Alert>
      )}

      {run && (
        <Paper withBorder p="sm" radius="md">
          <UnstyledButton onClick={() => setOpen((v) => !v)} style={{ width: '100%' }}>
            <Group justify="space-between">
              <Group gap="xs">
                {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                <Text fw={600} size="sm">{running ? `${OP_LABEL[run.operation] || run.operation} log` : `Last run log: ${runName(run.operation)}`}</Text>
                <Badge size="xs" variant="light" color={running ? 'blue' : failed ? 'red' : 'gray'}>
                  {running ? 'running' : failed ? 'failed' : 'finished'}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" ff="monospace">{run.id}</Text>
            </Group>
          </UnstyledButton>
          <Collapse expanded={open}>
            <div style={{ marginTop: 8 }}>
              <TerraformLogsViewer logs={lines} isExecuting={running} logsEndRef={logsEnd} />
            </div>
          </Collapse>
        </Paper>
      )}

      {advanced && (
        <div>
          <Button variant="subtle" size="xs" color="gray" onClick={() => setShowAdvanced((v) => !v)}
            rightSection={showAdvanced ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}>
            Advanced
          </Button>
          <Collapse expanded={showAdvanced}>
            <Stack gap="sm" mt="xs">
              <Text size="xs" c="dimmed">
                Single operations, for when the banner&apos;s button is not what you need. Only the ones that
                make sense now are enabled. Tear down removes everything, in order.
              </Text>
              <Group gap="xs">
                {['init', 'plan', 'apply', 'install-csoc', 'finish-csoc'].map((op) => (
                  <Button key={op} size="xs" variant="default" leftSection={<IconPlayerPlay size={14} />}
                    disabled={disabled || running || !ops.includes(op)} onClick={() => onRun(op)}>
                    {OP_LABEL[op]}
                  </Button>
                ))}
                {onTeardown && (
                  <Button size="xs" variant="light" color="red" disabled={running} onClick={onTeardown}>Tear down…</Button>
                )}
              </Group>
              {showConfig && config && <TerraformConfigViewer config={config} />}
            </Stack>
          </Collapse>
        </div>
      )}
    </Stack>
  );
}
