import { Command } from 'commander';
import ora from 'ora';
import prompts from 'prompts';
import chalk from 'chalk';
import { isConfigured } from '../utils/config.js';
import * as api from '../utils/api.js';
import * as output from '../utils/output.js';

export const enclaveCommand = new Command('enclave')
  .alias('enc')
  .description('Manage secure enclaves');

// Check configuration before running commands
function requireConfig(): void {
  if (!isConfigured()) {
    output.error('Not configured. Run: treza config init');
    process.exit(1);
  }
}

enclaveCommand
  .command('list')
  .alias('ls')
  .description('List all enclaves')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireConfig();
    const spinner = ora('Fetching enclaves...').start();

    try {
      const { enclaves } = await api.getEnclaves();
      spinner.stop();

      if (options.json) {
        output.json(enclaves);
        return;
      }

      if (enclaves.length === 0) {
        output.info('No enclaves found. Create one with: treza enclave create');
        return;
      }

      output.heading(`Enclaves (${enclaves.length})`);
      output.printTable(
        ['ID', 'Name', 'Status', 'Region', 'Provider', 'Created'],
        enclaves.map((e) => [
          e.id.slice(0, 16) + '...',
          e.name,
          output.statusColor(e.status),
          e.region,
          e.providerId,
          new Date(e.createdAt).toLocaleDateString(),
        ])
      );
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`API Error: ${err.message}`);
      } else {
        output.error(`Failed to fetch enclaves: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('get <id>')
  .description('Get enclave details')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireConfig();
    const spinner = ora('Fetching enclave...').start();

    try {
      const { enclave } = await api.getEnclave(id);
      spinner.stop();

      if (options.json) {
        output.json(enclave);
        return;
      }

      output.heading(enclave.name);
      output.keyValue('ID', enclave.id);
      output.keyValue('Status', output.statusColor(enclave.status));
      output.keyValue('Region', enclave.region);
      output.keyValue('Provider', enclave.providerId);
      output.keyValue('Description', enclave.description || '(none)');
      output.keyValue('Created', new Date(enclave.createdAt).toLocaleString());
      output.keyValue('Updated', new Date(enclave.updatedAt).toLocaleString());
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        if (err.statusCode === 404) {
          output.error(`Enclave not found: ${id}`);
        } else {
          output.error(`API Error: ${err.message}`);
        }
      } else {
        output.error(`Failed to fetch enclave: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('create')
  .description('Create a new enclave')
  .option('-n, --name <name>', 'Enclave name')
  .option('-d, --description <desc>', 'Enclave description')
  .option('-r, --region <region>', 'Deployment region')
  .option('-p, --provider <provider>', 'Provider ID', 'aws-nitro')
  // Source type
  .option('--source-type <type>', 'Deployment source: registry (default), github, private-registry')
  // Registry source
  .option('-i, --image <image>', 'Docker image URI (e.g. nginx:alpine, myorg/myapp:latest)')
  // GitHub source
  .option('--github-repo <owner/repo>', 'GitHub repository to build from (e.g. acme/my-api)')
  .option('--github-branch <branch>', 'Branch to build from', 'main')
  .option('--github-token <token>', 'GitHub personal access token (for private repos)')
  // Private registry source
  .option('--registry-url <url>', 'Private registry URL (e.g. ghcr.io, 123.dkr.ecr.us-east-1.amazonaws.com)')
  .option('--registry-username <user>', 'Registry username or access key ID')
  .option('--registry-password <pass>', 'Registry password or token')
  // Instance config
  .option('--instance-type <type>', 'EC2 instance type (e.g. m6i.xlarge, c6i.xlarge)', 'm6i.xlarge')
  .option('--cpu <count>', 'vCPU count to allocate to the enclave (2, 4, 8, 16)', '2')
  .option('--memory <mib>', 'Memory in MiB to allocate (1024, 2048, 4096, 8192, 16384)', '1024')
  // Workload config
  .option('-w, --workload-type <type>', 'Workload type: batch, service, or daemon', 'service')
  .option('--health-path <path>', 'Health check path for service workloads', '/health')
  .option('--health-interval <seconds>', 'Health check interval in seconds', '30')
  .option('--aws-services <services>', 'Comma-separated AWS services to proxy (e.g. kms,s3)')
  .option('--expose-ports <ports>', 'Comma-separated ports the app listens on')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireConfig();

    let { name, description, region, provider } = options;
    let sourceType: 'registry' | 'github' | 'private-registry' = options.sourceType || 'registry';

    // If a GitHub flag is provided but --source-type wasn't specified, infer it
    if (!options.sourceType && options.githubRepo) {
      sourceType = 'github';
    } else if (!options.sourceType && options.registryUrl) {
      sourceType = 'private-registry';
    }

    // Fetch providers for interactive prompts
    const spinner0 = ora('Loading providers...').start();
    let providers: api.Provider[] = [];
    try {
      const result = await api.getProviders();
      providers = result.providers;
      spinner0.stop();
    } catch {
      spinner0.stop();
      output.warn('Could not load providers, using defaults');
      providers = [{ id: 'aws-nitro', name: 'AWS Nitro', description: '', regions: ['us-east-1', 'us-west-2', 'eu-west-1'] }];
    }

    const selectedProvider = providers.find((p) => p.id === provider) || providers[0];

    // ── Prompt for basic info ──────────────────────────────────────────────
    if (!name || !region) {
      const basicResponse = await prompts([
        {
          type: name ? null : 'text',
          name: 'name',
          message: 'Enclave name',
          validate: (v: string) => (v ? true : 'Name is required'),
        },
        {
          type: description ? null : 'text',
          name: 'description',
          message: 'Description (optional)',
        },
        {
          type: region ? null : 'select',
          name: 'region',
          message: 'Region',
          choices: selectedProvider.regions.map((r) => ({ title: r, value: r })),
        },
      ]);

      name = name || basicResponse.name;
      description = description || basicResponse.description;
      region = region || basicResponse.region;

      if (!name || !region) {
        output.error('Cancelled');
        process.exit(1);
      }
    }

    // ── Prompt for source type if not provided ─────────────────────────────
    if (!options.sourceType && !options.githubRepo && !options.registryUrl) {
      const sourceResponse = await prompts({
        type: 'select',
        name: 'sourceType',
        message: 'Deployment source',
        choices: [
          { title: 'Container Registry  — Docker Hub, ECR Public, or any public image', value: 'registry' },
          { title: 'GitHub Repository   — Treza auto-builds from your repo', value: 'github' },
          { title: 'Private Registry    — Your own registry with credentials', value: 'private-registry' },
        ],
        initial: 0,
      });
      sourceType = sourceResponse.sourceType || 'registry';
    }

    // ── Prompt for source-specific details ────────────────────────────────
    let dockerImage = options.image || '';
    let githubRepo = options.githubRepo || '';
    let githubBranch = options.githubBranch || 'main';
    let githubToken = options.githubToken || '';
    let registryUrl = options.registryUrl || '';
    let registryUsername = options.registryUsername || '';
    let registryPassword = options.registryPassword || '';

    if (sourceType === 'registry' && !dockerImage) {
      const r = await prompts({
        type: 'text',
        name: 'dockerImage',
        message: 'Docker image URI (e.g. nginx:alpine)',
        validate: (v: string) => (v ? true : 'Image URI is required'),
      });
      dockerImage = r.dockerImage || '';
    }

    if (sourceType === 'github') {
      if (!githubRepo) {
        const r = await prompts([
          {
            type: 'text',
            name: 'githubRepo',
            message: 'GitHub repository (owner/repo)',
            validate: (v: string) => (v.includes('/') ? true : 'Must be owner/repo format'),
          },
          {
            type: 'text',
            name: 'githubBranch',
            message: 'Branch',
            initial: 'main',
          },
          {
            type: 'password',
            name: 'githubToken',
            message: 'GitHub token (for private repos, leave blank for public)',
          },
        ]);
        githubRepo = r.githubRepo || '';
        githubBranch = r.githubBranch || 'main';
        githubToken = r.githubToken || '';
      }
    }

    if (sourceType === 'private-registry') {
      const missingFields = !registryUrl || !dockerImage;
      if (missingFields) {
        const r = await prompts([
          { type: registryUrl ? null : 'text', name: 'registryUrl', message: 'Registry URL (e.g. ghcr.io)' },
          { type: dockerImage ? null : 'text', name: 'dockerImage', message: 'Image URI (e.g. myorg/myapp:latest)' },
          { type: registryUsername ? null : 'text', name: 'registryUsername', message: 'Username' },
          { type: registryPassword ? null : 'password', name: 'registryPassword', message: 'Password / token' },
        ]);
        registryUrl = registryUrl || r.registryUrl || '';
        dockerImage = dockerImage || r.dockerImage || '';
        registryUsername = registryUsername || r.registryUsername || '';
        registryPassword = registryPassword || r.registryPassword || '';
      }
    }

    // ── Prompt for workload config ─────────────────────────────────────────
    if (!options.workloadType) {
      const r = await prompts({
        type: 'select',
        name: 'workloadType',
        message: 'Workload type',
        choices: [
          { title: 'Batch (run-to-completion)', value: 'batch' },
          { title: 'Service (long-running HTTP server)', value: 'service' },
          { title: 'Daemon (background process)', value: 'daemon' },
        ],
      });
      if (r.workloadType) options.workloadType = r.workloadType;
    }

    // ── Build providerConfig ───────────────────────────────────────────────
    const providerConfig: Record<string, unknown> = {
      sourceType,
      instanceType: options.instanceType || 'm6i.xlarge',
      cpuCount: options.cpu || '2',
      memoryMiB: options.memory || '1024',
      workloadType: options.workloadType || 'service',
    };
    if (dockerImage) {
      providerConfig.dockerImage = dockerImage;
    }
    if (options.workloadType) {
      providerConfig.workloadType = options.workloadType;
    }
    if (options.healthPath && options.workloadType === 'service') {
      providerConfig.healthCheckPath = options.healthPath;
    }
    if (options.healthInterval) {
      providerConfig.healthCheckInterval = options.healthInterval;
    }
    if (options.awsServices) {
      providerConfig.awsServices = options.awsServices;
    }
    if (options.exposePorts) {
      providerConfig.exposePorts = options.exposePorts;
    }

    // ── Submit ─────────────────────────────────────────────────────────────
    const spinnerMsg = sourceType === 'github' ? 'Creating enclave and starting build...' : 'Creating enclave...';
    const spinner = ora(spinnerMsg).start();

    try {
      const payload: Parameters<typeof api.createEnclave>[0] = {
        name,
        description: description || '',
        region,
        providerId: selectedProvider.id,
        providerConfig,
        sourceType,
      };

      if (sourceType === 'github') {
        payload.githubConnection = {
          isConnected: true,
          username: '',
          selectedRepo: githubRepo,
          selectedBranch: githubBranch,
          ...(githubToken && { accessToken: githubToken }),
        };
      }

      if (sourceType === 'private-registry' && registryUrl) {
        payload.privateRegistry = {
          registryUrl,
          username: registryUsername,
          password: registryPassword,
        };
        payload.dockerImage = dockerImage;
      }

      const { enclave } = await api.createEnclave(payload);

      if (sourceType === 'github') {
        spinner.succeed(`Enclave created — build started (${enclave.buildId ? enclave.buildId.split(':').pop() : 'queued'})`);
      } else {
        spinner.succeed('Enclave created!');
      }

      if (options.json) {
        output.json(enclave);
        return;
      }

      console.log('');
      output.keyValue('ID', enclave.id);
      output.keyValue('Status', output.statusColor(enclave.status));
      output.keyValue('Source', sourceType);
      output.keyValue('Region', enclave.region);
      if (sourceType === 'github') {
        output.keyValue('Repo', githubRepo);
        output.keyValue('Branch', githubBranch);
        if (enclave.buildStatus) {
          output.keyValue('Build Status', enclave.buildStatus);
        }
      } else if (sourceType === 'registry') {
        output.keyValue('Image', dockerImage);
      } else if (sourceType === 'private-registry') {
        output.keyValue('Registry', registryUrl);
        output.keyValue('Image', dockerImage);
      }
      console.log('');
      console.log(chalk.gray(`View details: treza enclave get ${enclave.id}`));
      console.log(chalk.gray(`Stream logs:  treza enclave logs ${enclave.id}${sourceType === 'github' ? ' --type build' : ''}`));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        const details = (err.details as { details?: string[] })?.details;
        output.error(`Failed to create enclave: ${err.message}${details ? '\n  ' + details.join('\n  ') : ''}`);
      } else {
        output.error(`Failed to create enclave: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('pause <id>')
  .description('Pause an enclave')
  .action(async (id) => {
    requireConfig();
    const spinner = ora('Pausing enclave...').start();

    try {
      const { enclave, message } = await api.performEnclaveAction(id, 'pause');
      spinner.succeed(message || 'Enclave paused');
      output.keyValue('Status', output.statusColor(enclave.status));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to pause: ${err.message}`);
      } else {
        output.error(`Failed to pause: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('resume <id>')
  .description('Resume a paused enclave')
  .action(async (id) => {
    requireConfig();
    const spinner = ora('Resuming enclave...').start();

    try {
      const { enclave, message } = await api.performEnclaveAction(id, 'resume');
      spinner.succeed(message || 'Enclave resumed');
      output.keyValue('Status', output.statusColor(enclave.status));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to resume: ${err.message}`);
      } else {
        output.error(`Failed to resume: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('terminate <id>')
  .description('Terminate an enclave')
  .option('-f, --force', 'Skip confirmation')
  .action(async (id, options) => {
    requireConfig();

    if (!options.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to terminate enclave ${id}? This cannot be undone.`,
        initial: false,
      });

      if (!response.confirm) {
        output.info('Cancelled');
        return;
      }
    }

    const spinner = ora('Terminating enclave...').start();

    try {
      const { enclave, message } = await api.performEnclaveAction(id, 'terminate');
      spinner.succeed(message || 'Enclave terminated');
      output.keyValue('Status', output.statusColor(enclave.status));
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to terminate: ${err.message}`);
      } else {
        output.error(`Failed to terminate: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('delete <id>')
  .description('Delete a terminated enclave')
  .option('-f, --force', 'Skip confirmation')
  .action(async (id, options) => {
    requireConfig();

    if (!options.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Delete enclave ${id}? This will remove all data.`,
        initial: false,
      });

      if (!response.confirm) {
        output.info('Cancelled');
        return;
      }
    }

    const spinner = ora('Deleting enclave...').start();

    try {
      const { message } = await api.deleteEnclave(id);
      spinner.succeed(message || 'Enclave deleted');
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to delete: ${err.message}`);
      } else {
        output.error(`Failed to delete: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

enclaveCommand
  .command('logs <id>')
  .description('View enclave logs')
  .option('-t, --type <type>', 'Log type: all, ecs, application, errors, lambda, stepfunctions, build', 'all')
  .option('-n, --limit <limit>', 'Number of log entries', '50')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireConfig();
    const spinner = ora('Fetching logs...').start();

    try {
      const { logs } = await api.getEnclaveLogs(id, options.type, parseInt(options.limit));
      spinner.stop();

      if (options.json) {
        output.json(logs);
        return;
      }

      const allLogs: Array<{ timestamp: number; message: string; source: string }> = [];
      
      for (const [source, entries] of Object.entries(logs)) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            allLogs.push({
              timestamp: (entry as Record<string, unknown>).timestamp as number || Date.now(),
              message: (entry as Record<string, unknown>).message as string || '',
              source,
            });
          }
        }
      }

      if (allLogs.length === 0) {
        output.info('No logs found');
        return;
      }

      // Sort by timestamp
      allLogs.sort((a, b) => a.timestamp - b.timestamp);

      output.heading(`Logs (${allLogs.length} entries)`);
      for (const log of allLogs.slice(-parseInt(options.limit))) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const sourceColor = log.source === 'errors' ? chalk.red : chalk.cyan;
        console.log(
          chalk.gray(time) + ' ' + sourceColor(`[${log.source}]`) + ' ' + log.message
        );
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof api.ApiError) {
        output.error(`Failed to fetch logs: ${err.message}`);
      } else {
        output.error(`Failed to fetch logs: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });
