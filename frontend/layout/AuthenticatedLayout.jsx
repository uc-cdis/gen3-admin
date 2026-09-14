import { useEffect, useRef } from "react";
import { Center } from "@mantine/core";
import { useSession, signOut, signIn } from "next-auth/react";
import { useRouter } from "next/router";

import { LoadingState } from "@/components/ui";

export function AuthenticatedLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Guards the redirect below so a transient session-fetch failure cannot queue
  // multiple sign-in navigations.
  const redirecting = useRef(false);

  useEffect(() => {
    // 1. Handle explicit session errors (e.g. RefreshAccessTokenError)
    // This usually comes from your [...nextauth].js logic
    if (session?.error) {
      console.log('Session error detected, signing out:', session.error);
      signOut({ callbackUrl: '/' }); 
      return;
    }

    // 2. Handle Unauthenticated state
    //
    // Guarded against a redirect loop. next-auth reports `unauthenticated` when
    // its /api/auth/session fetch *fails* as well as when there is genuinely no
    // session -- and in development that fetch fails transiently while the dev
    // server recompiles (CLIENT_FETCH_ERROR "Failed to fetch"). Redirecting on
    // that lands on the sign-in page, which bounces straight back here, and the
    // browser gives up with ERR_TOO_MANY_REDIRECTS.
    //
    // Confirming the session endpoint is genuinely unauthenticated before
    // redirecting costs one request and breaks the cycle.
    if (status === "unauthenticated" && !redirecting.current) {
      redirecting.current = true;
      fetch("/api/auth/session", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.user) {
            // The session is fine; next-auth just failed to read it. Let its own
            // refetch settle rather than bouncing through sign-in.
            redirecting.current = false;
            return;
          }
          signIn(undefined, { callbackUrl: router.asPath });
        })
        .catch(() => {
          // Endpoint unreachable: retry on the next status change instead of
          // redirecting into a loop we cannot complete.
          redirecting.current = false;
        });
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