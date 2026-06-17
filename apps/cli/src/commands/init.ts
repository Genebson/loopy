import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { input, select, confirm, number } from '@inquirer/prompts';
import { GHProjectClient } from '@loopy/gh';


function checkGitDirectory(): void {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
  } catch {
    console.error(chalk.red('Error: Not inside a git repository. Run `loopy init` inside a git repo.'));
    process.exit(1);
  }
}

function checkGhAuth(): void {
  try {
    execSync('gh auth status', { stdio: 'pipe' });
  } catch {
    console.error(chalk.red('Error: gh CLI not authenticated. Run `gh auth login` first.'));
    process.exit(1);
  }
}

function getDefaultOwner(): string {
  try {
    const result = execSync('gh repo view --json owner', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const parsed: { owner: { login: string } } = JSON.parse(result);
    return parsed.owner?.login ?? '';
  } catch {
    return '';
  }
}

interface InitAnswers {
  owner: string;
  number: number;
  columns: {
    ready: string;
    inProgress: string;
    inReview: string;
    done: string;
    blocked: string;
  };
  verifierCommand: string;
  verifierTimeout: number;
  retries: number;
}

async function runWizard(yes: boolean): Promise<InitAnswers> {
  const defaultOwner = getDefaultOwner();

  const owner = yes
    ? (defaultOwner || 'OWNER')
    : await input({
        message: 'GitHub owner?',
        default: defaultOwner || undefined,
      });

  const projectNumber = yes
    ? 1
    : Number(await number({ message: 'Project number?', min: 1 }));

  if (!projectNumber || projectNumber < 1) {
    console.error(chalk.red('Error: Project number must be a positive integer. Enter a number like 1, 2, or 42.'));
    process.exit(1);
  }

  const client = new GHProjectClient();

  let project: { id: string; title: string };
  try {
    project = await client.getProject({ owner, number: projectNumber });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error fetching project: ${message}. Check your owner and project number, and verify gh auth status.`));
    process.exit(1);
  }

  console.log(chalk.green(`Found project: ${project.title}`));

  let columns: Array<{ id: string; name: string; role: string }>;
  try {
    columns = await client.getFieldOptions(project.id, 'Status');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error fetching columns: ${message}. Verify your project has a Status field with columns.`));
    process.exit(1);
  }

  const columnNames = columns.map((c) => c.name);

  if (columnNames.length === 0) {
    console.error(chalk.red('Error: No Status columns found in project. Make sure your GitHub Project has a Status field with at least one column.'));
    process.exit(1);
  }

  const guessColumn = (role: string): string => {
    const match = columns.find((c) => c.role === role);
    return match?.name ?? columnNames[0];
  };

  const makeChoices = (names: string[]) => names.map((n) => ({ name: n, value: n }));

  const ready = yes
    ? guessColumn('ready')
    : await select({
        message: 'Which column is Ready?',
        choices: makeChoices(columnNames),
        default: guessColumn('ready'),
      });

  const inProgress = yes
    ? guessColumn('inProgress')
    : await select({
        message: 'Which column is In Progress?',
        choices: makeChoices(columnNames),
        default: guessColumn('inProgress'),
      });

  const inReview = yes
    ? guessColumn('inReview')
    : await select({
        message: 'Which column is In Review?',
        choices: makeChoices(columnNames),
        default: guessColumn('inReview'),
      });

  const done = yes
    ? guessColumn('done')
    : await select({
        message: 'Which column is Done?',
        choices: makeChoices(columnNames),
        default: guessColumn('done'),
      });

  const blocked = yes
    ? guessColumn('blocked')
    : await select({
        message: 'Which column is Blocked?',
        choices: makeChoices(columnNames),
        default: guessColumn('blocked'),
      });

  const verifierCommand = yes
    ? 'pnpm test && pnpm lint'
    : await input({
        message: 'Verifier command?',
        default: 'pnpm test && pnpm lint',
      });

  const verifierTimeout = yes
    ? 600
    : Number(await number({ message: 'Verifier timeout in seconds?', default: 600, min: 1 }));

  const retries = yes
    ? 3
    : Number(await number({ message: 'Max retries?', default: 3, min: 0 }));

  return {
    owner,
    number: projectNumber,
    columns: { ready, inProgress, inReview, done, blocked },
    verifierCommand,
    verifierTimeout,
    retries,
  };
}

function generateConfigFile(answers: InitAnswers): string {
  return `import { defineConfig } from '@loopy/core';

export default defineConfig({
  project: { owner: '${answers.owner}', number: ${answers.number} },
  columns: {
    ready: '${answers.columns.ready}',
    inProgress: '${answers.columns.inProgress}',
    inReview: '${answers.columns.inReview}',
    done: '${answers.columns.done}',
    blocked: '${answers.columns.blocked}',
  },
  verifier: {
    command: '${answers.verifierCommand}',
    timeout: ${answers.verifierTimeout}000,
    build: {
      command: 'pnpm build',
      timeout: 300000,
      skipIfUnchanged: false,
    },
  },
  retries: ${answers.retries},
});
`;
}

interface CacheData {
  projectId: string;
  statusFieldId: string;
  fieldOptions: Record<string, Array<{ id: string; name: string; role: string }>>;
  updatedAt: string;
}

function writeCacheFile(cachePath: string, data: CacheData): void {
  const dir = dirname(cachePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
}

export const initCommand = new Command('init')
  .description('Initialize loopy configuration with an interactive wizard')
  .option('-y, --yes', 'Use all defaults without prompting')
  .addHelpText(
    'after',
    `
Examples:
  $ loopy init
  $ loopy init --yes`,
  )
  .action(async (options: { yes?: boolean }) => {
    const yes = options.yes ?? false;

    checkGitDirectory();
    checkGhAuth();

    const configPath = resolve('loopy.config.ts');
    if (existsSync(configPath)) {
      if (yes) {
        console.error(chalk.red('Error: loopy.config.ts already exists. Remove it or use interactive mode to confirm overwrite.'));
        process.exit(1);
      }
      const overwrite = await confirm({
        message: 'loopy.config.ts already exists. Overwrite?',
        default: false,
      });
      if (!overwrite) {
        console.log(chalk.yellow('Init cancelled.'));
        process.exit(0);
      }
    }

    const answers = await runWizard(yes);
    const configContent = generateConfigFile(answers);
    writeFileSync(configPath, configContent, 'utf-8');

    const cachePath = resolve('.loopy/cache.json');
    const client = new GHProjectClient(cachePath);
    const project = await client.getProject({ owner: answers.owner, number: answers.number });
    const columns = await client.getFieldOptions(project.id, 'Status');

    writeCacheFile(cachePath, {
      projectId: project.id,
      statusFieldId: client.statusFieldIdValue,
      fieldOptions: { Status: columns },
      updatedAt: new Date().toISOString(),
    });

    console.log(chalk.green('✅ loopy.config.ts created! Run `loopy run` to start processing cards.'));
  });