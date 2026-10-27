import { useEffect, useState } from 'react';
import {
  Alert, Badge, Button, CopyButton, Code, FileButton, Group, Loader, Paper, Radio, SegmentedControl, Select, Stack, Table, TagsInput, Text, Textarea, Tooltip,
} from '@mantine/core';
import { IconCheck, IconCopy, IconUpload, IconX } from '@tabler/icons-react';

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const STATUS_COLOR = { ISSUED: 'green', PENDING_VALIDATION: 'yellow', SUCCESS: 'green', FAILED: 'red', EXPIRED: 'red', REVOKED: 'red', VALIDATION_TIMED_OUT: 'red' };
const words = (s) => (s || '').toLowerCase().replace(/_/g, ' ');

function Copyable({ value }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>{value}</Text>
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied' : 'Copy'}>
            <Button size="compact-xs" variant="subtle" color={copied ? 'green' : 'gray'} onClick={copy}>
              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            </Button>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

// The ACM console's "Request a public certificate".
function RequestForm({ target, hostnames, onChosen }) {
  const [domains, setDomains] = useState(hostnames);
  const [alg, setAlg] = useState('RSA_2048');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => setDomains(hostnames), [hostnames.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await post('/api/aws/acm/request', { ...target, domains, key_algorithm: alg });
      onChosen(d.arn);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap="sm">
      <TagsInput label="Fully qualified domain names" description="The first is the certificate's name; the rest are added to it. Both CSOC hostnames are filled in."
        value={domains} onChange={(v) => setDomains(v.map((d) => d.trim().toLowerCase()))} />
      <Radio.Group label="Validation method" value="dns">
        <Radio value="dns" mt={4} label="DNS validation (recommended)"
          description="ACM gives a CNAME record per name; it issues the certificate once it sees them, and renews it for as long as they stay." />
      </Radio.Group>
      <Select label="Key algorithm" value={alg} onChange={(v) => setAlg(v || 'RSA_2048')} maw={320}
        data={[{ value: 'RSA_2048', label: 'RSA 2048' }, { value: 'EC_prime256v1', label: 'ECDSA P 256' }, { value: 'EC_secp384r1', label: 'ECDSA P 384' }]} />
      {error && <Alert color="red" icon={<IconX />}>{error}</Alert>}
      <Group><Button onClick={submit} loading={busy} disabled={domains.length === 0}>Request</Button></Group>
    </Stack>
  );
}

// The console's "Import a certificate": PEM text, pasted or from a file.
function ImportForm({ target, onChosen }) {
  const [body, setBody] = useState('');
  const [key, setKey] = useState('');
  const [chain, setChain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fromFile = (set) => (file) => file && file.text().then(set);
  const field = (label, description, value, set, rows) => (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm" fw={500}>{label}</Text>
        <FileButton onChange={fromFile(set)} accept=".pem,.crt,.cer,.key,text/plain">
          {(props) => <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconUpload size={12} />}>From a file</Button>}
        </FileButton>
      </Group>
      <Textarea description={description} value={value} onChange={(e) => set(e.target.value)} autosize minRows={rows} maxRows={10}
        styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }} />
    </Stack>
  );
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await post('/api/aws/acm/import', { ...target, certificate: body, private_key: key, chain });
      onChosen(d.arn);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap="sm">
      {field('Certificate body', 'PEM: -----BEGIN CERTIFICATE----- … Just the certificate, not its chain.', body, setBody, 4)}
      {field('Certificate private key', 'PEM, unencrypted. Sent once to ACM; not stored by this wizard.', key, setKey, 3)}
      {field('Certificate chain (optional)', 'The intermediate certificates, PEM.', chain, setChain, 3)}
      <Text size="xs" c="dimmed">An imported certificate is not renewed by ACM: import a new one before it expires.</Text>
      {error && <Alert color="red" icon={<IconX />}>{error}</Alert>}
      <Group><Button onClick={submit} loading={busy} disabled={!body.trim() || !key.trim()}>Import</Button></Group>
    </Stack>
  );
}

