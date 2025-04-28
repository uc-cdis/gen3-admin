import dynamic from 'next/dynamic'
import { useRouter } from 'next/router';

const TerminalComponent = dynamic(() => import('@/components/Shell/SsmTerminal'), {
    ssr: false
})



export default function Home() {
    const router = useRouter()
    const { instance } = router.query

    if (!router.isReady || typeof instance !== 'string') {
        return <div>Loading...</div>; // or null/spinner
    }

    return (
        <div className="p-4">
            <h1 className="text-xl mb-4">SSM Shell</h1>
            <TerminalComponent instanceid={instance} />
        </div>
    );
}
