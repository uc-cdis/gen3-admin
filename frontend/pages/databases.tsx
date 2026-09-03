import {
  Container,
  Skeleton,
  Title,
  Text,
  Select,
  Button,
  Alert,
  LoadingOverlay,
  Group,
  Paper,
  Badge,
  Stack,
  SegmentedControl,
} from "@mantine/core";
import dynamic from "next/dynamic";
import { useState, useEffect, useRef } from "react";
import { IconDatabase, IconAlertCircle } from "@tabler/icons-react";

const Terminal = dynamic(() => import("@/components/Shell/Terminal"), {
  ssr: false,
});

import callK8sApi from "@/lib/k8s";
import SqlExplorer from "@/components/SqlExplorer";
import { useGlobalState } from "@/contexts/global";
import { useSession } from "next-auth/react";
import Link from "next/link";

export default function Databases() {
  // Get current context (environment, cluster, namespace, etc.)
  const { activeGlobalEnv } = useGlobalState();

  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  // Parse the activeGlobalEnv to get agent and namespace
  let [env, namespace] = activeGlobalEnv ? activeGlobalEnv.split("/") : [null, null];

  // env is the agent/cluster name
  const clusterName = env;

  // useState for database secrets
  const [databaseSecrets, setDatabaseSecrets] = useState([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
  const [selectData, setSelectData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalOpened, setModalOpened] = useState(false);
  // "sql" uses the native explorer (agent connects to Postgres directly);
  // "pgweb" keeps the original pod-based UI.
  const [uiMode, setUiMode] = useState<string>("sql");

  // Sessions already running in this namespace. The agent labels every pod it
  // creates, so these can be discovered rather than tracked client-side -- they
  // outlive a page reload and may have been started by someone else.
  const [runningSessions, setRunningSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Refs for DOM manipulation
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const normalContainerRef = useRef<HTMLDivElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  // PgWeb states
  const [pgwebStatus, setPgwebStatus] = useState<
    null | "launching" | "health_checking" | "running" | "deleting" | "deleted" | "error"
  >(null);
  const [pgwebError, setPgwebError] = useState<string | null>(null);
  const [pgwebUrl, setPgwebUrl] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<any>(null);

  // Keep latest status for timeout checks (avoids stale closure bug)
  const pgwebStatusRef = useRef(pgwebStatus);
  useEffect(() => {
    pgwebStatusRef.current = pgwebStatus;
  }, [pgwebStatus]);

  // ---- NEW: Single source of truth for PgWeb service proxy URL ----
  const getPgwebProxyUrl = (dbName: string) =>
    `/api/k8s/${clusterName}/proxy/api/v1/namespaces/${namespace}/services/pgweb-${dbName}-service:8081/proxy/`;

  // Tunnel ids keyed by db name, so a pgweb session reuses one listener.
  const tunnelIdRef = useRef<Record<string, string>>({});

  /**
   * Open (or reuse) a TCP tunnel to a pgweb service and return a URL the iframe
   * can load.
   *
   * The Kubernetes Service proxy (getPgwebProxyUrl) needs the API server to reach
   * the pod network, which returns 503 under an isolating CNI. The tunnel instead
   * port-forwards via API server -> kubelet -> pod.
   */
  const getPgwebTunnelUrl = async (dbName: string) => {
    let id = tunnelIdRef.current[dbName];
    if (!id) {
      const res = await authedFetch(`/api/agents/${clusterName}/tunnel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace,
          service: `pgweb-${dbName}-service`,
          port: 8081,
        }),
      });
      if (!res.ok) throw new Error(`Failed to open tunnel: ${res.status}`);
      const data = await res.json();
      id = data.id;
      tunnelIdRef.current[dbName] = id as string;
    }
    return `/api/agents/${clusterName}/tunnel/${id}/http?path=`;
  };

  // ---- NEW: fetch helper that consistently includes auth (if your server expects it) ----
  const authedFetch = (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(url, { ...options, headers, cache: "no-cache" });
  };

  // Effect to move iframe between containers
  useEffect(() => {
    if (iframeRef.current && normalContainerRef.current && modalContainerRef.current) {
      if (modalOpened) {
        // Move iframe to modal container
        modalContainerRef.current.appendChild(iframeRef.current);
        // Update styles for fullscreen
        iframeRef.current.style.height = "calc(100vh - 60px)";
        iframeRef.current.style.border = "none";
        iframeRef.current.style.borderRadius = "0";
      } else {
        // Move iframe back to normal container
        normalContainerRef.current.appendChild(iframeRef.current);
        // Update styles for normal view
        iframeRef.current.style.height = "800px";
        iframeRef.current.style.border = "1px solid #e0e0e0";
        iframeRef.current.style.borderRadius = "8px";
      }
    }
  }, [modalOpened]);

  useEffect(() => {
    // Only fetch if we have the required context
    if (!activeGlobalEnv || !accessToken || !clusterName || !namespace) {
      setDatabaseSecrets([]);
      setSelectData([]);
      console.log(activeGlobalEnv, accessToken, clusterName, namespace);
      return;
    }

    setLoading(true);

    // Fetch database secrets from the current namespace
    callK8sApi(`/api/v1/namespaces/${namespace}/secrets`, "GET", null, null, clusterName, accessToken)
      .then((data: any) => {
        const filteredSecrets = (data?.items || []).filter((secret: any) =>
          secret?.metadata?.name?.endsWith("-dbcreds")
        );

        setDatabaseSecrets(filteredSecrets);
        setSelectData(
          filteredSecrets.map((secret: any) => ({
            value: secret.metadata.name,
            label: secret.metadata.name.replace("-dbcreds", ""),
            secret,
          }))
        );
      })
      .catch((error: any) => {
        console.error("Error fetching database secrets:", error);
        setDatabaseSecrets([]);
        setSelectData([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [activeGlobalEnv, accessToken, clusterName, namespace]);

  // Reset selected database when environment changes
  useEffect(() => {
    setSelectedDatabase(null);
    setPgwebStatus(null);
    setPgwebError(null);
    setPgwebUrl(null);
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [activeGlobalEnv]);

  /**
   * Discover pgweb pods the agent has created in this namespace.
   *
   * Keyed off the labels the agent sets (`app=pgweb`, `managed-by=tunnel-agent`)
   * rather than local state, so sessions survive a reload and sessions started
   * by another user are visible too.
   */
  const fetchRunningSessions = async () => {
    if (!clusterName || !namespace || !accessToken) {
      setRunningSessions([]);
      return;
    }
    setSessionsLoading(true);
    try {
      const data: any = await callK8sApi(
        `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(
          "app=pgweb,managed-by=tunnel-agent"
        )}`,
        "GET",
        null,
        null,
        clusterName,
        accessToken
      );
      const sessions = (data?.items || []).map((pod: any) => ({
        name: pod.metadata?.name,
        dbName: pod.metadata?.labels?.["db-name"] || pod.metadata?.name?.replace(/^pgweb-/, ""),
        phase: pod.status?.phase,
        ready: (pod.status?.containerStatuses || []).every((cs: any) => cs.ready),
        startedAt: pod.status?.startTime,
      }));
      sessions.sort((a: any, b: any) => (a.dbName || "").localeCompare(b.dbName || ""));
      setRunningSessions(sessions);
    } catch (error) {
      console.error("Error fetching running pgweb sessions:", error);
      setRunningSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  };

  // Refresh the session list when the environment changes, then on an interval so
  // pods started elsewhere (or torn down) show up without a manual reload.
  useEffect(() => {
    fetchRunningSessions();
    if (!clusterName || !namespace || !accessToken) return;
    const interval = setInterval(fetchRunningSessions, 15000);
    return () => clearInterval(interval);
  }, [clusterName, namespace, accessToken]);

  /** Attach to an already-running session without going through the launch path. */
  const attachToSession = async (dbName: string) => {
    setSelectedDatabase(`${dbName}-dbcreds`);
    setPgwebError(null);
    setPgwebStatus("health_checking");

    if (await checkProxyHealth(dbName)) {
      setPgwebUrl(getPgwebProxyUrl(dbName));
      setPgwebStatus("running");
    } else {
      // Pod exists but the service isn't answering yet -- fall back to the normal
      // launch/poll path, which handles "already_running" idempotently.
      launchPgWeb(dbName);
    }
  };

  // Function to launch PgWeb (unchanged behavior, but now uses authedFetch)
  const launchPgWeb = async (dbName: string) => {
    if (!clusterName || !namespace || !dbName) return;

    setPgwebStatus("launching");
    setPgwebError(null);

    try {
      const response = await authedFetch(`/api/agent/${clusterName}/dbui/${namespace}/${dbName}`);
      const data = await response.json();

      if (data.success) {
        startPolling(dbName);
      } else {
        setPgwebStatus("error");
        setPgwebError(data.message || "Failed to launch PgWeb");
      }
    } catch (error: any) {
      console.error("Error launching PgWeb:", error);
      setPgwebStatus("error");
      setPgwebError(error?.message || "Network error while launching PgWeb");
    }
  };

  // ---- UPDATED: delete pod + poll deletion using callK8sApi consistently ----
  const killPgwebPod = async (dbName: string) => {
    if (!clusterName || !namespace || !dbName) return;

    const podName = `pgweb-${dbName}`;
    const pollIntervalMs = 1000; // 1s
    const maxWaitMs = 30_000; // 30s timeout

    setPgwebStatus("deleting");
    setPgwebError(null);

    try {
      // Delete pod (foreground, immediate)
      await callK8sApi(
        `/api/v1/namespaces/${namespace}/pods/${podName}`,
        "DELETE",
        {
          kind: "DeleteOptions",
          apiVersion: "v1",
          propagationPolicy: "Foreground",
          gracePeriodSeconds: 0,
        },
        null,
        clusterName,
        accessToken
      );

      // Poll until it's actually gone
      const start = Date.now();
      while (true) {
        try {
          await callK8sApi(
            `/api/v1/namespaces/${namespace}/pods/${podName}`,
            "GET",
            null,
            null,
            clusterName,
            accessToken
          );

          // Still exists
          if (Date.now() - start > maxWaitMs) throw new Error("Timed out waiting for pod deletion");
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        } catch (err: any) {
          // Detect "not found" robustly across helper error shapes
          const status =
            err?.status ??
            err?.response?.status ??
            err?.data?.status ??
            (typeof err?.message === "string" && err.message.includes("404") ? 404 : undefined);

          if (status === 404) {
            setPgwebStatus("deleted");
            setSelectedDatabase(null);
            return;
          }
          throw err;
        }
      }
    } catch (err: any) {
      setPgwebStatus("error");
      setPgwebError(err?.message || "Failed to delete pod");
    }
  };

  // ---- UPDATED: proxy health check uses the same proxy URL builder + auth ----
  const checkProxyHealth = async (dbName: string) => {
    const proxyUrl = getPgwebProxyUrl(dbName);
    try {
      const res = await authedFetch(proxyUrl, { method: "GET" });
      return res.ok;
    } catch (error) {
      console.log("Proxy health check failed:", error);
      return false;
    }
  };

  // Function to poll PgWeb status (minor updates: auth + shared proxy URL + fixed timeout closure)
  const startPolling = (dbName: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await authedFetch(`/api/agent/${clusterName}/dbui/${namespace}/${dbName}`);
        const data = await response.json();

        if (data.success && (data.status === "already_running" || data.status === "ready")) {
          setPgwebStatus("health_checking");

          const isProxyHealthy = await checkProxyHealth(dbName);

          if (isProxyHealthy) {
            const proxyUrl = getPgwebProxyUrl(dbName);
            setPgwebUrl(proxyUrl);
            setPgwebStatus("running");
            clearInterval(interval);
            setPollingInterval(null);
          } else {
            setPgwebStatus("launching");
          }
        } else if (data.success && data.status === "creating") {
          setPgwebStatus("launching");
        } else if (!data.success) {
          setPgwebStatus("error");
          setPgwebError(data.message || "Pod failed to start");
          clearInterval(interval);
          setPollingInterval(null);
        }
      } catch (error: any) {
        console.error("Error polling PgWeb status:", error);
        setPgwebStatus("error");
        setPgwebError(error?.message || "Failed to check pod status");
        clearInterval(interval);
        setPollingInterval(null);
      }
    }, 3000);

    setPollingInterval(interval);

    // Stop polling after 5 minutes (uses ref to avoid stale pgwebStatus)
    setTimeout(() => {
      if (interval) {
        clearInterval(interval);
        setPollingInterval(null);
        if (pgwebStatusRef.current === "launching" || pgwebStatusRef.current === "health_checking") {
          setPgwebStatus("error");
          setPgwebError("Timeout waiting for pod to start");
        }
      }
    }, 300000);
  };

  // Handle database selection
  const handleDatabaseSelect = (value: string | null) => {
    setSelectedDatabase(value);

    // Reset PgWeb state
    setPgwebStatus(null);
    setPgwebError(null);
    setPgwebUrl(null);
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }

    // Launching spawns a pod, so only do it for the pgweb view.
    if (value && uiMode === "pgweb") {
      const dbName = value.replace("-dbcreds", "");
      launchPgWeb(dbName);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  return (
    <>
      <Container fluid my={20}>
        <Title>Database Dashboard</Title>
        <Text mt="md" size="md">
          Connect to databases in the selected environment using stored credentials.
        </Text>
      </Container>

      {!activeGlobalEnv ? (
        <Container fluid my={20}>
          <Text c="dimmed">
            No environment selected. Please select an environment to view databases.
          </Text>
        </Container>
      ) : loading ? (
        <Container fluid my={20}>
          <Skeleton height={60} width={300} />
        </Container>
      ) : selectData.length > 0 ? (
        <Container fluid my={20}>
          <Group align="flex-end" justify="space-between">
            <Select
              data={selectData}
              placeholder="Select a database"
              label="Database"
              value={selectedDatabase}
              onChange={handleDatabaseSelect}
              searchable
              leftSection={<IconDatabase size={16} />}
              style={{ flex: 1 }}
            />
            <SegmentedControl
              value={uiMode}
              onChange={(mode) => {
                setUiMode(mode);
                // Switching into pgweb with a database already chosen needs the
                // pod launched, since selection skipped it while in SQL mode.
                if (mode === "pgweb" && selectedDatabase && !pgwebUrl) {
                  launchPgWeb(selectedDatabase.replace("-dbcreds", ""));
                }
              }}
              data={[
                { value: "sql", label: "SQL Explorer" },
                { value: "pgweb", label: "pgweb" },
              ]}
            />
          </Group>

          {/* SQL explorer: the agent connects to Postgres directly, so no pgweb
              pod is launched and nothing depends on pod-network reachability. */}
          {uiMode === "sql" && selectedDatabase && (
            <Container fluid mt="md" p={0}>
              <SqlExplorer
                cluster={clusterName}
                namespace={namespace}
                dbName={selectedDatabase.replace("-dbcreds", "")}
                accessToken={accessToken}
              />
            </Container>
          )}

          {uiMode === "sql" && !selectedDatabase && (
            <Text c="dimmed" mt="md">Select a database to browse its tables and run queries.</Text>
          )}

          {/* Sessions already running in this namespace, discovered from pod
              labels so they survive reloads and show other users' sessions. */}
          {uiMode === "pgweb" && runningSessions.length > 0 && (
            <Paper withBorder p="md" radius="md" mt="md">
              <Group justify="space-between" mb="xs">
                <Group gap="xs">
                  <Text fw={600} size="sm">Running pgweb sessions</Text>
                  <Badge size="sm" variant="light">{runningSessions.length}</Badge>
                </Group>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={fetchRunningSessions}
                  loading={sessionsLoading}
                >
                  Refresh
                </Button>
              </Group>
              <Stack gap="xs">
                {runningSessions.map((s) => {
                  const isActive = selectedDatabase?.replace("-dbcreds", "") === s.dbName;
                  return (
                    <Group key={s.name} justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap">
                        <IconDatabase size={16} />
                        <Text size="sm" fw={isActive ? 600 : 400}>{s.dbName}</Text>
                        <Badge
                          size="xs"
                          color={s.ready ? "green" : s.phase === "Running" ? "yellow" : "gray"}
                          variant="light"
                        >
                          {s.ready ? "ready" : (s.phase || "unknown").toLowerCase()}
                        </Badge>
                        {isActive && <Badge size="xs" variant="outline">current</Badge>}
                      </Group>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="light"
                          disabled={!s.ready || isActive}
                          onClick={() => attachToSession(s.dbName)}
                        >
                          Attach
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={async () => {
                            await killPgwebPod(s.dbName);
                            fetchRunningSessions();
                          }}
                        >
                          Stop
                        </Button>
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            </Paper>
          )}

          {uiMode === "pgweb" && pgwebStatus === "running" && pgwebUrl && (
            <Group justify="space-between">
              <Group>
                <Button onClick={() => setModalOpened(true)} m="md">
                  Open Fullscreen
                </Button>
                <Button
                  color="red"
                  m="md"
                  onClick={() => killPgwebPod(selectedDatabase?.replace("-dbcreds", "") || "")}
                >
                  Exit
                </Button>
              </Group>

              <Link href={pgwebUrl} target="_blank">
                Direct Link
              </Link>
            </Group>
          )}

          {uiMode === "pgweb" && (pgwebStatus === "launching" || pgwebStatus === "health_checking") && (
            <Alert icon={<LoadingOverlay visible />} title="Launching PgWeb" color="blue" mt="md">
              {pgwebStatus === "health_checking"
                ? "Pod is ready, waiting for service to be healthy..."
                : "Starting database interface pod... This may take a few moments."}
            </Alert>
          )}

          {uiMode === "pgweb" && pgwebStatus === "deleting" && (
            <Alert icon={<LoadingOverlay visible />} title="Deleting PgWeb Pod" color="red" mt="md">
              Removing the PgWeb pod… Please wait until deletion is fully completed.
            </Alert>
          )}

          {uiMode === "pgweb" && pgwebStatus === "error" && (
            <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" mt="md">
              {pgwebError}
              <Button
                size="xs"
                variant="light"
                color="red"
                mt="xs"
                onClick={() => {
                  const dbName = selectedDatabase?.replace("-dbcreds", "");
                  if (dbName) launchPgWeb(dbName);
                }}
              >
                Retry
              </Button>
            </Alert>
          )}
        </Container>
      ) : (
        <Container fluid my={20}>
          <Text c="dimmed">No database credentials found in namespace "{namespace}"</Text>
        </Container>
      )}

      {/* PgWeb iframe */}
      {uiMode === "pgweb" && pgwebStatus === "running" && pgwebUrl && (
        <Container fluid my={20} style={{ position: "relative" }}>
          <div ref={normalContainerRef}>
            <iframe
              ref={iframeRef}
              src={pgwebUrl}
              style={{
                width: "100%",
                height: "800px",
                border: "1px solid #e0e0e0",
                borderRadius: "8px",
              }}
              title="PgWeb Database Interface"
            />
          </div>

          {/* NOTE: if you really use a fullscreen modal container elsewhere, keep it. This is just your existing refs. */}
          <div ref={modalContainerRef} style={{ display: "none" }} />
        </Container>
      )}
    </>
  );
}
