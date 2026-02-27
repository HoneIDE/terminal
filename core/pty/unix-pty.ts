/**
 * UnixPTY — Unix forkpty implementation.
 *
 * Uses Perry's native child_process module with PTY support
 * for macOS, Linux, and iOS.
 */

import { type PTY, type PTYOptions, PTYManager } from './pty-manager';
import * as child_process from 'child_process';

export class UnixPTY implements PTY {
  private process: child_process.ChildProcess;
  private _pid: number;
  private dataHandlers: ((data: Uint8Array) => void)[] = [];
  private exitHandlers: ((code: number, signal?: string) => void)[] = [];

  constructor(options: PTYOptions) {
    const shell = options.shell ?? PTYManager.detectDefaultShell();
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'hone',
    };

    this.process = child_process.spawn(shell, options.args ?? [], {
      cwd: options.cwd ?? process.env.HOME,
      env,
      // Perry-specific: enable PTY mode
      stdio: ['pipe', 'pipe', 'pipe'],
      // @ts-expect-error — Perry extends spawn options with PTY support
      pty: true,
      rows: options.rows ?? 24,
      cols: options.cols ?? 80,
    });

    this._pid = this.process.pid ?? 0;

    // Wire up data events
    this.process.stdout?.on('data', (data: Buffer | Uint8Array) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      for (const handler of this.dataHandlers) {
        handler(bytes);
      }
    });

    this.process.stderr?.on('data', (data: Buffer | Uint8Array) => {
      // PTY stderr is usually merged with stdout, but handle it just in case
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      for (const handler of this.dataHandlers) {
        handler(bytes);
      }
    });

    this.process.on('exit', (code: number | null, signal: string | null) => {
      for (const handler of this.exitHandlers) {
        handler(code ?? 0, signal ?? undefined);
      }
    });
  }

  get pid(): number {
    return this._pid;
  }

  write(data: string | Uint8Array): void {
    if (typeof data === 'string') {
      this.process.stdin?.write(data);
    } else {
      this.process.stdin?.write(Buffer.from(data));
    }
  }

  resize(rows: number, cols: number): void {
    // Perry sends SIGWINCH and updates the PTY window size
    // @ts-expect-error — Perry extends ChildProcess with resize
    if (typeof this.process.resize === 'function') {
      // @ts-expect-error
      this.process.resize(rows, cols);
    }
  }

  kill(signal: string = 'SIGHUP'): void {
    this.process.kill(signal as NodeJS.Signals);
  }

  onData(handler: (data: Uint8Array) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (code: number, signal?: string) => void): void {
    this.exitHandlers.push(handler);
  }
}
