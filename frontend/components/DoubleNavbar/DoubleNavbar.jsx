import { useEffect, useState } from 'react';
import { UnstyledButton, Tooltip, Title, rem, NavLink, Anchor, Label } from '@mantine/core';
import {
  IconHome2,
  IconGauge,
  IconDeviceDesktopAnalytics,
  IconChevronDown,
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

import { EnvSelector } from '@/components/EnvSelector';

import argocdIcon from '@/public/images/icons/argocd.png'

import Link from 'next/link';

import Image from 'next/image'


import { useGlobalState } from '@/contexts/global';



export function NavBar() {
  const [active, setActive] = useState('Gen3');
  const [activeLink, setActiveLink] = useState('Cluster Overview');

  const { activeCluster, setActiveCluster } = useGlobalState();

  const navbarLinksData = [
    {
      label: 'Kubernetes',
      icon: '/images/icons/k8s.svg',
      initiallyOpened: true,
      links: [
        { label: 'Clusters', link: '/clusters' },
        ...(activeCluster ? [
          { label: 'Jobs', link: `/clusters/${activeCluster}/cronjobs` },
          { label: 'Deployments', link: `/clusters/${activeCluster}/deployments` },
          { label: 'Pods', link: `/clusters/${activeCluster}/pods` },
          { label: 'Storage', link: `/clusters/${activeCluster}/storage` },
          { label: 'Networking', link: `/clusters/${activeCluster}/networking` }
        ] : [])
      ],
    },
    {
      label: 'Gen3',
      icon: "/images/icons/favicon.png",
      links: [
        { label: 'Projects', link: '/projects' },
        ...(activeCluster ? [{ label: 'Jobs', link: `/clusters/${activeCluster}/cronjobs` }] : []),
        { label: 'Databases', link: '/databases' },
        { label: 'Workspaces', link: '/workspaces' },
      ],
    },
    {
      label: 'ArgoCD',
      icon: "/images/icons/argocd.png",
      links: [
        { label: 'Applications', link: '/argocd/applications' },
        { label: 'Projects', link: '/argocd/projects' },
        { label: 'Repositories', link: '/argocd/repositories' },
        { label: 'Clusters', link: '/argocd/clusters' },
      ],
    },
    {
      label: 'Cloud',
      icon: IconCloudComputing,
      links: [
        { label: 'Accounts', link: '/cloud/accounts' },
        { label: 'Clusters', link: '/cloud/clusters' },
        { label: 'Storage', link: '/cloud/storage' },
      ],
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

  const router = useRouter();

  useEffect(() => {
    const activeMainLink = findActiveMainLink(router.pathname);
    const activeSubLink = findActiveSubLink(router.pathname, activeMainLink);
    console.log('activeMainLink', activeMainLink);
    console.log('activeSubLink', activeSubLink);
    setActive(activeMainLink);
    setActiveLink(activeSubLink);
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
      const pathSegments = path.split('/');
      const lastSegment = pathSegments[pathSegments.length - 1]; // Get the last part of the URL

      const subLink = mainLink.links.find((item) => {
        const subLinkSegments = item.link.split('/');
        const subLinkLastSegment = subLinkSegments[subLinkSegments.length - 1];
        return lastSegment === subLinkLastSegment; // Compare the last part of the path
      });
      console.log('subLink', subLink);
      return subLink ? subLink.label : '';
    }
    return '';
  };

  const renderIcon = (icon) => {
    if (typeof icon === 'string') {
      return <Image src={icon} width={22} height={22} alt="icon" />;
    } else if (React.isValidElement(icon)) {
      return icon;
    } else if (typeof icon === 'function') {
      const IconComponent = icon;
      return <IconComponent style={{ width: rem(22), height: rem(22) }} stroke={1.5} />;
    }
    return null;
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
          {typeof link.icon === 'string' ? (
            <Image src={link.icon} width={22} height={22} alt={`${link.label} icon`} />
          ) : (
            <link.icon style={{ width: rem(22), height: rem(22) }} stroke={1.5} />
          )}
        </UnstyledButton>
      </Tooltip>
    ));

  const links = navbarLinksData
    .find((item) => item.label === active)
    ?.links?.map((link) => (
      <a
        className={classes.link}
        data-active={activeLink === link?.label || undefined}
        href={link?.link}
        onClick={(event) => {
          event.preventDefault();
          setActiveLink(link.label);
        }}
        key={link?.label}
      >
        {link?.label}
      </a>
    ));


  const links2 = navbarLinksData
    .find((item) => item.label === active)
    ?.links?.map((link) => (
      <NavLink
        component={Link}
        className={classes.link}
        data-active={activeLink === link?.label || undefined}
        href={link?.link}
        key={link?.label}
        label={link?.label}
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
            <Link href="/" passHref legacyBehavior>
              <Image src="/favicon.svg" width={20} height={20} alt="Gen3 Logo" />
            </Link>
          </Title>
          <EnvSelector />
          {links2}
        </div>
      </div>
    </nav>
  );
}
