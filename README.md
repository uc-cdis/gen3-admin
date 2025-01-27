# Gen3 CSOC

This is a first attempt at creating an admin dashboard, very much WIP. 

The idea is to move a lot of the functionality of what operators do in an adminvm to an api + UI. 

This is being developed by the PE team. 

## Frontend

Frontend is written in next.js using mantine as the library. 

It's using pages router to route. 

If you wanna add a new page add it under the `pages` folder. 

## Backend

Go api using gin.

Calls k8s api based on your current context.

## Dev environment

Make sure you have a kubectl set up and working towards a k8s cluster. KIND is a great way to run kubernetes in docker f.ex

Then run these commands:

## start api

```
cd api/
export PORT=8002; nodemon --exec go run main.go --signal SIGTERM
```

## start frontend

In a separate terminal
```
cd frontend/

npm install
npm run dev
```

-------------------------------------------------

# Gen3 CSOC/Admin  Overview

## Introduction
The Gen3 CSOC/Admin Dashboard is a centralized platform designed to facilitate the management of multiple Gen3 deployments and Kubernetes (k8s) clusters. Built with scalability and ease of use in mind, it provides system administrators and operators with a comprehensive set of tools to deploy, monitor, and manage their Gen3 ecosystems effectively. By integrating Helm and ArgoCD for deployment management, along with Kubernetes native tools for cluster and resource administration, the dashboard offers seamless control over complex cloud-native environments.

## Key Features

### Management of Gen3 Deployments

The Gen3 CSOC Dashboard provides an intuitive interface for managing one or multiple Gen3 deployments using Helm, a package manager for Kubernetes. Helm simplifies the deployment and configuration process by allowing administrators to define, install, and upgrade complex Kubernetes applications.

- Multi-Deployment Support:
  - Administrators can manage several Gen3 environments (production, development, and testing) from a single interface, providing centralized control over configuration and updates.
- Helm-Based Deployment:
  - The dashboard leverages Helm charts in the backend to deploy and manage Gen3 components across different environments, ensuring a consistent deployment workflow.
- Simplified Upgrades:
  - With Helm, the Admin Dashboard makes upgrading Gen3 deployments straightforward, reducing the risk of manual errors by automating the process and ensuring that updates are applied consistently across all environments.

### Build Generic Support for Managing Helm and ArgoCD

In addition to supporting Helm, the Gen3 CSOC Dashboard also integrates ArgoCD, a declarative GitOps continuous delivery tool for Kubernetes. This integration ensures that administrators have the flexibility to choose their preferred management tool while maintaining GitOps best practices.

- Helm and ArgoCD Integration: The dashboard provides built-in support for both Helm and ArgoCD, giving administrators the ability to manage Kubernetes resources either through Helm's package manager or ArgoCD's GitOps approach.
- GitOps Workflow: By leveraging ArgoCD, the dashboard enables administrators to implement a GitOps workflow, where all changes to Kubernetes clusters and applications are version-controlled, audited, and automatically synchronized with the cluster, promoting reliability and transparency.
- Unified Management Interface: Administrators can view, manage, and monitor their deployments, regardless of whether they use Helm or ArgoCD, from the same dashboard interface.

### Kubernetes Dashboard for Cluster and Resource Management

In addition to managing Gen3 deployments, the Admin Dashboard includes a Kubernetes management layer that enables users to monitor and control Kubernetes clusters and the resources deployed within them.

- Cluster Monitoring: The dashboard provides an overview of all connected Kubernetes clusters, displaying critical metrics such as node health, resource usage, and pod status.
- Resource Management: Administrators can easily view and manage Kubernetes resources such as Pods, Services, Deployments, and ConfigMaps from within the dashboard, reducing the need to switch between different tools or interfaces.
- Access Control: The dashboard integrates with Kubernetes Role-Based Access Control (RBAC), allowing administrators to assign granular permissions to users based on their roles within the organization.

### Agent/Server Architecture

The Gen3 CSOC Dashboard follows an agent/server architecture, allowing distributed management of multiple Kubernetes clusters from a centralized control plane. This architecture enhances scalability and simplifies the management of multiple, geographically dispersed clusters.

- Gen3 Agent Deployment: To manage multiple clusters, administrators deploy a Gen3 agent to each target Kubernetes cluster. The agent serves as the interface between the cluster and the central Gen3 CSOC Dashboard.
- Agent-Based Management: Once the Gen3 agent is deployed, administrators can manage the associated cluster directly from the dashboard without needing direct access to the cluster’s control plane, allowing for secure, remote management of multiple environments.
- Scalability: This architecture enables seamless management of clusters across different cloud providers or on-premises environments, making it easy to scale as new clusters are added or existing clusters grow in size.

## Benefits

### Centralized Control

- The Gen3 CSOC Dashboard provides a single, unified interface to manage multiple Gen3 deployments and Kubernetes clusters, simplifying operations and improving efficiency. With the ability to deploy, monitor, and manage resources from one platform, administrators can streamline their workflows and reduce the complexity of managing distributed environments.

- Flexibility
With built-in support for both Helm and ArgoCD, the dashboard caters to various deployment and management preferences. Administrators have the flexibility to choose the toolset that best fits their operational needs while maintaining control through a single dashboard.

- Improved Scalability
The agent/server architecture makes the system highly scalable, allowing for easy management of an expanding infrastructure. As the number of Kubernetes clusters grows, new agents can be deployed quickly to integrate them into the centralized management system.

- Enhanced Security and Auditability
By leveraging Kubernetes’ native RBAC and the GitOps principles provided by ArgoCD, the Admin Dashboard ensures that all changes to the system are controlled and auditable. This results in enhanced security, as administrators can enforce strict access controls and maintain a clear audit trail for all cluster and resource changes.

- Simplified Management of Complex Environments
The dashboard abstracts away much of the complexity of managing multiple Gen3 deployments and Kubernetes clusters, reducing the learning curve for administrators. By automating many of the common management tasks (e.g., deployment, upgrades, monitoring), the dashboard helps organizations efficiently manage large-scale environments with fewer resources.

## Conclusion

The Gen3 CSOC/Admin Dashboard is a powerful tool designed to simplify the management of Gen3 deployments and Kubernetes clusters. By integrating with Helm and ArgoCD, providing comprehensive Kubernetes cluster management, and adopting a scalable agent/server architecture, the dashboard helps organizations streamline their operations, improve security, and scale effectively as their infrastructure grows.
