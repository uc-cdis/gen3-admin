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
} from "@mantine/core";
import dynamic from "next/dynamic";
import { useState, useEffect, useRef } from "react";
import { IconDatabase, IconAlertCircle } from "@tabler/icons-react";

const Terminal = dynamic(() => import("@/components/Shell/Terminal"), {
  ssr: false,
});

import callK8sApi from "@/lib/k8s";
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

    if (value) {
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
          <Group grow justify="space-between">
            <Select
              data={selectData}
              placeholder="Select a database"
              label="Database"
              value={selectedDatabase}
              onChange={handleDatabaseSelect}
              searchable
              leftSection={<IconDatabase size={16} />}
            />
          </Group>

          {pgwebStatus === "running" && pgwebUrl && (
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

          {(pgwebStatus === "launching" || pgwebStatus === "health_checking") && (
            <Alert icon={<LoadingOverlay visible />} title="Launching PgWeb" color="blue" mt="md">
              {pgwebStatus === "health_checking"
                ? "Pod is ready, waiting for service to be healthy..."
                : "Starting database interface pod... This may take a few moments."}
            </Alert>
          )}

          {pgwebStatus === "deleting" && (
            <Alert icon={<LoadingOverlay visible />} title="Deleting PgWeb Pod" color="red" mt="md">
              Removing the PgWeb pod… Please wait until deletion is fully completed.
            </Alert>
          )}

          {pgwebStatus === "error" && (
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
      {pgwebStatus === "running" && pgwebUrl && (
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
