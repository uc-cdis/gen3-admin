import { NavLink, Group } from '@mantine/core';
import { useRouter } from 'next/router';
import { ColorSchemeToggle } from '../ColorSchemeToggle/ColorSchemeToggle';
// import classes from './Navbar.module.css';

export function NavBar() {
    const router = useRouter();
    return (
        <>
            <Group direction="column" spacing="xs">
                <NavLink
                    label="Jobs"
                    active={router.pathname === '/jobs'}
                    onClick={() => router.push('/jobs/options')}
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