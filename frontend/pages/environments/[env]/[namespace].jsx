import { Container } from "@mantine/core";
import { useRouter } from 'next/router';

import EnvironmentDashboardComp from '@/components/EnvironmentDashboard';
import { useGlobalState } from '@/contexts/global';

import { useState, useEffect } from "react";

import callK8sApi from "@/lib/k8s";

import { useSession } from "next-auth/react";

export default function EnvironmentDashboard() {
  const router = useRouter();
  let { env, namespace } = router.query;
  const { activeGlobalEnv } = useGlobalState();

  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;


  [env, namespace] = activeGlobalEnv.split("/");

  // Add hostname retrieval
  const [hostname, setHostname] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHostname = async () => {
      try {
        const configMapResponse = await callK8sApi(
          `/api/v1/namespaces/${namespace}/configmaps/manifest-global`,
          'GET',
          null,
          null,
          env,
          accessToken
        );

        const retrievedHostname = configMapResponse?.data?.hostname || env;
        setHostname(retrievedHostname);
      } catch (error) {
        console.error('Error fetching hostname:', error);
        setHostname(env); // fallback to environment name
      } finally {
        setLoading(false);
      }
    };

    if (namespace && accessToken) {
      fetchHostname();
    }
  }, [namespace, env, accessToken]);


  return (
    <Container fluid>
      <EnvironmentDashboardComp env={activeGlobalEnv.split("/")[0]} hostname={hostname} namespace={activeGlobalEnv.split("/")[1]} />
    </Container>
  )
}
