// pages/deploy.js
import { Title, Container } from '@mantine/core';
import StepperForm from '@/components/StepperForm';

const DeployPage = () => {
  return (
    <Container fluid my="xl">
      <Title order={2} mb="lg">
        Gen3 Deployment Configuration
      </Title>
      <StepperForm />
    </Container>
  );
};

export default DeployPage;
