// pages/deploy.js
import { Title, Container } from '@mantine/core';
import StepperForm from '@/components/StepperForm';
import Gen3ConfigForm from '@/components/StepperForm/Gen3Config';



const DeployPage = () => {
  return (
    <Container fluid my="xl">
      <Title order={2} mb="lg">
        Gen3 Deployment Configuration
      </Title>
      <StepperForm />
      {/* <Gen3ConfigForm /> */}
    </Container>
  );
};

export default DeployPage;
