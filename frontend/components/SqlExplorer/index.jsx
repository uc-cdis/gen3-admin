import { useState, useEffect, useCallback } from 'react';
import {
  Paper,
  Stack,
  Group,
  Text,
  Button,
  Badge,
  ScrollArea,
  Alert,
  Loader,
  TextInput,
  Switch,
  Tooltip,
  ActionIcon,
  Code,
  Tabs,
  Anchor,
} from '@mantine/core';
import {
  IconTable,
  IconPlayerPlay,
  IconAlertCircle,
  IconRefresh,
  IconSearch,
  IconDatabase,
  IconListDetails,
  IconChartDots3,
  IconStethoscope,
} from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { MonacoEditor as Editor } from '@/components/MonacoEditor';
import { useComputedColorScheme } from '@mantine/core';

import { callGoApi } from '@/lib/k8s';

/**
 * Renders one query result set.
 *
 * Rows arrive positionally, so they are mapped onto index-based accessors --
 * column names can repeat in a join and would otherwise collide.
 */
function ResultGrid({ result, height = 320 }) {
  const accessors = (result.columns || []).map((_, i) => `c${i}`);
  const records = (result.rows || []).map((row, rowIndex) => {
    const record = { __i: rowIndex };
    row.forEach((value, i) => {
      record[`c${i}`] = value;
    });
    return record;
  });

  return (
    <DataTable
      withTableBorder
      withColumnBorders
      striped
      highlightOnHover
      height={height}
      idAccessor="__i"
      records={records}
      columns={(result.columns || []).map((col, i) => ({
        accessor: accessors[i],
        title: (
          <Stack gap={0}>
            <Text size="xs" fw={600}>{col.name}</Text>
            {col.type && <Text size="9px" c="dimmed">{col.type}</Text>}
          </Stack>
        ),
        render: (record) => {
          const value = record[accessors[i]];
          // NULL arrives as null, distinct from an empty string.
          if (value === null) {
            return <Text size="xs" c="dimmed" fs="italic">NULL</Text>;
          }
          // Remediation DDL is worth making copyable and visually distinct.
          if (col.name === 'pga_suggestion') {
            return (
              <Code style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{String(value)}</Code>
            );
          }
          return (
            <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</Text>
          );
        },
      }))}
    />
  );
}

/**
 * SQL explorer for a Gen3 database.
 *
 * Queries run on the agent, which reads the `<db>-dbcreds` secret and connects to
 * Postgres directly -- so this works without the caller being able to reach the
 * cluster's pod network, unlike the Service-proxied pgweb path.
 */
