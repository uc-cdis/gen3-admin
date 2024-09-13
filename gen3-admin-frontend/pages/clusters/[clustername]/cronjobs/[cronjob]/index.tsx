import CronJobDetails from '@/components/CronJobDetails/CronJobDetails'
import { Container, Title } from '@mantine/core'

// import useRouter
import { useRouter } from 'next/router'

export default function index() {
  const router = useRouter()
  let cronjob = router.query.cronjob
  return (
    <>
      <Container fluid my={20}>
        <Title>{cronjob}</Title>

      </Container>
      <CronJobDetails name={cronjob} />
    </>
  )
}
