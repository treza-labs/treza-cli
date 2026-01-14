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

# Create a new enclave
treza enclave create --name "My Secure Enclave" --region us-east-1

# Verify a KYC proof
treza kyc verify <proof-id>
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

```bash
# List all enclaves
treza enclave list
treza enc ls              # alias

# Get enclave details
treza enclave get <id>

# Create a new enclave
treza enclave create
treza enclave create --name "Bot" --region us-east-1 --provider aws-nitro-enclave

# Lifecycle management
treza enclave pause <id>
treza enclave resume <id>
treza enclave terminate <id>
treza enclave delete <id>

# View logs
treza enclave logs <id>
treza enclave logs <id> --type application --limit 100
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
| `walletAddress` | Your Ethereum/Solana wallet address | Required |
| `apiUrl` | Treza API endpoint | `https://app.trezalabs.com` |
| `apiKey` | Optional API key for authenticated requests | - |

Configuration is stored at:
- macOS: `~/Library/Preferences/treza-cli-nodejs/config.json`
- Linux: `~/.config/treza-cli-nodejs/config.json`
- Windows: `%APPDATA%/treza-cli-nodejs/config.json`

## Examples

### Create and manage an enclave workflow

```bash
# Configure CLI
treza config init

# Create a new enclave
treza enclave create --name "Trading Bot" --region us-east-1

# Wait for deployment, then check status
treza enclave get enc_123456789

# View application logs
treza enclave logs enc_123456789 --type application

# Schedule a task
treza task create --name "Hourly Check" --enclave enc_123456789 --schedule "0 * * * *"

# When done, terminate and clean up
treza enclave terminate enc_123456789 --force
treza enclave delete enc_123456789 --force
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
  --description "Created via script" \
  --region us-west-2 \
  --provider aws-nitro-enclave
```

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

- **Documentation**: [docs.treza.xyz](https://docs.treza.xyz)
- **Issues**: [GitHub Issues](https://github.com/treza-labs/treza-cli/issues)
- **Website**: [trezalabs.com](https://trezalabs.com)

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built by <a href="https://trezalabs.com">Treza Labs</a> — Privacy infrastructure for the next era of finance.
</p>