// The account's certificates, those covering both hostnames first.
function ExistingList({ target, hostnames, onChosen }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    post('/api/aws/acm/list', { ...target, hostnames })
      .then((d) => { if (!cancelled) setList(d.certificates || []); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [target.profile, target.region, hostnames.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Alert color="red" icon={<IconX />}>{error}</Alert>;
  if (!list) return <Group gap="xs"><Loader size="xs" /><Text size="sm">Listing certificates in {target.region}…</Text></Group>;
  if (list.length === 0) return <Text size="sm" c="dimmed">No issued or pending certificates in {target.region}.</Text>;
  return (
    <Table fz="xs" verticalSpacing={6} highlightOnHover>
      <Table.Thead>
        <Table.Tr><Table.Th>Names</Table.Th><Table.Th>Status</Table.Th><Table.Th>Type</Table.Th><Table.Th>Expires</Table.Th><Table.Th /></Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {list.map((c) => (
          <Table.Tr key={c.arn} style={{ opacity: c.covers ? 1 : 0.55 }}>
            <Table.Td><Text size="xs" ff="monospace">{c.names.join(', ')}</Text></Table.Td>
            <Table.Td><Badge size="xs" variant="light" color={STATUS_COLOR[c.status]}>{words(c.status)}</Badge></Table.Td>
            <Table.Td>{c.type === 'IMPORTED' ? 'imported' : 'Amazon issued'}</Table.Td>
            <Table.Td>{c.not_after ? new Date(c.not_after).toLocaleDateString() : '–'}</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              {c.covers
                ? <Button size="compact-xs" variant="light" onClick={() => onChosen(c.arn)}>Use this certificate</Button>
                : <Text size="xs" c="dimmed">does not cover {hostnames.join(' and ')}</Text>}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function Check({ ok, waiting, label }) {
  return (
    <Group gap={4} wrap="nowrap">
      {ok ? <IconCheck size={14} color="var(--mantine-color-green-6)" /> : waiting ? <Loader size={12} /> : <IconX size={14} color="var(--mantine-color-gray-5)" />}
      <Text size="xs" c={ok ? 'green.7' : 'dimmed'}>{label}</Text>
    </Group>
  );
}

// The chosen certificate: per name, where its validation stands, checked
// each time rather than remembered. The records themselves are folded away
// when the wizard writes them, and shown when you create them yourself.
function Detail({ detail, dnsMode, onChange }) {
  const [showRecords, setShowRecords] = useState(dnsMode === 'self');
  const pending = detail.status === 'PENDING_VALIDATION';
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>Certificate</Text>
            {detail.status
              ? <Badge variant="light" color={STATUS_COLOR[detail.status] || 'gray'}>{words(detail.status)}</Badge>
              : <Loader size="xs" />}
            {detail.type && <Badge variant="outline" color="gray">{detail.type === 'IMPORTED' ? 'imported' : 'Amazon issued'}</Badge>}
          </Group>
          {detail.not_after && <Text size="xs" c="dimmed">Expires {new Date(detail.not_after).toLocaleDateString()}</Text>}
        </Group>
        <Text size="xs" c="dimmed" ff="monospace">{detail.arn}</Text>
        {detail.domains?.length > 0 && (
          <Table fz="xs" verticalSpacing={8}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                {pending && <Table.Th>{dnsMode === 'route53' ? 'Record in Route 53' : 'Record created'}</Table.Th>}
                {pending && <Table.Th>Seen in public DNS</Table.Th>}
                <Table.Th>ACM</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {detail.domains.map((d) => (
                <Table.Tr key={d.domain}>
                  <Table.Td><Text size="sm" ff="monospace">{d.domain}</Text></Table.Td>
                  {pending && (
                    <Table.Td>
                      {dnsMode === 'route53'
                        ? <Check ok={d.dns?.in_zone} waiting={!d.dns?.in_zone} label={d.dns?.in_zone ? `in ${d.dns.zone}` : d.record ? 'writing…' : 'ACM is preparing it'} />
                        : <Check ok={d.dns?.public} waiting={false} label={d.dns?.public ? 'yes' : 'not yet'} />}
                    </Table.Td>
                  )}
                  {pending && <Table.Td><Check ok={d.dns?.public} waiting={!d.dns?.public} label={d.dns?.public ? 'yes' : 'waiting'} /></Table.Td>}
                  <Table.Td><Check ok={d.status === 'SUCCESS'} waiting={pending && d.status !== 'SUCCESS'} label={d.status === 'SUCCESS' ? 'validated' : words(d.status) || 'waiting'} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {pending && detail.domains?.some((d) => d.record) && (
          <div>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setShowRecords((v) => !v)}>
              {showRecords ? 'Hide' : 'Show'} the validation records
            </Button>
            {showRecords && (
              <Table fz="xs" verticalSpacing={6} mt={4}>
                <Table.Thead><Table.Tr><Table.Th>CNAME name</Table.Th><Table.Th>CNAME value</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {detail.domains.filter((d) => d.record).map((d) => (
                    <Table.Tr key={d.domain}>
                      <Table.Td><Copyable value={d.record.name} /></Table.Td>
                      <Table.Td><Copyable value={d.record.value} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </div>
        )}
        {detail.status === 'ISSUED' && <Text size="sm" c="green.7">Issued. The install serves it on the CSOC&apos;s load balancer.</Text>}
        <Group><Button size="compact-xs" variant="subtle" color="gray" onClick={onChange}>Use a different certificate</Button></Group>
      </Stack>
    </Paper>
  );
}

/**
 * The Certificate & DNS step. With no certificate chosen, the three ways
 * the ACM console offers to get one; with one, its detail. What to do next
 * (create its records, check again, choose another) is in the banner.
 */
export default function CertificateStep({ target, hostnames, detail, dnsMode, onChosen, onChange, disabled }) {
  const [how, setHow] = useState('request');
  if (detail) return <Detail detail={detail} dnsMode={dnsMode} onChange={onChange} />;
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <SegmentedControl value={how} onChange={setHow} disabled={disabled} data={[
          { value: 'request', label: 'Request a public certificate' },
          { value: 'import', label: 'Import a certificate' },
          { value: 'existing', label: 'Use an existing certificate' },
        ]} />
        {how === 'request' && <RequestForm target={target} hostnames={hostnames} onChosen={onChosen} />}
        {how === 'import' && <ImportForm target={target} onChosen={onChosen} />}
        {how === 'existing' && <ExistingList target={target} hostnames={hostnames} onChosen={onChosen} />}
      </Stack>
    </Paper>
  );
}