export default function SqlExplorer({ cluster, namespace, dbName, accessToken }) {
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const isDark = colorScheme === 'dark';

  const [tables, setTables] = useState([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState(null);

  const [sql, setSql] = useState('SELECT 1;');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [allowWrite, setAllowWrite] = useState(false);

  const [activeTab, setActiveTab] = useState('query');
  const [structure, setStructure] = useState(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [plan, setPlan] = useState(null);

  const [catalogue, setCatalogue] = useState([]);
  const [diagResults, setDiagResults] = useState({});
  const [diagRunning, setDiagRunning] = useState(null);

  const base = `/agents/${cluster}/sql/${namespace}/${dbName}`;

  /** Fetch columns/indexes/FKs/constraints for a table. */
  const loadStructure = useCallback(async (schema, name) => {
    setStructureLoading(true);
    try {
      const res = await callGoApi(
        `${base}/structure/${encodeURIComponent(name)}?schema=${encodeURIComponent(schema)}`,
        'GET', null, null, accessToken
      );
      setStructure(typeof res === 'string' ? JSON.parse(res) : res);
    } catch (err) {
      setError(err.message || 'Failed to load table structure');
    } finally {
      setStructureLoading(false);
    }
  }, [base, accessToken]);

  const runExplain = async (analyze) => {
    setRunning(true);
    setError(null);
    try {
      const res = await callGoApi(
        `${base}/explain`, 'POST', { sql, analyze }, null, accessToken
      );
      const data = typeof res === 'string' ? JSON.parse(res) : res;
      if (data.error) {
        setError(data.error);
        setPlan(null);
      } else {
        setPlan(data.plan);
        setActiveTab('plan');
      }
    } catch (err) {
      setError(err.message || 'EXPLAIN failed');
    } finally {
      setRunning(false);
    }
  };

  const loadCatalogue = useCallback(async () => {
    try {
      const res = await callGoApi(`${base}/diagnostics`, 'GET', null, null, accessToken);
      const data = typeof res === 'string' ? JSON.parse(res) : res;
      setCatalogue(data.diagnostics || []);
    } catch (err) {
      console.error('Failed to load diagnostics catalogue', err);
    }
  }, [base, accessToken]);

  const runDiagnostic = async (id) => {
    setDiagRunning(id);
    try {
      const res = await callGoApi(`${base}/diagnostics/${id}`, 'POST', {}, null, accessToken);
      const data = typeof res === 'string' ? JSON.parse(res) : res;
      setDiagResults((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setDiagResults((prev) => ({ ...prev, [id]: { error: err.message } }));
    } finally {
      setDiagRunning(null);
    }
  };

  const loadTables = useCallback(async () => {
    if (!cluster || !namespace || !dbName) return;
    setTablesLoading(true);
    setError(null);
    try {
      const res = await callGoApi(`${base}/tables`, 'GET', null, null, accessToken);
      const data = typeof res === 'string' ? JSON.parse(res) : res;
      if (data.error) {
        setError(data.error);
        setTables([]);
      } else {
        setTables(data.tables || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to list tables');
      setTables([]);
    } finally {
      setTablesLoading(false);
    }
  }, [cluster, namespace, dbName, accessToken]);

  useEffect(() => {
    loadTables();
    loadCatalogue();
    setResult(null);
    setSelectedTable(null);
    setStructure(null);
    setDiagResults({});
  }, [loadTables, loadCatalogue]);

  const runQuery = async (statement) => {
    const text = (statement ?? sql).trim();
    if (!text) return;
    setRunning(true);
    setError(null);
    try {
      const res = await callGoApi(
        `${base}/query`,
        'POST',
        { sql: text, maxRows: 1000, allowWrite },
        null,
        accessToken
      );
      const data = typeof res === 'string' ? JSON.parse(res) : res;
      // A SQL error comes back on a 200 -- the request worked, the query didn't.
      if (data.error) {
        setError(data.error);
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message || 'Query failed');
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const openTable = (t) => {
    const qualified = t.schema === 'public' ? `"${t.name}"` : `"${t.schema}"."${t.name}"`;
    const statement = `SELECT * FROM ${qualified} LIMIT 100;`;
    setSelectedTable(`${t.schema}.${t.name}`);
    setSql(statement);
    // Load structure alongside the data so switching tabs is instant.
    loadStructure(t.schema, t.name);
    if (activeTab === 'query') runQuery(statement);
    else if (activeTab === 'structure') setResult(null);
  };

  const filtered = tables.filter((t) => {
    if (!tableFilter) return true;
    const needle = tableFilter.toLowerCase();
    return t.name.toLowerCase().includes(needle) || t.schema.toLowerCase().includes(needle);
  });

  // Distinct categories in catalogue order, so sections stay grouped as authored.
  const categories = catalogue.reduce(
    (acc, d) => (acc.includes(d.category) ? acc : [...acc, d.category]),
    []
  );

  // Findings across every "issue" check that has actually been run.
  const issueCount = catalogue.reduce((n, d) => {
    if (d.severity !== 'issue') return n;
    const rows = diagResults[d.id]?.rows?.length || 0;
    return n + (rows > 0 ? 1 : 0);
  }, 0);

  /** Run every available check sequentially, so one slow query can't stampede. */
  const runAllDiagnostics = async () => {
    setDiagRunning('__all');
    try {
      for (const d of catalogue.filter((x) => x.available)) {
        try {
          const res = await callGoApi(`${base}/diagnostics/${d.id}`, 'POST', {}, null, accessToken);
          const data = typeof res === 'string' ? JSON.parse(res) : res;
          setDiagResults((prev) => ({ ...prev, [d.id]: data }));
        } catch (err) {
          setDiagResults((prev) => ({ ...prev, [d.id]: { error: err.message } }));
        }
      }
    } finally {
      setDiagRunning(null);
    }
  };

  return (
    <Group align="flex-start" gap="md" wrap="nowrap" style={{ width: '100%' }}>
      {/* ── Table sidebar ── */}
      <Paper withBorder radius="md" p="sm" style={{ width: 280, flexShrink: 0 }}>
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <IconDatabase size={16} />
            <Text fw={600} size="sm">Tables</Text>
            <Badge size="xs" variant="light">{tables.length}</Badge>
          </Group>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" size="sm" onClick={loadTables} loading={tablesLoading}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <TextInput
          size="xs"
          placeholder="Filter tables"
          leftSection={<IconSearch size={12} />}
          value={tableFilter}
          onChange={(e) => setTableFilter(e.currentTarget.value)}
          mb="xs"
        />

        <ScrollArea h={460}>
          <Stack gap={2}>
            {tablesLoading && <Loader size="xs" mx="auto" my="md" />}
            {!tablesLoading && filtered.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="md">No tables</Text>
            )}
            {filtered.map((t) => {
              const key = `${t.schema}.${t.name}`;
              const active = selectedTable === key;
              return (
                <Group
                  key={key}
                  gap="xs"
                  wrap="nowrap"
                  onClick={() => openTable(t)}
                  style={{
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 4,
                    background: active ? 'var(--mantine-color-blue-light)' : undefined,
                  }}
                >
                  <IconTable size={14} style={{ flexShrink: 0 }} />
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="xs" truncate fw={active ? 600 : 400}>{t.name}</Text>
                    {t.schema !== 'public' && (
                      <Text size="9px" c="dimmed" truncate>{t.schema}</Text>
                    )}
                  </Stack>
                  <Text size="9px" c="dimmed" ml="auto" style={{ flexShrink: 0 }}>
                    ~{t.rowEstimate}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        </ScrollArea>
      </Paper>

      {/* Editor, results, structure and diagnostics */}
      <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="query" leftSection={<IconPlayerPlay size={14} />}>Query</Tabs.Tab>
            <Tabs.Tab value="structure" leftSection={<IconListDetails size={14} />}>Structure</Tabs.Tab>
            <Tabs.Tab value="plan" leftSection={<IconChartDots3 size={14} />}>Plan</Tabs.Tab>
            <Tabs.Tab value="diagnostics" leftSection={<IconStethoscope size={14} />}>
              Diagnostics
              {issueCount > 0 && (
                <Badge size="xs" color="red" variant="filled" ml={6}>{issueCount}</Badge>
              )}
            </Tabs.Tab>
          </Tabs.List>

          {/* Query editor and results */}
          <Tabs.Panel value="query" pt="md">
            <Stack gap="md">
              <Paper withBorder radius="md" p="sm">
                <Group justify="space-between" mb="xs">
                  <Text fw={600} size="sm">Query</Text>
                  <Group gap="sm">
                    <Tooltip label="Statements run in a read-only transaction unless enabled">
                      <Switch
                        size="xs"
                        label="Allow writes"
                        checked={allowWrite}
                        onChange={(e) => setAllowWrite(e.currentTarget.checked)}
                        color="red"
                      />
                    </Tooltip>
                    <Button size="xs" variant="light" onClick={() => runExplain(false)} loading={running}>
                      Explain
                    </Button>
                    <Tooltip label="Runs the query for real to collect timings">
                      <Button size="xs" variant="light" color="orange" onClick={() => runExplain(true)}>
                        Explain analyze
                      </Button>
                    </Tooltip>
                    <Button
                      size="xs"
                      leftSection={<IconPlayerPlay size={14} />}
                      onClick={() => runQuery()}
                      loading={running}
                    >
                      Run
                    </Button>
                  </Group>
                </Group>

                <Editor
                  className="border rounded"
                  height="180px"
                  defaultLanguage="sql"
                  value={sql}
                  onChange={(v) => setSql(v ?? '')}
                  theme={isDark ? 'vs-dark' : 'light'}
                  onMount={(editor, monaco) => {
                    // Ctrl/Cmd+Enter runs, matching the Elasticsearch page.
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                      runQuery(editor.getValue());
                    });
                  }}
                  options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    lineNumbers: 'on',
                  }}
                />
              </Paper>

              {error && (
                <Alert color="red" icon={<IconAlertCircle size={16} />} title="Query error">
                  <Code block>{error}</Code>
                </Alert>
              )}

              {result && (
                <Paper withBorder radius="md" p="sm">
                  <Group justify="space-between" mb="xs">
                    <Group gap="xs">
                      <Text size="sm" fw={600}>Results</Text>
                      <Badge size="xs" variant="light">{result.rows.length} rows</Badge>
                      {result.truncated && (
                        <Tooltip label="More rows exist; add a LIMIT or refine the query">
                          <Badge size="xs" color="yellow" variant="light">truncated</Badge>
                        </Tooltip>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">{result.durationMs} ms</Text>
                  </Group>

                  {result.columns.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Statement completed. {result.rowsAffected} row(s) affected.
                    </Text>
                  ) : (
                    <ResultGrid result={result} height={380} />
                  )}
                </Paper>
              )}
            </Stack>
          </Tabs.Panel>

          {/* Table structure */}
          <Tabs.Panel value="structure" pt="md">
            {structureLoading && <Loader size="sm" />}
            {!structureLoading && !structure && (
              <Text c="dimmed" size="sm">Select a table to view its structure.</Text>
            )}
            {!structureLoading && structure && (
              <Stack gap="md">
                <Text fw={600} size="sm">
                  {structure.schema}.{structure.table}
                </Text>
                {[
                  ['Columns', structure.columns],
                  ['Indexes', structure.indexes],
                  ['Foreign keys', structure.foreign_keys],
                  ['Constraints', structure.constraints],
                ].map(([label, data]) => (
                  <Paper key={label} withBorder radius="md" p="sm">
                    <Group gap="xs" mb="xs">
                      <Text fw={600} size="sm">{label}</Text>
                      <Badge size="xs" variant="light">{data?.rows?.length || 0}</Badge>
                    </Group>
                    {data?.rows?.length ? (
                      <ResultGrid result={data} height={Math.min(320, 60 + data.rows.length * 36)} />
                    ) : (
                      <Text size="xs" c="dimmed">None</Text>
                    )}
                  </Paper>
                ))}
              </Stack>
            )}
          </Tabs.Panel>

          {/* Query plan */}
          <Tabs.Panel value="plan" pt="md">
            {!plan && <Text c="dimmed" size="sm">Run Explain on a query to see its plan.</Text>}
            {plan && (
              <Paper withBorder radius="md" p="sm">
                <Code block style={{ fontSize: 12, whiteSpace: 'pre' }}>{plan}</Code>
              </Paper>
            )}
          </Tabs.Panel>

          {/* Diagnostics catalogue */}
          <Tabs.Panel value="diagnostics" pt="md">
            <Stack gap="md">
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Health and schema checks. Queries adapted from pgAssistant (MIT).
                </Text>
                <Button size="xs" variant="light" onClick={runAllDiagnostics} loading={diagRunning === '__all'}>
                  Run all checks
                </Button>
              </Group>

              {categories.map((category) => (
                <Paper key={category} withBorder radius="md" p="sm">
                  <Text fw={600} size="sm" mb="xs">{category}</Text>
                  <Stack gap="xs">
                    {catalogue.filter((d) => d.category === category).map((d) => {
                      const res = diagResults[d.id];
                      const rowCount = res?.rows?.length ?? null;
                      // For "issue" checks any row is a finding; "info" is neutral.
                      const isFinding = d.severity === 'issue' && rowCount > 0;
                      return (
                        <Stack key={d.id} gap={4}>
                          <Group justify="space-between" wrap="nowrap">
                            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                              {rowCount !== null && (
                                <Badge
                                  size="xs"
                                  variant="light"
                                  color={isFinding ? 'red' : rowCount === 0 && d.severity === 'issue' ? 'green' : 'gray'}
                                >
                                  {rowCount}
                                </Badge>
                              )}
                              <Text size="xs" style={{ minWidth: 0 }}>{d.description}</Text>
                              {!d.available && (
                                <Tooltip label={`Requires the ${d.requiresExt} extension`}>
                                  <Badge size="xs" color="gray" variant="outline">unavailable</Badge>
                                </Tooltip>
                              )}
                              {d.reference && (
                                <Anchor href={d.reference} target="_blank" size="xs">docs</Anchor>
                              )}
                            </Group>
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              disabled={!d.available}
                              loading={diagRunning === d.id}
                              onClick={() => runDiagnostic(d.id)}
                            >
                              Run
                            </Button>
                          </Group>

                          {res?.error && (
                            <Alert color="red" p="xs"><Code>{res.error}</Code></Alert>
                          )}
                          {res?.rows?.length > 0 && (
                            <ResultGrid result={res} height={Math.min(300, 60 + res.rows.length * 36)} />
                          )}
                        </Stack>
                      );
                    })}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Group>
  );
}
