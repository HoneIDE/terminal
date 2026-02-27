/**
 * Cursor state for rendering.
 *
 * Tracks cursor position, style, visibility, and blink state.
 */

export interface CursorState {
  row: number;
  col: number;
  style: 'block' | 'beam' | 'underline';
  visible: boolean;
  blink: boolean;
}

/**
 * CursorBlinkController — manages cursor blink timing.
 */
export class CursorBlinkController {
  private visible: boolean = true;
  private blinkInterval: ReturnType<typeof setInterval> | null = null;
  private blinkRate: number;
  private onChange: (visible: boolean) => void;

  constructor(blinkRate: number = 530, onChange: (visible: boolean) => void = () => {}) {
    this.blinkRate = blinkRate;
    this.onChange = onChange;
  }

  /** Start the blink cycle. */
  start(): void {
    this.stop();
    this.visible = true;
    this.onChange(true);
    this.blinkInterval = setInterval(() => {
      this.visible = !this.visible;
      this.onChange(this.visible);
    }, this.blinkRate);
  }

  /** Stop blinking and show the cursor. */
  stop(): void {
    if (this.blinkInterval) {
      clearInterval(this.blinkInterval);
      this.blinkInterval = null;
    }
    this.visible = true;
    this.onChange(true);
  }

  /** Reset the blink cycle (e.g., after keyboard input). */
  reset(): void {
    if (this.blinkInterval) {
      this.start();
    }
  }

  /** Whether the cursor is currently visible in the blink cycle. */
  get isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.stop();
  }
}
