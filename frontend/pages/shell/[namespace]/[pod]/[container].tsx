import dynamic from 'next/dynamic'

import { useRouter } from 'next/router'


const Terminal = dynamic(() => import('@/components/Shell/Terminal'), {
    ssr: false
})

export default function ContainerShell() {
    const router = useRouter()
    const namespace = router.query.namespace;
    const container = router.query.container;
    const pod = router.query.pod;
    

    return (
        <div>
            <Terminal namespace={namespace} container={container} pod={pod}  cluster="test" />
        </div>
    )
}