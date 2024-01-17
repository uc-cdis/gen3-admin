import '@mantine/core/styles.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { AppShell, Burger, MantineProvider } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavBar } from '../components/NavBar/NavBar';
import { Header } from '../components/Header/Header';
import { theme } from '../theme';
import { Notifications } from '@mantine/notifications';

export default function App({ Component, pageProps }: AppProps) {
  const [opened, { toggle }] = useDisclosure();

  return (
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
        navbar={{
          width: 300,
          breakpoint: 'sm',
          collapsed: { mobile: !opened },
        }}
        padding="md"
      >
        
        <AppShell.Header withBorder={false}>
          <Burger
            opened={opened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
          />
          <Header />
        </AppShell.Header>

        <AppShell.Navbar p="md" withBorder={false}>
          <NavBar />
          </AppShell.Navbar>
          
        <AppShell.Main>
          <Component {...pageProps} />
        </AppShell.Main>
      </AppShell>
      <Notifications />
      {/* <Component {...pageProps} /> */}
    </MantineProvider>
  );
}
