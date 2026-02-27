/**
 * WinConPTY — Windows ConPTY implementation.
 *
 * Uses Perry's Windows-specific child_process with ConPTY support.
 * Requires Windows 10 1809+.
 */

import { type PTY, type PTYOptions, PTYManager } from './pty-manager';
import * as child_process from 'child_process';

export class WinConPTY implements PTY {
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
    };

    this.process = child_process.spawn(shell, options.args ?? [], {
      cwd: options.cwd ?? process.env.USERPROFILE,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // @ts-expect-error — Perry extends spawn options with ConPTY support
      conpty: true,
      rows: options.rows ?? 24,
      cols: options.cols ?? 80,
    });

    this._pid = this.process.pid ?? 0;

    this.process.stdout?.on('data', (data: Buffer | Uint8Array) => {
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
    // @ts-expect-error — Perry extends ChildProcess with resize
    if (typeof this.process.resize === 'function') {
      // @ts-expect-error
      this.process.resize(rows, cols);
    }
  }

  kill(signal: string = 'SIGTERM'): void {
    this.process.kill(signal as NodeJS.Signals);
  }

  onData(handler: (data: Uint8Array) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (code: number, signal?: string) => void): void {
    this.exitHandlers.push(handler);
  }
}
