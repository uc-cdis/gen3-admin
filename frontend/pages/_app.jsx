import '@mantine/core/styles.css';
// import type { AppProps } from 'next/app';
import Head from 'next/head';
import Link from 'next/link';
import { AppShell, Select, Box, Switch, Burger, Group, MantineProvider, Container, Center, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
// import { NavBar } from '../components/NavBar/NavBar';
// import { NavBar } from '@/components/DoubleNavbar/DoubleNavbar.jsx';

// import { KeycloakProvider } from '@/contexts/KeycloakContext';


import SpotLight from '@/components/Spotlight/Spotlight';

import { NavBar } from '@/components/NewNavbar/Navbar';
// import { NavBar } from '@/components/NewNavbar/Navbar2';

import { Header } from '../components/Header/Header';
import { theme } from '../theme';
import { Notifications } from '@mantine/notifications';

import { useRouter } from 'next/router'

import { IconHeart, IconSettings, IconHome } from '@tabler/icons-react';

import Breadcrumbs from '@/components/BreadCrumbs'

// Next-auth attempt
import { SessionProvider, signIn, useSession } from "next-auth/react"
// import { useSession, signIn, signOut } from "next-auth/react"

// import TrackerProvider from '@/contexts/openreplay'

import { GlobalStateProvider } from '@/contexts/global';



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

    console.log("---------- BOOTSTRAP EFFECT RUN ----------");
    console.log("[bootstrap] BOOTSTRAP_MODE:", bootstrapEnabled);
    console.log("[bootstrap] current route:", router.pathname);
    console.log("[bootstrap] session value:", session);
    console.log("[bootstrap] status:", status);

    // Status Loading
    if (status === "loading") {
      console.log("[bootstrap] status=loading (checking cookies)");
      return;
    }

    // Already authenticated
    if (status === "authenticated" && session) {
      console.log("[bootstrap] session detected! Authenticated user:", session.user);
      return;
    }

    // status "unauthenticated" → trigger auto-login
    if (!loginTriggeredRef.current) {
      console.log("[bootstrap] User unauthenticated in bootstrap mode. Triggering auto sign-in!");
      loginTriggeredRef.current = true;
      (async () => {
        const result = await signIn("mock-provider", {
          redirect: false
        });
        console.log("[bootstrap] signIn() result:", result);
        if (!(result?.ok || result?.status === 200)) {
          console.error("[bootstrap] Auto mock sign-in FAILED!", result);
        } else {
          console.log("[bootstrap] Auto mock sign-in SUCCEEDED (waiting for session update)");
        }
      })();
    } else {
      console.log("[bootstrap] Auto sign-in already triggered, waiting for session update …");
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

  const appShellProps = {
    header: { height: 60 },
    withBorder: true,
    padding: "md",
  };

  // Add navbar ONLY if bootstrap is NOT enabled
  if (!bootstrapEnabled) {
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


      <AppShell.Navbar p="md" withBorder={false}>
        <NavBar />
      </AppShell.Navbar>

      <AppShell.Main>
        <Notifications limit={10} position="bottom-right" />
        <Container size="xl" fluid>
          <Breadcrumbs />
          {/* <Alert mt="md" color="red" withCloseButton={false}>
            <b>You are currently connected to {url?.hostname}</b>
          </Alert> */}
          <Component {...pageProps} />

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


export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {


  return (
    <GlobalStateProvider>
      <SessionProvider
        session={session}
        // Enable automatic session polling every 5 seconds
        refetchInterval={5}
        // Refetch session when window regains focus
        refetchOnWindowFocus={true}
        // Refetch when browser comes back online
        refetchWhenOffline={false}
      >
        {/* <KeycloakProvider> */}
        <BootstrapAuthGate>
          <MantineProvider theme={theme}>
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

              <AppContent Component={Component} pageProps={pageProps} />
              {/* <Component {...pageProps} /> */}
            </AuthenticatedLayout>
          </MantineProvider>
        </BootstrapAuthGate>
        {/* </KeycloakProvider> */}
      </SessionProvider>
    </GlobalStateProvider>
  );
}
