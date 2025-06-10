# Gen3 CSOC Directory Structure

This document provides a comprehensive overview of the Gen3 CSOC project directory structure and the purpose of each component.

## Root Level

```
.
├── api/                           # Backend Go API server
├── frontend/                      # Next.js frontend application
├── build-push.sh                  # Build and deployment script
├── docker-compose.yml             # Main Docker Compose configuration
├── Dockerfile.agent               # Docker image for Gen3 agents
├── Dockerfile.api                 # Docker image for API server
├── Dockerfile.frontend            # Docker image for frontend
└── README.md                      # Project documentation
```

## API Directory (`/api`)

The backend API server built with Go, providing REST endpoints and gRPC services for cluster management.

```
api/
├── certs/                  # TLS certificates for secure communication
├── gen3-agent/            # Gen3 agent source code
├── go.mod                 # Go module definition
├── go.sum                 # Go module checksums
├── internal/              # Internal Go packages (not exported)
├── main.go                # API server entry point
├── pkg/                   # Public Go packages (exportable)
└── static/                # Static assets served by the API
```

### Key API Components

- **`main.go`**: Entry point for the API server, initializes Gin router and starts HTTP/gRPC servers
- **`internal/`**: Contains private Go packages:
  - Authentication handlers
  - Kubernetes client integration
  - Database models and operations
  - Business logic and service layers
- **`pkg/`**: Contains public Go packages that can be imported by other projects:
  - Shared utilities
  - API client libraries
  - Common data structures
- **`gen3-agent/`**: Source code for the distributed agent that runs on remote Kubernetes clusters
- **`certs/`**: Stores TLS certificates for secure gRPC communication between server and agents
- **`static/`**: Static files served by the API (documentation, assets, etc.)

## Frontend Directory (`/frontend`)

Next.js application providing the web-based dashboard interface.

```
frontend/
├── components/            # Reusable React components
├── contexts/              # React Context providers
├── hooks/                 # Custom React hooks
├── layout/                # Layout components and templates
├── lib/                   # Utility libraries and helpers
├── middleware/            # Next.js middleware
├── pages/                 # Next.js pages (Pages Router)
├── public/                # Static assets (images, icons, etc.)
├── utils/                 # Utility functions
├── package.json           # Node.js dependencies
├── next.config.mjs        # Next.js configuration
├── tsconfig.json          # TypeScript configuration
├── theme.ts               # Mantine UI theme configuration
└── jest.config.cjs        # Jest testing configuration
```

### Key Frontend Components

- **`pages/`**: Next.js pages using the Pages Router:
  - `/clusters` - Cluster management interface
  - `/deployments` - Gen3 deployment management
  - `/monitoring` - Monitoring and observability dashboard
  - `/security` - Security and authentication settings
- **`components/`**: Reusable UI components built with Mantine:
  - Dashboard widgets
  - Forms and input components
  - Data tables and visualizations
  - Navigation components
- **`contexts/`**: React Context providers for:
  - Authentication state
  - Cluster connection status
  - Global application state
- **`hooks/`**: Custom React hooks for:
  - API data fetching
  - WebSocket connections
  - State management
- **`lib/`**: Utility libraries:
  - API client functions
  - Data transformation utilities
  - Configuration management
- **`middleware/`**: Next.js middleware for:
  - Authentication checks
  - Request routing
  - CORS handling

## Docker Configuration

### Container Images

- **`Dockerfile.api`**: Multi-stage build for the Go API server
  - Compiles Go binary
  - Minimal runtime image
  - Includes necessary certificates and static files

- **`Dockerfile.frontend`**: Next.js application container
  - Node.js runtime
  - Built Next.js application
  - Optimized for production deployment

- **`Dockerfile.agent`**: Gen3 agent container
  - Lightweight Go binary
  - Kubernetes client libraries
  - Certificate management

### Docker Compose

- **`docker-compose.yml`**: Main application stack
  - API server
  - Frontend application
  - Database services
  - Networking configuration

## Build and Deployment

- **`build-push.sh`**: Automated build script
  - Docker image building
  - Container registry pushing
  - Version management
  - CI/CD integration

## Configuration Files

### Frontend Configuration
- **`next.config.mjs`**: Next.js build and runtime configuration
- **`tsconfig.json`**: TypeScript compiler settings
- **`postcss.config.cjs`**: CSS processing configuration
- **`jest.config.cjs`**: Unit testing configuration
- **`theme.ts`**: Mantine UI theme customization

### API Configuration
- **`go.mod`**: Go module dependencies and version constraints
- **`go.sum`**: Cryptographic checksums for dependency verification

## Development Workflow

1. **API Development**: Work in `/api` directory
   - Modify handlers in `internal/`
   - Add shared utilities to `pkg/`
   - Update agent code in `gen3-agent/`

2. **Frontend Development**: Work in `/frontend` directory
   - Add new pages in `pages/`
   - Create components in `components/`
   - Implement utilities in `lib/` and `utils/`

3. **Testing**:
   - Frontend: Jest configuration in `jest.config.cjs`
   - API: Go testing in respective package directories

4. **Deployment**:
   - Use Docker Compose for local development
   - Build production images with individual Dockerfiles
   - Deploy with `build-push.sh` script
