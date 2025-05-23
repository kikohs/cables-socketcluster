# Cables SocketCluster Dashboard

[![Docker Build](https://github.com/kikohs/cables-socketcluster/actions/workflows/docker-build.yml/badge.svg)](https://github.com/kikohs/cables-socketcluster/actions/workflows/docker-build.yml)

A real-time admin dashboard for monitoring SocketCluster servers with connection tracking, event logging, and message inspection.

## Features

- Real-time connection monitoring
- Activity logging for all SocketCluster events
- Message inspection and filtering
- Connection tracking with client details
- Secure admin authentication
- Containerized deployment support

## Quick Start

### Running Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/kikohs/cables-socketcluster.git
   cd cables-socketcluster
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Access the dashboard at http://localhost:8000

### With Docker

Build and run using Docker:

```bash
docker build -t cables-socketcluster .
docker run -p 8000:8000 cables-socketcluster
```

## Deployment

### Environment Variables

Configure the application using the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` or `SOCKETCLUSTER_PORT` | Port to run the server on | 8000 |
| `ADMIN_PASSWORD_HASH` | SHA-256 hash of admin password | (Default hash provided) |
| `ENV` | Environment (dev/prod) | dev |
| `SOCKETCLUSTER_LOG_LEVEL` | Log verbosity (0-3) | 2 |

### Setting Admin Password

For security in production, always set your own admin password by providing its SHA-256 hash as an environment variable:

```bash
# Generate hash from password (example using Node.js)
node -e "console.log(require('crypto').createHash('sha256').update('your-password').digest('hex'))"
```

Then set the environment variable:

```bash
# Linux/macOS
export ADMIN_PASSWORD_HASH=your-generated-hash

# Windows
set ADMIN_PASSWORD_HASH=your-generated-hash

# Docker
docker run -p 8000:8000 -e ADMIN_PASSWORD_HASH=your-generated-hash cables-socketcluster
```

### Kubernetes Deployment

The repository includes Kubernetes deployment configurations in the `kubernetes/` directory:

```bash
# Deploy to Kubernetes
kubectl apply -f kubernetes/
```

**Note:** The Kubernetes configuration files may need to be updated to use the latest image version (currently referencing older versions).

Configure the deployment by editing the YAML files or using ConfigMaps/Secrets for environment variables:

```yaml
# Example environment variables in Kubernetes deployment
env:
  - name: SOCKETCLUSTER_PORT
    value: "8000"
  - name: ADMIN_PASSWORD_HASH
    valueFrom:
      secretKeyRef:
        name: socketcluster-secrets
        key: admin-password-hash
  - name: ENV
    value: prod
```

## Development

For local development with automatic restart:

```bash
npm run start:watch
```

## Security Notes

- Always change the default admin password hash in production
- Consider placing the dashboard behind a secure proxy/ingress
- Restrict access to the admin dashboard URL in production
- For multiple instances, ensure your load balancer supports WebSocket connections

## Releasing New Versions

This project uses GitHub Actions for automated builds and releases. To create a new release:

1. Make your changes to the codebase
2. Commit and push your changes to the master branch
3. Create and push a new tag with semantic versioning:

```bash
git tag v1.0.0  # Use appropriate version number (v0.1, v1.0.0, etc.)
git push origin v1.0.0
```

This will automatically:
- Build a new Docker image
- Push the image to GitHub Container Registry (ghcr.io/kikohs/cables-socketcluster:1.0.0)
- Create a GitHub Release with auto-generated release notes
- Update the "latest" tag to point to the new version

You can then pull the Docker image with:
```bash
docker pull ghcr.io/kikohs/cables-socketcluster:1.0.0
# or using the latest tag
docker pull ghcr.io/kikohs/cables-socketcluster:latest
```

## License

This project is licensed under the MIT License.