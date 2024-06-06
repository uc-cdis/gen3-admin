import { useEffect, useState } from 'react';
import { UnstyledButton, Tooltip, Title, rem, NavLink } from '@mantine/core';
import {
  IconHome2,
  IconGauge,
  IconDeviceDesktopAnalytics,
  IconFingerprint,
  IconCalendarStats,
  IconUser,
  IconSettings,
  IconCloudComputing,
  IconClipboardData,
  IconAppWindow
} from '@tabler/icons-react';
import classes from './DoubleNavbar.module.css';
import { useRouter } from 'next/router';



const navbarLinksData = [
  {
    label: 'Gen3',
    icon: IconAppWindow,
    initiallyOpened: true,
    links: [
      { label: 'Cluster Overview', link: '/cluster' },
      { label: 'CronJobs', link: '/cronjobs' },
      { label: 'Deployments', link: '/deployments' },
      { label: 'Pods', link: '/pods' },
      { label: 'Grafana', link: '/grafana' },
      { label: 'Databases', link: '/databases' },
      { label: 'Other stuff', link: '/other-stuff' },
    ],
  },
  {
    label: 'Cloud',
    icon: IconCloudComputing,
    link: '/cloud',
  },
  {
    label: 'Clients',
    icon: IconGauge,
    links: [
      { label: 'Databases', link: '/clients/databases' },
      { label: 'Pull Requests', link: '/clients/pull-requests' },
      { label: 'Open Issues', link: '/clients/open-issues' },
      { label: 'Wiki pages', link: '/clients/wiki-pages' },
    ],
  },
  {
    label: 'Analytics',
    icon: IconDeviceDesktopAnalytics,
    link: '/analytics',
  },
  {
    label: 'Account',
    icon: IconUser,
    link: '/account',
  },
  {
    label: 'Security',
    icon: IconFingerprint,
    link: '/security',
  },
  {
    label: 'Settings',
    icon: IconSettings,
    link: '/settings',
  },
];

export function DoubleNavbar() {
  const [active, setActive] = useState('Gen3');
  const [activeLink, setActiveLink] = useState('Cluster Overview');

  const router = useRouter();

  useEffect(() => {
    const activeMainLink = findActiveMainLink(router.pathname);
    setActive(activeMainLink);
    setActiveLink(findActiveSubLink(router.pathname, activeMainLink));
  }, [router.pathname]);
  
  const findActiveMainLink = (path) => {
    const mainLink = navbarLinksData.find((item) => {
      if (item.link && path.startsWith(item.link)) {
        return true;
      }
      if (item.links) {
        return item.links.some((subItem) => path.startsWith(subItem.link));
      }
      return false;
    });
    return mainLink ? mainLink.label : 'Gen3';
  };
  
  const findActiveSubLink = (path, activeMainLink) => {
    const mainLink = navbarLinksData.find((item) => item.label === activeMainLink);
    if (mainLink?.links) {
      const subLink = mainLink.links.find((item) => path.startsWith(item.link));
      return subLink ? subLink.label : '';
    }
    return '';
  };


  const mainLinks = navbarLinksData
    .filter((item) => item.icon)
    .map((link) => (
      <Tooltip
        label={link.label}
        position="right"
        withArrow
        transitionProps={{ duration: 0 }}
        key={link.label}
      >
        <UnstyledButton
          onClick={() => setActive(link.label)}
          className={classes.mainLink}
          data-active={link.label === active || undefined}
        >
          <link.icon style={{ width: rem(22), height: rem(22) }} stroke={1.5} />
        </UnstyledButton>
      </Tooltip>
    ));

  const links = navbarLinksData
    .find((item) => item.label === active)
    ?.links?.map((link) => (
      <a
        className={classes.link}
        data-active={activeLink === link.label || undefined}
        href={link.link}
        onClick={(event) => {
          event.preventDefault();
          setActiveLink(link.label);
        }}
        key={link.label}
      >
        {link.label}
      </a>
    ));

    
  const links2 = navbarLinksData
    .find((item) => item.label === active)
    ?.links?.map((link) => (
      <NavLink
        className={classes.link}
        data-active={activeLink === link.label || undefined}
        href={link.link}
        key={link.label}
        label={link.label}
      >
      </NavLink>
    ));



  return (
    <nav className={classes.navbar}>
      <div className={classes.wrapper}>
        <div className={classes.aside}>
          <div className={classes.logo}></div>
          {mainLinks}
        </div>
        <div className={classes.main}>
          <Title order={4} className={classes.title}>
            {active}
          </Title>

          {links2}
        </div>
      </div>
    </nav>
  );
}