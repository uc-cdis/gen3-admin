import { useRouter } from 'next/router'
import { DeploymentDetails } from '../../components/DeploymentDetails/DeploymentDetails';


export default function Page() {
  const router = useRouter()
  return (
    <>
        <DeploymentDetails name={router.query.name}/>
    </>
);
}