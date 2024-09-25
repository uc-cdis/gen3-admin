import '@mantine/core/styles.css';
// import type { AppProps } from 'next/app';
import Head from 'next/head';
import { AppShell, Alert, Burger, MantineProvider, Container } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
// import { NavBar } from '../components/NavBar/NavBar';
import { NavBar } from '@/components/DoubleNavbar/DoubleNavbar.jsx';
import { Header } from '../components/Header/Header';
import { theme } from '../theme';
import { Notifications } from '@mantine/notifications';

import { useRouter } from 'next/router'

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
      layout='alt'
      withBorder={false}
      navbar={{
        width: 320,
        breakpoint: 'md',
        collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
      }}
      padding="md"
    >
      <AppShell.Header withBorder={false}>
        <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="md" />
        <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="md" />
        <Header />
      
      </AppShell.Header>

      <AppShell.Navbar p="md" withBorder={false}>
        <NavBar />
      </AppShell.Navbar>

      <AppShell.Main>
        <Notifications limit={10} position="bottom-right" />
        <Container size="xl">
          <Breadcrumbs />
          {/* <Alert mt="md" color="red" withCloseButton={false}>
            <b>You are currently connected to {url?.hostname}</b>
          </Alert> */}
          <Component {...pageProps} />

        </Container>

      </AppShell.Main>
      {/* <AppShell.Footer>Footer</AppShell.Footer> */}
    </AppShell>
  );
}


export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {

  const router = useRouter()

  // useEffect(() => {
  //   // Track page views
  //   const handleRouteChange = () => posthog?.capture('$pageview')
  //   router.events.on('routeChangeComplete', handleRouteChange)

  //   return () => {
  //     router.events.off('routeChangeComplete', handleRouteChange)
  //   }
  // }, [])


  return (
    <GlobalStateProvider> 
       <SessionProvider session={session}>
        <MantineProvider theme={theme}>
          <Head>
            <title>Gen3 - Admin</title>
            <meta
              name="viewport"
              content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
            />
            <link rel="shortcut icon" href="/favicon.svg" />
          </Head>
          <AppContent Component={Component} pageProps={pageProps} />
          {/* <Component {...pageProps} /> */}
        </MantineProvider>
      </SessionProvider>
     </GlobalStateProvider> 
  );
}
