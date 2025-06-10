import '@mantine/core/styles.css';
// import type { AppProps } from 'next/app';
import Head from 'next/head';
import Link from 'next/link';
import { AppShell, Select, Box, Switch, Burger, Group, MantineProvider, Container, Center, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
// import { NavBar } from '../components/NavBar/NavBar';
// import { NavBar } from '@/components/DoubleNavbar/DoubleNavbar.jsx';

import { KeycloakProvider } from '@/contexts/KeycloakContext';


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
import { SessionProvider } from "next-auth/react"
// import { useSession, signIn, signOut } from "next-auth/react"

// import TrackerProvider from '@/contexts/openreplay'

import { GlobalStateProvider } from '@/contexts/global';



// End next-auth

// Self-rolled auth attempt below.

// import { AuthProvider } from '@/contexts/auth'

import AuthContext from '@/contexts/auth';
import { useContext, useEffect, useState } from 'react';

import Login from '../components/Login'; // You'll need to create this component


import '@mantine/core/styles.layer.css';
import '@mantine/notifications/styles.css';
import 'mantine-datatable/styles.layer.css';
import '@mantine/dates/styles.css';


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


  return (
    <AppShell
      header={{ height: 60 }}
      // layout='alt'
      withBorder={true}
      navbar={{
        width: 300,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
      }}
      padding="md"
    >
      {/* <AppShell.Header>
        <Group grow preventGrowOverflow={false} wrap="nowrap" h="100%" px="md" bg="var(--mantine-color-blue-light)">
          <Box w={10}>
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" width={100} />
            <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" />
          </Box>

        </Group> */}

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
    </AppShell>
  );
}


export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {

  const router = useRouter()


  return (
    <GlobalStateProvider>
      <SessionProvider session={session}>
      {/* <KeycloakProvider> */}
        <MantineProvider theme={theme}>
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
        </MantineProvider>
      {/* </KeycloakProvider> */}
      </SessionProvider>
    </GlobalStateProvider>
  );
}
