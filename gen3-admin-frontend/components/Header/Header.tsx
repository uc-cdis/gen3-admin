import Image from 'next/image'
import {Center, Container} from '@mantine/core';
import { ColorSchemeToggle } from '../ColorSchemeToggle/ColorSchemeToggle';
export function Header() {
    return(
    <>
    <Container>
        <a href="/">
            <Image 
                src="/images/logo.png" alt="Gen3 Logo" width={100} height={50} 
            />
        </a>
    </Container>
    </>
    )
}