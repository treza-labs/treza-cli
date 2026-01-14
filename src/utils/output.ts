import chalk from 'chalk';
import { table, getBorderCharacters } from 'table';

export function success(message: string): void {
  console.log(chalk.green('✓') + ' ' + message);
}

export function error(message: string): void {
  console.log(chalk.red('✗') + ' ' + chalk.red(message));
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠') + ' ' + chalk.yellow(message));
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ') + ' ' + message);
}

export function heading(text: string): void {
  console.log('\n' + chalk.bold.white(text));
  console.log(chalk.gray('─'.repeat(text.length)));
}

export function keyValue(key: string, value: string | number | boolean): void {
  console.log(chalk.gray(`  ${key}:`), chalk.white(String(value)));
}

export function printTable(
  headers: string[],
  rows: (string | number)[][],
  options: { truncate?: number } = {}
): void {
  const truncate = options.truncate || 40;

  const truncateStr = (str: string): string => {
    if (str.length > truncate) {
      return str.slice(0, truncate - 3) + '...';
    }
    return str;
  };

  const formattedHeaders = headers.map((h) => chalk.bold.cyan(h));
  const formattedRows = rows.map((row) =>
    row.map((cell) => truncateStr(String(cell)))
  );

  const output = table([formattedHeaders, ...formattedRows], {
    border: getBorderCharacters('norc'),
    columnDefault: {
      paddingLeft: 1,
      paddingRight: 1,
    },
    drawHorizontalLine: (index, size) => index === 0 || index === 1 || index === size,
  });

  console.log(output);
}

export function statusColor(status: string): string {
  const statusLower = status.toLowerCase();
  
  if (statusLower.includes('deploy') && !statusLower.includes('pending')) {
    return chalk.green(status);
  }
  if (statusLower.includes('running') || statusLower === 'active') {
    return chalk.green(status);
  }
  if (statusLower.includes('pending') || statusLower.includes('ing')) {
    return chalk.yellow(status);
  }
  if (statusLower.includes('fail') || statusLower.includes('error') || statusLower.includes('destroy')) {
    return chalk.red(status);
  }
  if (statusLower.includes('pause') || statusLower === 'stopped') {
    return chalk.gray(status);
  }
  
  return chalk.white(status);
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
