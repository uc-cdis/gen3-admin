import dynamic from 'next/dynamic'
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

const TerminalComponent = dynamic(() => import('@/components/Shell/psqlTerminal'), {
    ssr: false
})



export default function Home() {
    const router = useRouter();
    const { target } = router.query;

    const [agentId, setAgentId] = useState(null);

    useEffect(() => {
      if (router.isReady && typeof target === 'string') {
        setAgentId(target);
      }
    }, [router.isReady, target]);

    if (!agentId) {
      return <div>Loading...</div>; // Or a fancier spinner
    }

    return (
      <div className="p-4">
        <h1 className="text-xl mb-4">SSM Shell</h1>
        <TerminalComponent agentId={agentId} />
      </div>
    );
}
