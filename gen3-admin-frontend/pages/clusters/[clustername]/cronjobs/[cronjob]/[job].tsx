import { useRouter } from 'next/router'
import JobDetails  from '@/components/JobDetails/JobDetails';


export default function Page() {
  const router = useRouter()
  const name = router.query.job

  if (!name) {
    return null
  }
  return (
    <>
        <JobDetails name={name}/>
    </>
);
}