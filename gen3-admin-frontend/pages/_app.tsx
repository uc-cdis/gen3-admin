import '@mantine/core/styles.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { AppShell, Burger, MantineProvider, Container } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavBar } from '../components/NavBar/NavBar';
import { DoubleNavbar } from '../components/DoubleNavbar/DoubleNavbar';
import { Header } from '../components/Header/Header';
import { theme } from '../theme';
import { Notifications } from '@mantine/notifications';

import  Breadcrumbs from '@/components/BreadCrumbs'
import { AuthProvider } from '../contexts/auth'


import '@mantine/notifications/styles.css';

export default function App({ Component, pageProps }: AppProps) {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);


  return (
    <AuthProvider>
    <MantineProvider theme={theme}>
      <Head>
        <title>Gen3 - Admin</title>
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
        />
        <link rel="shortcut icon" href="/favicon.svg" />
      </Head>
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
          <Component {...pageProps} />

          </Container>

        </AppShell.Main>
        {/* <AppShell.Footer>Footer</AppShell.Footer> */}
      </AppShell>
      {/* <Component {...pageProps} /> */}
    </MantineProvider>
    </AuthProvider>
  );
}
