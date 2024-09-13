import ProjectDashboard from "@/components/ProjectsDashboard";

import { Title } from "@mantine/core";

function Projects() {

  return (
    <div>
      <Title order={2} align="center" mb="xl">Projects Overview</Title>
      <ProjectDashboard />
    </div>
  );
}

export default Projects;