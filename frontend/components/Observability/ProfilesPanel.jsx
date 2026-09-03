import { useState, useEffect, useCallback } from 'react';
import {
  Paper, Stack, Group, Text, Badge, Select, Alert, Loader, SegmentedControl, Code,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

import { fetchProfileTypes, fetchProfileServices, fetchFlamegraph } from '@/lib/observability';
import { STATUS } from './palette';

/**
 * Continuous profiling from Pyroscope.
 *
 * Pyroscope indexes by `service_name` (formatted "<namespace>/<app>") rather
 * than by cluster, so it is not scoped by the environment selector the way Loki
 * and Mimir are. Only instrumented services appear -- at present that is the
 * monitoring stack's own components, not Gen3 workloads.
 */

const RANGES = { '15m': 900, '1h': 3600, '6h': 21600 };

/**
 * Flatten Pyroscope's flamebearer into rows ordered by self time.
 *
 * A real flame graph is a lot of canvas work for a first pass; the ranked list
 * answers the same first question -- "where is the time going" -- and stays
 * readable without interaction.
 */
function topFunctions(flame, limit = 25) {
  const names = flame?.flamebearer?.names || [];
  const levels = flame?.flamebearer?.levels || [];
  const totals = new Map();

  for (const level of levels) {
    // Each level is a flat quad list: [offset, total, self, nameIndex, ...]
    for (let i = 0; i + 3 < level.length; i += 4) {
      const self = level[i + 2];
      const name = names[level[i + 3]] || '?';
      if (self > 0) totals.set(name, (totals.get(name) || 0) + self);
    }
  }

  const rows = [...totals.entries()].map(([name, self]) => ({ name, self }));
  rows.sort((a, b) => b.self - a.self);
  const max = rows[0]?.self || 1;
  return rows.slice(0, limit).map((r) => ({ ...r, pct: (r.self / max) * 100 }));
}

export default function ProfilesPanel() {
  const [range, setRange] = useState('1h');
  const [services, setServices] = useState([]);
  const [service, setService] = useState(null);
  const [types, setTypes] = useState([]);
  const [profileType, setProfileType] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const window = useCallback(() => {
    const end = new Date();
    return { start: new Date(end.getTime() - RANGES[range] * 1000), end };
  }, [range]);

  useEffect(() => {
    const { start, end } = window();
    Promise.all([fetchProfileServices({ start, end }), fetchProfileTypes({ start, end })])
      .then(([svc, ty]) => {
        setServices(svc);
        setTypes(ty);
        if (!service && svc.length) setService(svc[0]);
        if (!profileType && ty.length) {
          const cpu = ty.find((t) => t.ID?.startsWith('process_cpu')) || ty[0];
          setProfileType(cpu.ID);
        }
      })
      .catch((err) => setError(err.message));
    // Only re-discover when the range changes; selections persist.
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!service || !profileType) return;
    setLoading(true);
    setError(null);
    try {
      const { start, end } = window();
      const flame = await fetchFlamegraph({ profileType, service, start, end });
      setRows(topFunctions(flame));
    } catch (err) {
      setError(err.message || 'Profile query failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [service, profileType, window]);

  useEffect(() => { load(); }, [load]);

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Text fw={600}>Profiles</Text>
          {service && <Badge size="sm" variant="light">{service}</Badge>}
          {loading && <Loader size="xs" />}
        </Group>
        <SegmentedControl
          size="xs"
          value={range}
          onChange={setRange}
          data={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
        />
      </Group>

      <Group gap="xs">
        <Select
          size="xs" w={260} searchable
          placeholder="Service"
          data={services}
          value={service}
          onChange={setService}
        />
        <Select
          size="xs" w={280} searchable
          placeholder="Profile type"
          data={types.map((t) => ({ value: t.ID, label: `${t.name} · ${t.sampleType}` }))}
          value={profileType}
          onChange={setProfileType}
        />
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Profiling unavailable">
          <Code block>{error}</Code>
        </Alert>
      )}

      <Paper withBorder radius="md" p="md">
        <Text fw={600} size="sm" mb="xs">Hottest functions by self time</Text>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No profile samples. Only instrumented services report to Pyroscope.
          </Text>
        ) : (
          <Stack gap={4}>
            {rows.map((r) => (
              <Group key={r.name} gap="xs" wrap="nowrap" style={{ fontSize: 11 }}>
                <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                  {/* Bar behind the label: magnitude is comparative, and the name
                      stays readable rather than being truncated into a legend. */}
                  <div
                    style={{
                      position: 'absolute', inset: 0, width: `${r.pct}%`,
                      background: 'var(--mantine-color-blue-light)', borderRadius: 4,
                    }}
                  />
                  <Text
                    size="xs"
                    style={{ position: 'relative', padding: '2px 6px', whiteSpace: 'nowrap',
                             overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {r.name}
                  </Text>
                </div>
                <Text size="xs" c="dimmed" style={{ width: 90 }} ta="right">
                  {r.self.toLocaleString()}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
