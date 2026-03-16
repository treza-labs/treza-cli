# Treza CLI

<p align="center">
  <strong>Command-line interface for the Treza platform</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@treza/cli"><img src="https://img.shields.io/npm/v/@treza/cli.svg" alt="npm version"></a>
  <a href="https://github.com/treza-labs/treza-cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://trezalabs.com"><img src="https://img.shields.io/badge/docs-trezalabs.com-blue" alt="Documentation"></a>
</p>

---

Manage secure enclaves, verify KYC proofs, and interact with the Treza platform directly from your terminal.

## Installation

```bash
npm install -g @treza/cli
```

Or with yarn:

```bash
yarn global add @treza/cli
```

## Quick Start

```bash
# Configure the CLI with your wallet
treza config init

# List your enclaves
treza enclave list

# Create an enclave from a Docker image
treza enclave create \
  --name "My Enclave" \
  --source-type registry \
  --image nginx:latest \
  --region us-west-2

# Create an enclave from a GitHub repository
treza enclave create \
  --name "My App Enclave" \
  --source-type github \
  --github-repo https://github.com/my-org/my-app \
  --github-branch main \
  --region us-west-2
```

## Commands

### Configuration

```bash
# Interactive setup
treza config init

# Show current configuration
treza config show

# Set individual values
treza config set walletAddress 0x...
treza config set apiUrl https://app.trezalabs.com

# Clear all configuration
treza config clear
```

### Enclaves

#### List & inspect

```bash
# List all enclaves
treza enclave list
treza enc ls              # alias

# Get enclave details
treza enclave get <id>
```

#### Create

Enclaves support three deployment sources:

**From a public Docker / container registry image:**

```bash
treza enclave create \
  --name "My Enclave" \
  --source-type registry \
  --image nginx:latest \
  --region us-west-2 \
  --instance-type m6i.xlarge \
  --cpu 2 \
  --memory 1024
```

**From a GitHub repository** (Treza builds the image automatically):

```bash
treza enclave create \
  --name "My App Enclave" \
  --source-type github \
  --github-repo https://github.com/my-org/my-app \
  --github-branch main \
  --github-token ghp_xxxxxxxxxxxx \
  --region us-west-2
```

> Your repository must contain a `Dockerfile` at its root. The build status will progress through `PENDING_BUILD → BUILDING → PENDING_DEPLOY → DEPLOYING → DEPLOYED`.

**From a private container registry:**

```bash
treza enclave create \
  --name "My Private Enclave" \
  --source-type private-registry \
  --image registry.example.com/my-org/my-app:latest \
  --registry-url registry.example.com \
  --registry-username myuser \
  --registry-password mypassword \
  --region us-west-2
```

#### Provider & hardware options

| Flag | Description | Default |
|------|-------------|---------|
| `--provider <id>` | Provider ID | `aws-nitro` |
| `--instance-type <type>` | EC2 instance type | `m6i.xlarge` |
| `--cpu <count>` | vCPU count for the enclave | `2` |
| `--memory <mib>` | Memory in MiB for the enclave | `1024` |
| `--workload-type <type>` | `service` or `task` | `service` |

#### Lifecycle management

```bash
treza enclave pause <id>
treza enclave resume <id>
treza enclave terminate <id>
treza enclave delete <id>
```

#### Logs

```bash
# Application logs (default)
treza enclave logs <id>
treza enclave logs <id> --type application --limit 100

# Build logs (for GitHub-sourced enclaves)
treza enclave logs <id> --type build

# System logs
treza enclave logs <id> --type system
```

### KYC Verification

```bash
# Verify a proof
treza kyc verify <proof-id>

# Get proof details
treza kyc get <proof-id>

# Quick status check
treza kyc status <proof-id>
```

### Tasks

```bash
# List all tasks
treza task list
treza task ls --enclave <enclave-id>

# Create a scheduled task
treza task create
treza task create --name "Daily Sync" --enclave <id> --schedule "0 0 * * *"

# Delete a task
treza task delete <id>

# Show cron examples
treza task cron
```

