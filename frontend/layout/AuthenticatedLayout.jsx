import { useEffect } from "react";
import { Center } from "@mantine/core";
import { useSession, signOut, signIn } from "next-auth/react";
import { useRouter } from "next/router";

import { LoadingState } from "@/components/ui";

export function AuthenticatedLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // 1. Handle explicit session errors (e.g. RefreshAccessTokenError)
    // This usually comes from your [...nextauth].js logic
    if (session?.error) {
      console.log('Session error detected, signing out:', session.error);
      signOut({ callbackUrl: '/' }); 
      return;
    }

    // 2. Handle Unauthenticated state
    // If loading is done and user is not logged in, redirect them.
    if (status === "unauthenticated") {
      console.log('User is unauthenticated, redirecting...');
      // Option A: Redirect to the configured sign-in page and return here after
      signIn(undefined, { callbackUrl: router.asPath });
      
      // Option B: If you specifically want to force them to the homepage instead:
      // router.replace('/');
    }
  }, [status, session, router]);

  // 3. Loading UI
  // Show spinner while checking session OR if unauthenticated (while waiting for redirect)
  // This prevents the "Hello World" or protected content from flashing.
  if (status === "loading" || status === "unauthenticated") {
    return (
      <Center h="100vh" w="100vw">
        <LoadingState
          label={status === "loading" ? "Checking your session..." : "Redirecting to sign in..."}
        />
      </Center>
    );
  }

  // 4. Render Content
  // Only render children if explicitly authenticated
  return <>{children}</>;
}