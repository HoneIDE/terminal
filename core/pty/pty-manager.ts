/**
 * PTYManager — platform-agnostic PTY abstraction.
 *
 * Detects the current platform and spawns a PTY accordingly.
 */

export interface PTY {
  readonly pid: number;
  write(data: string | Uint8Array): void;
  resize(rows: number, cols: number): void;
  kill(signal?: string): void;
  onData(handler: (data: Uint8Array) => void): void;
  onExit(handler: (code: number, signal?: string) => void): void;
}

export interface PTYOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  rows?: number;
  cols?: number;
}

export class PTYManager {
  /**
   * Detect the current platform and spawn a PTY accordingly.
   * Uses dynamic import to load platform-specific implementation.
   */
  static spawn(options: PTYOptions): PTY {
    const platform = typeof process !== 'undefined' ? process.platform : 'web';

    switch (platform) {
      case 'win32':
        // Use ConPTY on Windows
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { WinConPTY } = require('./win-conpty');
        return new WinConPTY(options);
      case 'darwin':
      case 'linux':
      case 'freebsd':
      case 'openbsd':
        // Use forkpty on Unix
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { UnixPTY } = require('./unix-pty');
        return new UnixPTY(options);
      default:
        throw new Error(
          `PTY not supported on platform: ${platform}. ` +
          `Use a remote PTY connection instead.`
        );
    }
  }

  /** Detect the default shell for the current platform. */
  static detectDefaultShell(): string {
    if (typeof process === 'undefined') {
      throw new Error('No process object — cannot detect shell');
    }

    const platform = process.platform;

    switch (platform) {
      case 'win32':
        // Prefer PowerShell, fallback to cmd.exe
        return process.env.COMSPEC || 'cmd.exe';
      case 'darwin':
      case 'linux':
      case 'freebsd':
      case 'openbsd':
        return process.env.SHELL || '/bin/sh';
      case 'android' as string:
        return '/system/bin/sh';
      default:
        return '/bin/sh';
    }
  }
}