### Providers

```bash
# List available providers
treza provider list
```

## Global Options

```bash
--json          # Output as JSON (available on most commands)
--help, -h      # Show help for any command
--version, -v   # Show CLI version
```

## Configuration

The CLI stores configuration in a local config file:

| Setting | Description | Default |
|---------|-------------|---------|
| `walletAddress` | Your Ethereum wallet address | Required |
| `apiUrl` | Treza API endpoint | `https://app.trezalabs.com` |
| `apiKey` | Optional API key for authenticated requests | — |

Configuration is stored at:
- macOS: `~/Library/Preferences/treza-cli-nodejs/config.json`
- Linux: `~/.config/treza-cli-nodejs/config.json`
- Windows: `%APPDATA%/treza-cli-nodejs/config.json`

## Examples

### Deploy from a GitHub repository

```bash
# Configure CLI
treza config init

# Create an enclave that builds from your GitHub repo
treza enclave create \
  --name "Demo App" \
  --source-type github \
  --github-repo https://github.com/my-org/my-app \
  --github-branch main \
  --github-token ghp_xxxxxxxxxxxx \
  --region us-west-2

# Monitor build progress
treza enclave logs <id> --type build

# Once status is DEPLOYED, view application logs
treza enclave logs <id> --type application
```

### Deploy from Docker Hub

```bash
treza enclave create \
  --name "Nginx Enclave" \
  --source-type registry \
  --image nginx:latest \
  --region us-west-2

# Check status
treza enclave get <id>
```

### Deploy from a private registry

```bash
treza enclave create \
  --name "Internal Service" \
  --source-type private-registry \
  --image registry.example.com/my-org/service:v1.0.0 \
  --registry-url registry.example.com \
  --registry-username myuser \
  --registry-password mypassword \
  --region us-west-2
```

### Verify KYC proofs

```bash
# Quick verification
treza kyc status 550e8400-e29b-41d4-a716-446655440000

# Detailed verification with JSON output
treza kyc verify 550e8400-e29b-41d4-a716-446655440000 --json
```

### Scripting and automation

```bash
# List enclaves as JSON for parsing
treza enclave list --json | jq '.[] | select(.status == "DEPLOYED")'

# Create enclave non-interactively
treza enclave create \
  --name "Automated Enclave" \
  --source-type registry \
  --image my-org/my-service:latest \
  --region us-west-2 \
  --provider aws-nitro
```

## Enclave Status Lifecycle

| Status | Description |
|--------|-------------|
| `PENDING_BUILD` | Waiting to start building from GitHub source |
| `BUILDING` | AWS CodeBuild is building the Docker image |
| `BUILD_FAILED` | Build failed — check build logs |
| `PENDING_DEPLOY` | Image ready, waiting to deploy |
| `DEPLOYING` | EC2 Nitro instance is being provisioned |
| `DEPLOYED` | Running and healthy |
| `PAUSED` | Instance stopped |
| `TERMINATED` | Instance terminated |

## Development

```bash
# Clone the repository
git clone https://github.com/treza-labs/treza-cli.git
cd treza-cli

# Install dependencies
npm install

# Build
npm run build

# Link for local development
npm link

# Now you can use 'treza' command globally
treza --help
```

## Related Projects

- **[@treza/sdk](https://github.com/treza-labs/treza-sdk)** - TypeScript SDK for programmatic access
- **[treza-app](https://github.com/treza-labs/treza-app)** - Web dashboard and API
- **[treza-mobile](https://github.com/treza-labs/treza-mobile)** - iOS app for ZK proof generation
- **[treza-contracts](https://github.com/treza-labs/treza-contracts)** - Smart contracts for KYC verification

## Support

- **Documentation**: [docs.trezalabs.com](https://docs.trezalabs.com)
- **Issues**: [GitHub Issues](https://github.com/treza-labs/treza-cli/issues)
- **Website**: [trezalabs.com](https://trezalabs.com)

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built by <a href="https://trezalabs.com">Treza Labs</a> — Privacy infrastructure for the next era of finance.
</p>
