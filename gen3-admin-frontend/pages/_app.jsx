import '@mantine/core/styles.css';
// import type { AppProps } from 'next/app';
import Head from 'next/head';
import { AppShell, Alert, Burger, MantineProvider, Container } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavBar } from '../components/NavBar/NavBar';
import { DoubleNavbar } from '../components/DoubleNavbar/DoubleNavbar';
import { Header } from '../components/Header/Header';
import { theme } from '../theme';
import { Notifications } from '@mantine/notifications';

import { useRouter } from 'next/router'

import Breadcrumbs from '@/components/BreadCrumbs'

// Next-auth attempt
import { SessionProvider } from "next-auth/react"
import { useSession, signIn, signOut } from "next-auth/react"


// End next-auth

// Self-rolled auth attempt below.

import { AuthProvider } from '@/contexts/auth'

import AuthContext from '@/contexts/auth';
import { useContext, useEffect, useState } from 'react';

import Login from '../components/Login'; // You'll need to create this component



import '@mantine/notifications/styles.css';


// pages/_app.js
import posthog from "posthog-js"
import { PostHogProvider } from 'posthog-js/react'


if (typeof window !== 'undefined') { // checks that we are client-side
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
    capture_pageview: true,
    capture_pageleave: true, // Enable pageleave capture
    loaded: (posthog) => {
      if (process.env.NODE_ENV === 'development') posthog.debug(false) // debug mode in development
    },
  })
}

function AppContent({ Component, pageProps }) {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  const { user, authorized, url, loading, login, logout } = useContext(AuthContext);

  // next-auth stuff
  // const { data: session } = useSession()
  // if (session) {
  //   console.log("hello from session")
  // } else {
  //   console.log("no session :(")
  // }

  if (user && !authorized) {
    // TODO: Implement some 403 page here. 
    // logout()
  }


  if (!user && !loading) {
    return (
      <>
        <Notifications limit={10} position="top-center" />
        <Login />
      </>
    );
  }


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
        {/* <NavBar /> */}
        <DoubleNavbar />
      </AppShell.Navbar>

      <AppShell.Main>
        <Notifications limit={10} position="bottom-right" />
        <Container size="xl">
          <Breadcrumbs />
          <Alert mt="md" color="red" withCloseButton={false}>
            You are currently connected to {url?.hostname}
          </Alert>
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

  useEffect(() => {
    // Track page views
    const handleRouteChange = () => posthog?.capture('$pageview')
    router.events.on('routeChangeComplete', handleRouteChange)

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange)
    }
  }, [])


  return (
    <PostHogProvider client={posthog}>
      <AuthProvider>
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
      </AuthProvider>
    </PostHogProvider>
  );
}
