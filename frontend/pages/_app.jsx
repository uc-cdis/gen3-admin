import '@mantine/core/styles.css';
// import type { AppProps } from 'next/app';
import Head from 'next/head';
import Link from 'next/link';
import { AppShell, Select, Box, Switch, Burger, Group, MantineProvider, Container, Center, Text, Alert, Button, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
// RUM is initialised in instrumentation-client.js. Here the app only reports
// Pages Router navigations as views and React render errors. The
// onRouterTransitionStart export that used to sit here is for the App Router
// and did nothing in a Pages Router app.
import { DatadogPagesRouter, ErrorBoundary } from '@datadog/browser-rum-nextjs';
import { datadogEnabled } from '@/lib/datadog';

import SpotLight from '@/components/Spotlight/Spotlight';

import { NavBar } from '@/components/NewNavbar/Navbar';

import { Header } from '../components/Header/Header';
import { theme } from '../theme';
import { Notifications } from '@mantine/notifications';
import { SWRConfig } from 'swr';

import { useRouter } from 'next/router'

import { IconHeart, IconSettings, IconHome } from '@tabler/icons-react';

import Breadcrumbs from '@/components/BreadCrumbs'

// Next-auth attempt
import { SessionProvider, signIn, useSession } from "next-auth/react"
// import { useSession, signIn, signOut } from "next-auth/react"

// import TrackerProvider from '@/contexts/openreplay'

import { GlobalStateProvider } from '@/contexts/global';
import { FocusedLayoutProvider, useFocusedLayoutState } from '@/contexts/focusedLayout';



// End next-auth

// Self-rolled auth attempt below.

// import { AuthProvider } from '@/contexts/auth'

import AuthContext from '@/contexts/auth';
import { useContext, useEffect, useState, useRef } from 'react';

import Login from '../components/Login'; // You'll need to create this component


import '@mantine/core/styles.layer.css';
import '@mantine/notifications/styles.css';
import 'mantine-datatable/styles.layer.css';
import '@mantine/dates/styles.css';
import { AuthenticatedLayout } from '@/layout/AuthenticatedLayout';

const bootstrapEnabled = process.env.NEXT_PUBLIC_BOOTSTRAP_MODE === "true";


function BootstrapAuthGate({ children }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const loginTriggeredRef = useRef(false);

  useEffect(() => {
    if (!bootstrapEnabled) return;

    if (status === "loading") return;

    // Already authenticated
    if (status === "authenticated" && session) return;

    // status "unauthenticated" → trigger auto-login
    if (!loginTriggeredRef.current) {
      loginTriggeredRef.current = true;
      (async () => {
        const result = await signIn("mock-provider", {
          redirect: false
        });
        if (!(result?.ok || result?.status === 200)) {
          console.error("[bootstrap] auto mock sign-in failed:", result?.error ?? result?.status);
        }
      })();
    }
  }, [session, status, router]);

  // When in bootstrap mode:
  // - While loading or auto-login in progress, render nothing to avoid normal auth redirect.
  if (bootstrapEnabled) {
    if (status === "loading") return null;
    if (status === "unauthenticated" && !loginTriggeredRef.current) return null;
  }

  return children;
}


// Shown in place of a page that throws while rendering. The ErrorBoundary also
// reports the error to Datadog RUM.
function PageErrorFallback({ error, resetError }) {
  return (
    <Alert color="statusError" title="This page failed to render" mt="md">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{error?.message || 'An unexpected error occurred.'}</Text>
        <Button size="xs" variant="light" onClick={resetError}>Try again</Button>
      </Stack>
    </Alert>
  );
}

function AppContent({ Component, pageProps: { session, ...pageProps }, }) {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  const { user, authorized, url, loading, login, logout } = useContext(AuthContext);


  // if (user && !authorized) {
  //   // TODO: Implement some 403 page here.
  //   // logout()
  // }


  // if (!user && !loading) {
  //   return (
  //     <>
  //       <Notifications limit={10} position="top-center" />
  //       <Login />
  //     </>
  //   );
  // }

  const bootstrapEnabled = process.env.NEXT_PUBLIC_BOOTSTRAP_MODE === "true";

  // A page that owns the whole viewport -- the environment chooser, the setup
  // wizard -- asks for the chrome to step aside. Both are "you have not picked
  // a context yet" screens, where a sidebar for navigating *within* a context
  // is dead weight that also squeezes the content into a narrow column.
  const focusedLayout = useFocusedLayoutState();
  const chromeless = bootstrapEnabled || focusedLayout;

  const appShellProps = {
    header: { height: 60 },
    withBorder: true,
    padding: "md",
  };

  if (!chromeless) {
    appShellProps.navbar = {
      width: 300,
      breakpoint: "sm",
      collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
    };
  }


  return (

    <AppShell {...appShellProps} >

      <AppShell.Header>
        <Group
          h="100%"
          px="md"
          justify="space-between"
          align="center"
          grow preventGrowOverflow={false} wrap="nowrap"
        >
          <Header toggleDesktop={toggleDesktop} desktopOpened={desktopOpened} toggleMobile={toggleMobile} mobileOpened={mobileOpened} />
        </Group>

      </AppShell.Header>


      {!chromeless && (
        <AppShell.Navbar p="md" withBorder={false}>
          <NavBar />
        </AppShell.Navbar>
      )}

      <AppShell.Main>
        <Notifications limit={10} position="bottom-right" />
        <Container size={chromeless ? "md" : "xl"} fluid={!chromeless}>
          {!chromeless && <Breadcrumbs />}
          {/* <Alert mt="md" color="red" withCloseButton={false}>
            <b>You are currently connected to {url?.hostname}</b>
          </Alert> */}
          <ErrorBoundary fallback={PageErrorFallback}>
            <Component {...pageProps} />
          </ErrorBoundary>

        </Container>

      </AppShell.Main>
      <Container size="xl">
        <Center inline>
          {/* <AppShell.Footer>
            <Container size="xl" maw={600}>
              Made with <IconHeart color="var(--mantine-color-blue-filled)" /> by the <Anchor component={Link} href="https://gen3.org/"> Gen3</Anchor> team @ <Anchor component={Link} href="https://ctds.uchicago.edu">CTDS / UChicago.edu</Anchor>
            </Container>
          </AppShell.Footer> */}
        </Center>
      </Container>
    </AppShell >
  );
}


// Shared SWR behaviour. Deduping alone removes real duplicate work: a resource
// detail page and the components inside it often request the same object.
const swrConfig = {
  revalidateOnFocus: true,
  errorRetryCount: 2,
  dedupingInterval: 2000,
  // Only retry transient server-side failures; a 403/404 will not fix itself.
  shouldRetryOnError: (error) => Boolean(error?.isServerError),
};

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {


  return (
    <GlobalStateProvider>
      <FocusedLayoutProvider>
      <SessionProvider
        session={session}
        // NextAuth expresses this in SECONDS, not milliseconds: 150s = 2.5 min.
        refetchInterval={150}
        // Refetch session when window regains focus
        refetchOnWindowFocus={true}
      >
        {/* <KeycloakProvider> */}
        <BootstrapAuthGate>
          <SWRConfig value={swrConfig}>
          <MantineProvider theme={theme} defaultColorScheme="auto">
            <AuthenticatedLayout>
              <Head>
                <title>Gen3 - Admin</title>
                <meta
                  name="viewport"
                  content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
                />
                <link rel="shortcut icon" href="/favicon.svg" />
              </Head>
              <SpotLight />
              {datadogEnabled && <DatadogPagesRouter />}

              <AppContent Component={Component} pageProps={pageProps} />
              {/* <Component {...pageProps} /> */}
            </AuthenticatedLayout>
          </MantineProvider>
          </SWRConfig>
        </BootstrapAuthGate>
        {/* </KeycloakProvider> */}
      </SessionProvider>
      </FocusedLayoutProvider>
    </GlobalStateProvider>
  );
}
