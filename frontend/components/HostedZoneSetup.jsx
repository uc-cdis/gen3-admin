import { useEffect, useState } from 'react';
import { Alert, Button, Code, Group, List, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconRefresh } from '@tabler/icons-react';

const ZONE_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/;

// The zone the CSOC's hostnames would go in: the hostname's parent, so
// portal.csoc.example.org and auth.csoc.example.org share csoc.example.org.
const defaultZone = (hostname) => {
  const labels = hostname.split('.');
  return labels.length > 3 ? labels.slice(1).join('.') : hostname;
};

// Creates the public hosted zone for the CSOC's hostnames in the account
// being deployed into, and delegates it from its parent zone. The parent is
// often in a different account (the one that owns the domain): pick a profile
// that can reach it, or add the NS records by hand.
export default function HostedZoneSetup({ target, hostname, onReady }) {
  const [zone, setZone] = useState(() => defaultZone(hostname));
  // Kept across re-renders and reloads: losing it sent a second try to the
  // wrong account, which then showed the "add these records yourself" box.
  const [parentAccess, setParentAccessState] = useState(() =>
    (typeof window !== 'undefined' && window.localStorage.getItem('gen3-csoc-parent-access')) || 'same');
  const setParentAccess = (v) => {
    setParentAccessState(v);
    window.localStorage.setItem('gen3-csoc-parent-access', v);
  };
  const [profiles, setProfiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => setZone(defaultZone(hostname)), [hostname]);

  useEffect(() => {
    fetch('/api/aws/profiles')
      .then((r) => (r.ok ? r.json() : { profiles: [] }))
      .then((d) => setProfiles(d.profiles || []))
      .catch(() => setProfiles([]));
  }, []);

  const inZone = hostname === zone || hostname.endsWith(`.${zone}`);
  const zoneError = zone && !ZONE_PATTERN.test(zone)
    ? 'A subdomain, such as csoc.example.org'
    : zone && !inZone ? `${hostname} is not in this zone` : null;

  const parent =
    parentAccess === 'manual' ? undefined
      : parentAccess === 'same' ? target
        : { profile: parentAccess, region: target.region };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/aws/route53/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, domain: zone, parent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
      setResult(data);
      if (data.resolves) onReady(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const records = result && (
    <Code block>
      {result.name_servers.map((ns) => `${result.zone_name}.  300  IN  NS  ${ns}.`).join('\n')}
    </Code>
  );

  return (
    <Stack gap="sm">
      <TextInput
        label="Hosted zone to create"
        description="In the account you are deploying into. The CSOC's hostnames, and later its commons, go under it."
        value={zone}
        onChange={(e) => { setZone(e.target.value.trim().toLowerCase()); setResult(null); }}
        error={zoneError}
      />
      <Select
        label="Delegate it from the parent zone using"
        description="The parent zone is usually in the account that owns the domain"
        value={parentAccess}
        onChange={(v) => { setParentAccess(v || 'same'); setResult(null); }}
        data={[
          { value: 'same', label: 'The credentials above' },
          ...profiles.map((p) => ({ value: p, label: `Profile: ${p}` })),
          { value: 'manual', label: "I'll add the NS records myself" },
        ]}
        allowDeselect={false}
      />
      <Group>
        <Button onClick={run} loading={running} disabled={!zone || Boolean(zoneError)}
          leftSection={result ? <IconRefresh size={16} /> : null}>
          {result ? 'Check again' : 'Set up zone and delegation'}
        </Button>
      </Group>
      {error && <Text size="sm" c="red">{error}</Text>}

      {result && (
        <Stack gap="xs">
          <Text size="sm">
            {result.created ? 'Created' : 'Found'} hosted zone <b>{result.zone_name}</b> ({result.hosted_zone_id}).
          </Text>
          {result.delegation === 'conflict' && (
            <Alert color="red" icon={<IconAlertTriangle />} title="Not delegated: the parent already uses this name">
              <Text size="sm">
                {result.parent_zone_name} has records that delegating {result.zone_name} would hide.
                Nothing was changed. Choose another zone name.
              </Text>
              <List size="sm" mt="xs">{(result.conflicts || []).map((c) => <List.Item key={c}><Code>{c}</Code></List.Item>)}</List>
            </Alert>
          )}
          {result.delegation === 'manual' && (
            <Alert color="yellow" icon={<IconAlertTriangle />} title="Add these records to the parent zone">
              <Text size="sm" mb="xs">
                Wherever the parent domain is hosted, add an NS record for {result.zone_name}:
              </Text>
              {records}
            </Alert>
          )}
          {['added', 'delegated'].includes(result.delegation) && (
            <Text size="sm">
              {result.delegation === 'added' ? 'Added' : 'Found'} the NS records in {result.parent_zone_name}.
            </Text>
          )}
          {result.resolves ? (
            <Alert color="green" icon={<IconCheck />} title="Delegation is live">
              <Text size="sm">Public DNS answers with this zone's name servers.</Text>
            </Alert>
          ) : result.delegation !== 'conflict' && (
            <Text size="xs" c="dimmed">
              Public DNS does not see the delegation yet. It usually shows up within a few
              minutes; use Check again. Terraform cannot validate the certificate until it does.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}
