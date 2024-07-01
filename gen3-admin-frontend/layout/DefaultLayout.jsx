// components/DefaultLayout.jsx
export default function DefaultLayout({ children }) {
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
                {children}
  
              </Container>
  
            </AppShell.Main>
            {/* <AppShell.Footer>Footer</AppShell.Footer> */}
          </AppShell>
        </MantineProvider>
      </AuthProvider>
    );
  }
  