/**
 * ProcessUtils - Cross-platform process management utilities
 *
 * Provides reliable process existence checking across Windows, macOS, and Linux.
 */

import { spawnSync } from 'child_process';
import { createLogger } from '../utils/logger.js';
import chalk from 'chalk';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const logger = createLogger('process-utils');

export class ProcessUtils {
  private static _isWSL2: boolean | null = null;

  /**
   * Detect if running in WSL2 environment
   *
   * Detection strategy:
   * 1. Primary: Check /proc/version for "microsoft" AND "WSL2" (most reliable)
   * 2. Fallback: WSL environment variables indicate WSL1 (not supported)
   *
   * Note: WSL1 and WSL2 share the same environment variables but have different
   * kernel signatures. Only WSL2 is supported due to its Linux-compatible networking.
   */
  static isWSL2(): boolean {
    if (ProcessUtils._isWSL2 !== null) {
      return ProcessUtils._isWSL2;
    }

    try {
      // Only check on Linux platforms
      if (process.platform !== 'linux') {
        ProcessUtils._isWSL2 = false;
        return false;
      }

      // Check /proc/version for WSL2 signatures
      if (fs.existsSync('/proc/version')) {
        const versionContent = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
        const isWSL = versionContent.includes('microsoft') || versionContent.includes('wsl');
        const isWSL2 = versionContent.includes('wsl2');

        if (isWSL && isWSL2) {
          ProcessUtils._isWSL2 = true;
          logger.log(chalk.green('WSL2 environment detected'));
          return true;
        } else if (isWSL && !isWSL2) {
          // This is WSL1
          ProcessUtils._isWSL2 = false;
          logger.warn(chalk.red('WSL1 detected - WSL1 is not supported. Please upgrade to WSL2.'));
          logger.warn(chalk.yellow('Run "wsl --set-version <distro> 2" to upgrade to WSL2'));
          return false;
        }

        // Not WSL, continue to environment variable check
      }

      // Check for WSL environment variables as fallback, but be more careful
      const wslEnvVars = ['WSL_DISTRO_NAME', 'WSL_INTEROP', 'WSLENV'];
      const hasWSLEnv = wslEnvVars.some((envVar) => process.env[envVar]);

      if (hasWSLEnv) {
        // WSL environment detected, but we need to determine if it's WSL1 or WSL2
        // WSL2 should have been detected via /proc/version above
        // If we reach here with WSL env vars but no WSL2 in /proc/version, it's likely WSL1
        logger.log(chalk.yellow('WSL environment detected via environment variables'));
        logger.warn(chalk.red('Unable to confirm WSL2 - this may be WSL1 which is not supported'));
        ProcessUtils._isWSL2 = false;
        return false;
      }

      ProcessUtils._isWSL2 = false;
      return false;
    } catch (error) {
      logger.warn('Failed to detect WSL2 environment:', error);
      ProcessUtils._isWSL2 = false;
      return false;
    }
  }

  /**
   * Get the platform type including WSL2 detection
   * Returns: 'win32' | 'darwin' | 'linux' | 'wsl2'
   */
  static getPlatformType(): 'win32' | 'darwin' | 'linux' | 'wsl2' {
    if (ProcessUtils.isWSL2()) {
      return 'wsl2';
    }
    return process.platform as 'win32' | 'darwin' | 'linux';
  }
  /**
   * Check if a process is currently running by PID
   * Uses platform-appropriate methods for reliable detection
   */
  static isProcessRunning(pid: number): boolean {
    if (!pid || pid <= 0) {
      return false;
    }

    try {
      const platformType = ProcessUtils.getPlatformType();
      if (platformType === 'win32') {
        // Windows: Use tasklist command
        return ProcessUtils.isProcessRunningWindows(pid);
      } else {
        // Unix/Linux/macOS/WSL2: Use kill with signal 0
        return ProcessUtils.isProcessRunningUnix(pid);
      }
    } catch (error) {
      logger.warn(`error checking if process ${pid} is running:`, error);
      return false;
    }
  }

  /**
   * Windows-specific process check using tasklist
   */
  private static isProcessRunningWindows(pid: number): boolean {
    try {
      logger.debug(`checking windows process ${pid} with tasklist`);
      const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000, // 5 second timeout
      });

      // Check if the command succeeded and PID appears in output
      if (result.status === 0 && result.stdout) {
        // tasklist outputs CSV format with PID in quotes
        const exists = result.stdout.includes(`"${pid}"`);
        logger.debug(`process ${pid} exists: ${exists}`);
        return exists;
      }

