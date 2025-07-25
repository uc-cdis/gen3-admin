import { Container } from "@mantine/core";
import { useRouter } from 'next/router';

import EnvironmentDashboardComp from '@/components/EnvironmentDashboard';
import { useGlobalState } from '@/contexts/global';

import { useState, useEffect } from "react";

import callK8sApi from "@/lib/k8s";

import { useSession, signOut } from "next-auth/react";

export default function EnvironmentDashboard() {
  const router = useRouter();
  let { env, namespace } = router.query;
  const { activeGlobalEnv } = useGlobalState();



  return (
    <Container fluid>
      <EnvironmentDashboardComp env={activeGlobalEnv.split("/")[0]} namespace={activeGlobalEnv.split("/")[1]} />
    </Container>
  )
}
