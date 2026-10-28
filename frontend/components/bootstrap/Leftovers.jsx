import { useState } from 'react';
import { Button, Code, Group, Loader, Paper, Select, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { IconCheck, IconPoint } from '@tabler/icons-react';

function Row({ done, checking, title, detail, children }) {
  return (
    <Group gap="sm" align="flex-start" wrap="nowrap">
      <div style={{ width: 20, paddingTop: 2 }}>
        {checking ? <Loader size={16} />
          : done ? <ThemeIcon size="sm" radius="xl" color="green"><IconCheck size={12} /></ThemeIcon>
            : <ThemeIcon size="sm" radius="xl" color="yellow" variant="light"><IconPoint size={12} /></ThemeIcon>}
      </div>
      <Stack gap={4} style={{ flex: 1 }}>
        <Text size="sm" fw={500}>{title}</Text>
        {detail && <Text size="xs" c="dimmed">{detail}</Text>}
        {children}
      </Stack>
    </Group>
  );
}

// "Delete…" that asks for the name first.
function ConfirmDelete({ name, label, onConfirm, busy, disabled, children }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  if (!asking) {
    return (
      <Group>
        <Button size="xs" color="red" variant="light" disabled={disabled} onClick={() => { setTyped(''); setAsking(true); }}>{label}</Button>
      </Group>
    );
  }
  return (
    <Stack gap="xs" maw={560}>
      {children}
      <TextInput size="xs" label={<>Type <Code>{name}</Code> to confirm</>} value={typed} onChange={(e) => setTyped(e.target.value)} />
      <Group gap="xs">
        <Button size="xs" variant="default" onClick={() => setAsking(false)}>Cancel</Button>
        <Button size="xs" color="red" disabled={typed !== name} loading={busy} onClick={() => { onConfirm(); setAsking(false); }}>Delete</Button>
      </Group>
    </Stack>
  );
}

/**
 * What is left once Terraform has destroyed an environment, checked live
 * rather than remembered, so it is right after a reload too: the hosted
 * zone the bootstrap created and the state bucket. Each can go on its own.
 */
export default function Leftovers({
  zoneName, zone, onDeleteZone, zoneResult, parentAccess, setParentAccess, profiles = [],
  stateBucket, onDeleteBucket, bucketResult, busy, blocked, cert = null, certResult = null, onDeleteCert,
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <div>
          <Text fw={600}>What is left</Text>
          <Text size="xs" c="dimmed">Checked against AWS when this page loads.</Text>
        </div>
        <Row done title="Infrastructure destroyed"
          detail="The cluster, VPC, Squid, IAM roles and certificate, and what the install added to them." />
        {(cert || certResult?.done) && (
          <Row done={Boolean(certResult?.done)} checking={busy === 'cert'}
            title={certResult?.done ? 'Certificate deleted' : 'ACM certificate'}
            detail={certResult?.done ? certResult.note
              : `${cert.arn}. Its validation records are in the zone; deleting the zone deletes it too.`}>
            {certResult?.error && <Text size="xs" c="red">{certResult.error}</Text>}
            {!certResult?.done && cert && (
              <ConfirmDelete name={zoneName || 'certificate'} label="Delete certificate…" onConfirm={onDeleteCert} busy={busy === 'cert'} disabled={blocked || Boolean(busy)} />
            )}
          </Row>
        )}
        {zoneName && <Row
          checking={zone === 'checking'}
          done={zone === 'gone'}
          title={zone === 'gone' ? `Hosted zone ${zoneName} deleted` : `Hosted zone ${zoneName}`}
          detail={zone === 'gone' ? (zoneResult?.note || 'Not in this account any more.')
            : zone === 'exists' ? 'Still there, with its NS records in the parent zone. Costs $0.50 a month. Keep it to provision again quickly; deleted, it is created and delegated again when you do (new name servers can take a few minutes to be seen).'
              : zone === 'error' ? 'Could not check it.' : null}
        >
          {zoneResult?.error && <Text size="xs" c="red">{zoneResult.error}</Text>}
          {zoneResult?.remaining?.length > 0 && (
            <Text size="xs" c="dimmed">
              Records still in it: {zoneResult.remaining.join(', ')}. Something may still use them (a commons&apos;
              certificate validation, say); delete them first, or delete the zone from the Tear down panel with them.
            </Text>
          )}
          {zone === 'exists' && (
            <ConfirmDelete name={zoneName} label="Delete zone and delegation…" onConfirm={onDeleteZone} busy={busy === 'zone'} disabled={blocked || Boolean(busy)}>
              <Select size="xs" label="Parent zone reached with" value={parentAccess} onChange={(v) => setParentAccess(v || 'same')}
                data={[{ value: 'same', label: 'These credentials' }, { value: 'manual', label: 'Nothing: I remove the NS records myself' },
                  ...profiles.map((p) => ({ value: p, label: `Profile: ${p}` }))]} />
            </ConfirmDelete>
          )}
        </Row>}
        <Row
          done={Boolean(bucketResult?.done)}
          title={`State bucket ${stateBucket}`}
          detail={bucketResult?.done ? bucketResult.note
            : 'Still there: it holds this environment\'s record and run history. Deleting it removes every version of every object, then the bucket. It refuses if anything else is in it.'}
        >
          {bucketResult?.error && <Text size="xs" c="red">{bucketResult.error}</Text>}
          {!bucketResult?.done && (
            <ConfirmDelete name={stateBucket} label="Delete state bucket…" onConfirm={onDeleteBucket} busy={busy === 'bucket'} disabled={blocked || Boolean(busy)} />
          )}
        </Row>
      </Stack>
    </Paper>
  );
}
