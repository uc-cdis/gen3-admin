import { Welcome } from '../components/Welcome/Welcome';
import { useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { ColorSchemeToggle } from '../components/ColorSchemeToggle/ColorSchemeToggle';
import { Container } from '@mantine/core';
import { AuthenticatedLayout } from '@/layout/AuthenticatedLayout';

export default function HomePage() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error) {
      console.log('Session error detected, signing out:', session.error);
      signOut({ callbackUrl: '/' });
    }
  }, [session?.error]);

  return (
    <AuthenticatedLayout>
      <Welcome />
    </AuthenticatedLayout>
  );
}
