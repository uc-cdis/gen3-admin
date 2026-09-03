import { useState, useEffect, useCallback } from 'react';
import {
  Paper, Stack, Group, Text, Badge, SimpleGrid, Alert, Loader, Table,
  SegmentedControl, useComputedColorScheme,
} from '@mantine/core';
import { IconAlertCircle, IconLogin, IconDownload } from '@tabler/icons-react';
import { BarChart } from '@mantine/charts';

import { useSession } from 'next-auth/react';

import { callGoApi } from '@/lib/k8s';
import { palette, STATUS } from './palette';

/**
 * Activity from the environment's own audit database.
 *
 * Unlike the other panels this reads a per-environment Postgres rather than a
 * centralized backend: each environment has its own `audit-dbcreds` secret, and
 * the agent connects directly (the same path the SQL explorer uses).
 *
 * The schema is fixed by the Gen3 audit service:
 *   login         (timestamp, username, sub, idp, fence_idp, client_id, status_code, ip)
 *   presigned_url (timestamp, username, guid, action, protocol, resource_paths, status_code)
 */

const RANGES = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };

export default function AuditPanel({ cluster, namespace }) {
  const scheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const colors = palette(scheme === 'dark');
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const [range, setRange] = useState('7d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const runQuery = useCallback(
    async (sql) => {
      const res = await callGoApi(
        `/agents/${cluster}/sql/${namespace}/audit/query`,
        'POST',
        { sql, maxRows: 500 },
        null,
        accessToken
      );
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      if (parsed.error) throw new Error(parsed.error);
      return parsed;
    },
    [cluster, namespace, accessToken]
  );

  const load = useCallback(async () => {
    if (!cluster || !namespace) return;
    setLoading(true);
    setError(null);
    const interval = RANGES[range];

    try {
      // Bucket width follows the range so a 30-day view isn't 720 hourly points.
      const bucket = range === '24h' ? 'hour' : 'day';

      const [logins, loginSeries, topUsers, downloads, topFiles, idps] = await Promise.all([
        runQuery(`SELECT count(*) AS total,
                         count(*) FILTER (WHERE status_code >= 400) AS failed,
                         count(DISTINCT username) AS users
                  FROM login WHERE timestamp > now() - interval '${interval}'`),
        runQuery(`SELECT date_trunc('${bucket}', timestamp) AS bucket,
                         count(*) FILTER (WHERE status_code < 400) AS ok,
                         count(*) FILTER (WHERE status_code >= 400) AS failed
                  FROM login WHERE timestamp > now() - interval '${interval}'
                  GROUP BY 1 ORDER BY 1`),
        runQuery(`SELECT username, count(*) AS logins
                  FROM login WHERE timestamp > now() - interval '${interval}'
                  GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
        runQuery(`SELECT count(*) AS total,
                         count(*) FILTER (WHERE status_code >= 400) AS failed,
                         count(DISTINCT username) AS users
                  FROM presigned_url WHERE timestamp > now() - interval '${interval}'`),
        runQuery(`SELECT guid, action, count(*) AS requests
                  FROM presigned_url WHERE timestamp > now() - interval '${interval}'
                  GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`),
        runQuery(`SELECT coalesce(nullif(fence_idp, ''), idp, 'unknown') AS provider,
                         count(*) AS logins
                  FROM login WHERE timestamp > now() - interval '${interval}'
                  GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      ]);

      const first = (r) => (r.rows?.[0] || []).map((v) => (v === null ? 0 : Number(v)));
      const [loginTotal, loginFailed, loginUsers] = first(logins);
      const [dlTotal, dlFailed, dlUsers] = first(downloads);

      setData({
        loginTotal, loginFailed, loginUsers,
        dlTotal, dlFailed, dlUsers,
        series: (loginSeries.rows || []).map((r) => ({
          label: new Date(r[0]).toLocaleDateString([],
            bucket === 'hour' ? { hour: '2-digit' } : { month: 'short', day: 'numeric' }),
          Successful: Number(r[1] ?? 0),
          Failed: Number(r[2] ?? 0),
        })),
        topUsers: (topUsers.rows || []).map((r) => ({ username: r[0] ?? 'anonymous', logins: Number(r[1]) })),
        topFiles: (topFiles.rows || []).map((r) => ({ guid: r[0], action: r[1], requests: Number(r[2]) })),
        idps: (idps.rows || []).map((r) => ({ provider: r[0], logins: Number(r[1]) })),
      });
    } catch (err) {
      setError(err.message || 'Audit query failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cluster, namespace, range, runQuery]);

  useEffect(() => { load(); }, [load]);

  const Tile = ({ label, value, hint, color, icon }) => (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" c="dimmed">{label}</Text>
          <Text fw={700} size="xl" style={{ color, lineHeight: 1.1 }}>
            {value ?? '—'}
          </Text>
          {hint && <Text size="xs" c="dimmed">{hint}</Text>}
        </Stack>
        {icon}
      </Group>
    </Paper>
  );

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Text fw={600}>Audit activity</Text>
          <Badge size="sm" variant="light">{namespace}</Badge>
          {loading && <Loader size="xs" />}
        </Group>
        <SegmentedControl
          size="xs"
          value={range}
          onChange={setRange}
          data={Object.keys(RANGES).map((r) => ({ value: r, label: r }))}
        />
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Audit database unavailable">
          {error}
          <Text size="xs" mt="xs">
            This reads the environment&apos;s <strong>audit-dbcreds</strong> secret through the agent.
            It requires the audit service to be deployed in this namespace.
          </Text>
        </Alert>
      )}

      {data && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
            <Tile label="Logins" value={data.loginTotal} hint={`${data.loginUsers} users`}
              icon={<IconLogin size={18} />} />
            <Tile label="Failed logins" value={data.loginFailed}
              color={data.loginFailed > 0 ? STATUS.critical : STATUS.good} />
            <Tile label="File requests" value={data.dlTotal} hint={`${data.dlUsers} users`}
              icon={<IconDownload size={18} />} />
            <Tile label="Failed requests" value={data.dlFailed}
              color={data.dlFailed > 0 ? STATUS.serious : STATUS.good} />
          </SimpleGrid>

          <Paper withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="xs">Logins over time</Text>
            {data.series.length === 0 ? (
              <Text size="sm" c="dimmed">No logins recorded in this range.</Text>
            ) : (
              <BarChart
                h={200}
                data={data.series}
                dataKey="label"
                type="stacked"
                withLegend
                barProps={{ radius: 4 }}
                series={[
                  { name: 'Successful', color: colors[0] },
                  { name: 'Failed', color: STATUS.critical },
                ]}
              />
            )}
          </Paper>

          <SimpleGrid cols={{ base: 1, lg: 3 }}>
            <Paper withBorder radius="md" p="md">
              <Text fw={600} size="sm" mb="xs">Most active users</Text>
              {data.topUsers.length === 0 ? <Text size="xs" c="dimmed">No activity.</Text> : (
                <Table fz="xs" verticalSpacing={4}>
                  <Table.Tbody>
                    {data.topUsers.map((u) => (
                      <Table.Tr key={u.username}>
                        <Table.Td>{u.username}</Table.Td>
                        <Table.Td ta="right">{u.logins}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>

            <Paper withBorder radius="md" p="md">
              <Text fw={600} size="sm" mb="xs">Identity providers</Text>
              {data.idps.length === 0 ? <Text size="xs" c="dimmed">No logins.</Text> : (
                <Table fz="xs" verticalSpacing={4}>
                  <Table.Tbody>
                    {data.idps.map((p) => (
                      <Table.Tr key={p.provider}>
                        <Table.Td>{p.provider}</Table.Td>
                        <Table.Td ta="right">{p.logins}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>

            <Paper withBorder radius="md" p="md">
              <Text fw={600} size="sm" mb="xs">Most requested files</Text>
              {data.topFiles.length === 0 ? <Text size="xs" c="dimmed">No file activity.</Text> : (
                <Table fz="xs" verticalSpacing={4}>
                  <Table.Tbody>
                    {data.topFiles.map((f) => (
                      <Table.Tr key={`${f.guid}-${f.action}`}>
                        <Table.Td>
                          <Text size="xs" truncate style={{ maxWidth: 160 }}>{f.guid}</Text>
                          <Text size="9px" c="dimmed">{f.action}</Text>
                        </Table.Td>
                        <Table.Td ta="right">{f.requests}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