      logger.debug(`tasklist command failed with status ${result.status}`);
      return false;
    } catch (error) {
      logger.warn(`windows process check failed for PID ${pid}:`, error);
      return false;
    }
  }

  /**
   * Unix-like systems process check using kill signal 0
   */
  private static isProcessRunningUnix(pid: number): boolean {
    try {
      // Send signal 0 to check if process exists
      // This doesn't actually kill the process, just checks existence
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // If we get ESRCH, the process doesn't exist
      // If we get EPERM, the process exists but we don't have permission
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EPERM') {
        // Process exists but we don't have permission to signal it
        return true;
      }
      // ESRCH or other errors mean process doesn't exist
      return false;
    }
  }

  /**
   * Get basic process information if available
   * Returns null if process is not running or info cannot be retrieved
   */
  static getProcessInfo(pid: number): { pid: number; exists: boolean } | null {
    if (!ProcessUtils.isProcessRunning(pid)) {
      return null;
    }

    return {
      pid,
      exists: true,
    };
  }

  /**
   * Kill a process with platform-appropriate method
   * Returns true if the kill signal was sent successfully
   */
  static killProcess(pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    if (!pid || pid <= 0) {
      return false;
    }

    logger.debug(`attempting to kill process ${pid} with signal ${signal}`);

    try {
      if (process.platform === 'win32') {
        // Windows: Use taskkill command for more reliable termination
        const result = spawnSync('taskkill', ['/PID', pid.toString(), '/F'], {
          windowsHide: true,
          timeout: 5000,
        });
        if (result.status === 0) {
          logger.log(chalk.green(`process ${pid} killed successfully`));
          return true;
        } else {
          logger.debug(`taskkill failed with status ${result.status}`);
          return false;
        }
      } else {
        // Unix-like: Use built-in process.kill
        process.kill(pid, signal);
        logger.log(chalk.green(`signal ${signal} sent to process ${pid}`));
        return true;
      }
    } catch (error) {
      logger.warn(`error killing process ${pid}:`, error);
      return false;
    }
  }

  /**
   * Wait for a process to exit with timeout
   * Returns true if process exited within timeout, false otherwise
   */
  static async waitForProcessExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    logger.debug(`waiting for process ${pid} to exit (timeout: ${timeoutMs}ms)`);

    while (Date.now() - startTime < timeoutMs) {
      if (!ProcessUtils.isProcessRunning(pid)) {
        const elapsed = Date.now() - startTime;
        logger.log(chalk.green(`process ${pid} exited after ${elapsed}ms`));
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    logger.log(chalk.yellow(`process ${pid} did not exit within ${timeoutMs}ms timeout`));
    return false;
  }

  /**
   * Check if this is an interactive shell session
   */
  private static isInteractiveShellCommand(cmdName: string, args: string[]): boolean {
    // Common shells
    const shells = ['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh'];
    const isShell = shells.some((shell) => cmdName === shell || cmdName.endsWith(`/${shell}`));

    if (!isShell) return false;

    // Check for interactive flags
    const interactiveFlags = ['-i', '--interactive', '-l', '--login'];

    // If no args, it's interactive by default
    if (args.length === 0) return true;

    // Check if any args indicate interactive mode
    return args.some((arg) => interactiveFlags.includes(arg));
  }

  /**
   * Determine how to spawn a command, checking if it exists in PATH or needs shell execution
   * Returns the actual command and args to use for spawning
   */
  static resolveCommand(command: string[]): { command: string; args: string[]; useShell: boolean } {
    if (command.length === 0) {
      throw new Error('No command provided');
    }

    const cmdName = command[0];
    const cmdArgs = command.slice(1);

    // Check if command exists in PATH using 'which' (Unix) or 'where' (Windows)
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';

    try {
      const result = spawnSync(whichCommand, [cmdName], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2000, // 2 second timeout
      });

      if (result.status === 0 && result.stdout && result.stdout.trim()) {
        // Command found in PATH
        logger.debug(`Command '${cmdName}' found at: ${result.stdout.trim()}`);
        return {
          command: cmdName,
          args: cmdArgs,
          useShell: false,
        };
      }
    } catch (error) {
      logger.debug(`Failed to check command existence for '${cmdName}':`, error);
    }

    // Command not found in PATH, likely an alias or shell builtin
    // Need to run through shell
    logger.debug(`Command '${cmdName}' not found in PATH, will use shell`);

    // Determine user's shell
    const userShell = ProcessUtils.getUserShell();

    // Check if this is trying to execute a command (not an interactive shell session)
    // If so, use non-interactive mode to ensure shell exits after execution
    const isCommand = !ProcessUtils.isInteractiveShellCommand(cmdName, cmdArgs);

    // Use interactive shell to execute the command
    // This ensures aliases and shell functions are available
    const platformType = ProcessUtils.getPlatformType();

    if (platformType === 'win32') {
      // Windows shells have different syntax
      if (userShell.includes('bash')) {
        // Git Bash on Windows: Use Unix-style syntax
        if (isCommand) {
          // Non-interactive command execution
          return {
            command: userShell,
            args: ['-c', command.join(' ')],
            useShell: true,
          };
        } else {
          // Interactive shell session
          return {
            command: userShell,
            args: ['-i', '-c', command.join(' ')],
            useShell: true,
          };
        }
      } else if (userShell.includes('pwsh') || userShell.includes('powershell')) {
        // PowerShell: Use -Command for execution
        // Note: PowerShell aliases work differently than Unix aliases
        return {
          command: userShell,
          args: ['-NoLogo', '-Command', command.join(' ')],
          useShell: true,
        };
      } else {
        // cmd.exe: Use /C to execute and exit
        // Note: cmd.exe uses 'doskey' for aliases, not traditional aliases
        return {
          command: userShell,
          args: ['/C', command.join(' ')],
          useShell: true,
        };
      }
    } else if (platformType === 'wsl2' || platformType === 'linux' || platformType === 'darwin') {
      // Unix-like shells (including WSL2): Choose execution mode based on command type
      if (isCommand) {
        // Non-interactive command execution: shell will exit after completion
        return {
          command: userShell,
          args: ['-c', command.join(' ')],
          useShell: true,
        };
      } else {
        // Interactive shell session: use -i for alias support
        return {
          command: userShell,
          args: ['-i', '-c', command.join(' ')],
          useShell: true,
        };
      }
    } else {
      // Unknown platform: fallback to basic command execution
      return {
        command: cmdName,
        args: cmdArgs,
        useShell: false,
      };
    }
  }

  /**
   * Get the user's preferred shell
   * Falls back to sensible defaults if SHELL env var is not set
   */
  static getUserShell(): string {
    // First try SHELL environment variable (most reliable on Unix-like systems)
    if (process.env.SHELL) {
      return process.env.SHELL;
    }

    // Platform-specific defaults
    const platformType = ProcessUtils.getPlatformType();

    if (platformType === 'win32') {
      // Check for modern shells first

      // 1. Check for PowerShell Core (pwsh) - cross-platform version
      try {
        const result = spawnSync('pwsh', ['-Command', 'echo test'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 1000,
        });
        if (result.status === 0) {
          return 'pwsh';
        }
      } catch (_) {
        // PowerShell Core not available
      }

      // 2. Check for Windows PowerShell (older, Windows-only)
      const powershellPath = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      );
      try {
        const result = spawnSync(powershellPath, ['-Command', 'echo test'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 1000,
        });
        if (result.status === 0) {
          return powershellPath;
        }
      } catch (_) {
        // PowerShell not available
      }

      // 3. Check for Git Bash if available
      const gitBashPaths = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      ];
      for (const gitBashPath of gitBashPaths) {
        try {
          const result = spawnSync(gitBashPath, ['-c', 'echo test'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 1000,
          });
          if (result.status === 0) {
            return gitBashPath;
          }
        } catch (_) {
          // Git Bash not at this location
        }
      }

      // 4. Fall back to cmd.exe
      return process.env.ComSpec || 'cmd.exe';
    } else if (platformType === 'wsl2' || platformType === 'linux' || platformType === 'darwin') {
      // Unix-like systems (including WSL2)
      // Node.js os.userInfo() includes shell on some platforms
      try {
        const userInfo = os.userInfo();
        if ('shell' in userInfo && userInfo.shell) {
          return userInfo.shell as string;
        }
      } catch (_) {
        // userInfo might fail in some environments
      }

      // Check common shell paths in order of preference
      // WSL2 typically has bash as the default shell
      const commonShells =
        platformType === 'wsl2'
          ? ['/bin/bash', '/bin/zsh', '/usr/bin/bash', '/usr/bin/zsh', '/bin/sh']
          : ['/bin/zsh', '/bin/bash', '/usr/bin/zsh', '/usr/bin/bash', '/bin/sh'];

      for (const shell of commonShells) {
        try {
          // Just check if the shell exists and is executable
          const result = spawnSync('test', ['-x', shell], {
            encoding: 'utf8',
            timeout: 500,
          });
          if (result.status === 0) {
            return shell;
          }
        } catch (_) {
          // test command failed, try next shell
        }
      }

      // Final fallback - /bin/sh should always exist on Unix
      return '/bin/sh';
    } else {
      // Unknown platform fallback
      return '/bin/sh';
    }
  }
}
