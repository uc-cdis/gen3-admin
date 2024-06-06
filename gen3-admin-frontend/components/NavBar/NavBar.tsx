import { NavLink, Group } from '@mantine/core';
import { useRouter } from 'next/router';
import { ColorSchemeToggle } from '../ColorSchemeToggle/ColorSchemeToggle';
// import classes from './Navbar.module.css';

export function NavBar() {
    const router = useRouter();
    return (
        <>
            <Group>
                <NavLink
                    label="Cluster Overview"
                    active={router.pathname === '/cluster'}
                    onClick={() => router.push('/cluster')}
                />
                <NavLink
                    label="CronJobs"
                    active={router.pathname === '/cronjobs'}
                    onClick={() => router.push('/cronjobs')}
                />
                <NavLink
                    label="Deployments"
                    active={router.pathname === '/deployments'}
                    onClick={() => router.push('/deployments')}
                />
            </Group>
            <ColorSchemeToggle />
        </>
    );
}