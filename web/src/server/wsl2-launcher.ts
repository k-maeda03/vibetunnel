#!/usr/bin/env node

/**
 * WSL2 Launcher for VibeTunnel
 *
 * A simple command-line launcher for WSL2 environments that replaces
 * the macOS menu bar app functionality for starting/stopping VibeTunnel server.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { ProcessUtils } from './pty/process-utils.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('wsl2-launcher');

interface LauncherConfig {
  port?: number;
  bind?: string;
  username?: string;
  password?: string;
  noAuth?: boolean;
  background?: boolean;
  pidFile?: string;
  logFile?: string;
  stopSignal?: boolean;
  status?: boolean;
}

class WSL2Launcher {
  private pidFile: string;
  private logFile: string;

  constructor() {
    const configDir = path.join(os.homedir(), '.vibetunnel');
    this.pidFile = path.join(configDir, 'server.pid');
    this.logFile = path.join(configDir, 'server.log');

    // Ensure config directory exists with proper permissions
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Parse command line arguments
   */
  private parseArgs(): LauncherConfig {
    const args = process.argv.slice(2);
    const config: LauncherConfig = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case '--port': {
          if (i + 1 >= args.length) {
            logger.error('--port requires a value');
            process.exit(1);
          }
          const port = parseInt(args[++i], 10);
          if (isNaN(port) || port < 1 || port > 65535) {
            logger.error('Port must be a number between 1 and 65535');
            process.exit(1);
          }
          config.port = port;
          break;
        }
        case '--bind':
          if (i + 1 >= args.length) {
            logger.error('--bind requires a value');
            process.exit(1);
          }
          config.bind = args[++i];
          break;
        case '--username':
          if (i + 1 >= args.length) {
            logger.error('--username requires a value');
            process.exit(1);
          }
          config.username = args[++i];
          break;
        case '--password':
          if (i + 1 >= args.length) {
            logger.error('--password requires a value');
            process.exit(1);
          }
          config.password = args[++i];
          break;
        case '--no-auth':
          config.noAuth = true;
          break;
        case '--background':
        case '-d':
          config.background = true;
          break;
        case '--stop':
          config.stopSignal = true;
          break;
        case '--status':
          config.status = true;
          break;
        case '--help':
        case '-h':
          this.showHelp();
          process.exit(0);
          break;
        default:
          if (arg.startsWith('--')) {
            logger.error(`Unknown option: ${arg}`);
            this.showHelp();
            process.exit(1);
          }
      }
    }

    // Validate configuration
    if (config.username && !config.password) {
      logger.error('Username specified but no password provided. Use --password or --no-auth');
      process.exit(1);
    }

    if (config.password && !config.username) {
      logger.error('Password specified but no username provided. Use --username');
      process.exit(1);
    }

    return config;
  }

  /**
   * Show help message
   */
  private showHelp(): void {
    console.log(`
${chalk.bold('VibeTunnel WSL2 Launcher')}

${chalk.yellow('Usage:')}
  vibetunnel-wsl2 [options]

${chalk.yellow('Options:')}
  --port <number>       Server port (default: 4020)
  --bind <address>      Bind address (default: auto-detected for WSL2)
  --username <user>     Authentication username
  --password <pass>     Authentication password
  --no-auth             Disable authentication
  --background, -d      Run server in background
  --stop               Stop running server
  --status             Show server status
  --help, -h           Show this help

${chalk.yellow('Examples:')}
  ${chalk.gray('# Start server in foreground')}
  vibetunnel-wsl2

  ${chalk.gray('# Start server in background with auth')}
  vibetunnel-wsl2 --background --username admin --password secret

  ${chalk.gray('# Start server without authentication')}
  vibetunnel-wsl2 --no-auth

  ${chalk.gray('# Check server status')}
  vibetunnel-wsl2 --status

  ${chalk.gray('# Stop running server')}
  vibetunnel-wsl2 --stop

${chalk.yellow('WSL2 Access:')}
  Once started, access VibeTunnel from Windows browser at:
  ${chalk.cyan('http://localhost:4020')} (or your specified port)
`);
  }

  /**
   * Check if server is running
   */
  private isServerRunning(): { running: boolean; pid?: number } {
    if (!fs.existsSync(this.pidFile)) {
      return { running: false };
    }

    try {
      const pidStr = fs.readFileSync(this.pidFile, 'utf8').trim();
      const pid = parseInt(pidStr, 10);

      if (ProcessUtils.isProcessRunning(pid)) {
        return { running: true, pid };
      } else {
        // PID file exists but process is not running, clean up
        fs.unlinkSync(this.pidFile);
        return { running: false };
      }
    } catch (error) {
      logger.debug('Error checking server status:', error);
      return { running: false };
    }
  }

  /**
   * Show server status
   */
  private showStatus(): void {
    const status = this.isServerRunning();

    if (status.running) {
      console.log(chalk.green('✓ VibeTunnel server is running'));
      console.log(chalk.gray(`  PID: ${status.pid}`));
      console.log(chalk.gray(`  Log: ${this.logFile}`));
      console.log(chalk.cyan('  Access: http://localhost:4020'));
    } else {
      console.log(chalk.red('✗ VibeTunnel server is not running'));
    }
  }

  /**
   * Stop the server
   */
  private async stopServer(): Promise<void> {
    const status = this.isServerRunning();

    if (!status.running) {
      console.log(chalk.yellow('Server is not running'));
      return;
    }

    try {
      console.log(chalk.yellow(`Stopping server (PID: ${status.pid})...`));
      if (status.pid) {
        process.kill(status.pid, 'SIGTERM');

        // Wait for graceful shutdown with timeout
        const gracefulShutdown = await this.waitForProcessExit(status.pid, 5000);

        if (!gracefulShutdown) {
          console.log(chalk.red('Server did not stop gracefully, forcing termination...'));
          try {
            process.kill(status.pid, 'SIGKILL');
            await this.waitForProcessExit(status.pid, 2000);
          } catch (killError) {
            logger.warn('Error during force kill:', killError);
          }
        }
      }

      // Clean up PID file
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }

      console.log(chalk.green('✓ Server stopped'));
    } catch (error) {
      logger.error('Error stopping server:', error);
      process.exit(1);
    }
  }

  /**
   * Wait for a process to exit with timeout
   */
  private async waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    while (Date.now() - startTime < timeoutMs) {
      if (!ProcessUtils.isProcessRunning(pid)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Start the server
   */
  private startServer(config: LauncherConfig): void {
    // Check if server is already running
    const status = this.isServerRunning();
    if (status.running) {
      console.log(chalk.yellow(`Server is already running (PID: ${status.pid})`));
      console.log(chalk.cyan('Access: http://localhost:4020'));
      return;
    }

    // Verify WSL2 environment
    if (!ProcessUtils.isWSL2()) {
      console.log(chalk.red('Error: This launcher is designed for WSL2 environments'));
      console.log(chalk.yellow('Current platform:'), ProcessUtils.getPlatformType());
      process.exit(1);
    }

    // Build server command
    const serverPath = path.resolve(__dirname, 'cli.js');
    const args: string[] = [];

    if (config.port) args.push('--port', config.port.toString());
    if (config.bind) args.push('--bind', config.bind);
    if (config.username) args.push('--username', config.username);
    if (config.password) args.push('--password', config.password);
    if (config.noAuth) args.push('--no-auth');

    console.log(chalk.blue('Starting VibeTunnel server for WSL2...'));

    if (config.background) {
      // Start in background
      const serverProcess = spawn('npx', ['tsx', serverPath, ...args], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Write PID file with secure permissions
      if (serverProcess.pid) {
        fs.writeFileSync(this.pidFile, serverProcess.pid.toString(), { mode: 0o600 });
      }

      // Set up log file with secure permissions
      const logStream = fs.createWriteStream(this.logFile, { flags: 'a', mode: 0o600 });
      serverProcess.stdout?.pipe(logStream);
      serverProcess.stderr?.pipe(logStream);

      serverProcess.unref();

      console.log(chalk.green('✓ Server started in background'));
      console.log(chalk.gray(`  PID: ${serverProcess.pid}`));
      console.log(chalk.gray(`  Log: ${this.logFile}`));
      console.log(chalk.cyan('  Access: http://localhost:4020'));
    } else {
      // Start in foreground
      const serverProcess = spawn('npx', ['tsx', serverPath, ...args], {
        stdio: 'inherit',
      });

      // Write PID file with secure permissions
      if (serverProcess.pid) {
        fs.writeFileSync(this.pidFile, serverProcess.pid.toString(), { mode: 0o600 });
      }

      // Clean up on exit
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nStopping server...'));
        serverProcess.kill('SIGTERM');
        if (fs.existsSync(this.pidFile)) {
          fs.unlinkSync(this.pidFile);
        }
        process.exit(0);
      });

      serverProcess.on('exit', (code) => {
        if (fs.existsSync(this.pidFile)) {
          fs.unlinkSync(this.pidFile);
        }
        process.exit(code || 0);
      });
    }
  }

  /**
   * Main entry point
   */
  public async run(): Promise<void> {
    const config = this.parseArgs();

    if (config.status) {
      this.showStatus();
      return;
    }

    if (config.stopSignal) {
      await this.stopServer();
      return;
    }

    this.startServer(config);
  }
}

// Run launcher if called directly
if (require.main === module) {
  const launcher = new WSL2Launcher();
  launcher.run();
}

export { WSL2Launcher };
