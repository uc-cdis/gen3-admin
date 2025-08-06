import { Welcome } from '../components/Welcome/Welcome';
import { useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { ColorSchemeToggle } from '../components/ColorSchemeToggle/ColorSchemeToggle';
import { Container } from '@mantine/core';
import { AuthenticatedLayout } from '@/layout/AuthenticatedLayout';

import { useGlobalState } from '@/contexts/global';

import EnvironmentDashboardComp from '@/components/EnvironmentDashboard';

export default function HomePage() {
  const { data: session } = useSession();
  const { activeCluster, setActiveCluster, activeGlobalEnv, setActiveGlobalEnv } = useGlobalState();

  const [cluster, namespace] = activeGlobalEnv.split('/')

  useEffect(() => {
    if (session?.error) {
      console.log('Session error detected, signing out:', session.error);
      signOut({ callbackUrl: '/' });
    }
  }, [session?.error]);

  return (
    <AuthenticatedLayout>
      {cluster == "" ?
      <Welcome /> :
      <EnvironmentDashboardComp env={cluster} namespace={namespace} />
      }
  </AuthenticatedLayout>
  );
}
