import { useRouter } from 'next/router'

import  LogWindow  from '@/components/Logs/LogWindow'

export default function ContainerLogs() {
    const router = useRouter()
    const { namespace, pod, container } = router.query
    return (
        <>
            <LogWindow namespace={namespace} pod={pod} container={container} />
        </>
    )
}