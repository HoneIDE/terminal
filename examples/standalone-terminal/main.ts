/**
 * Hone Terminal — Perry Demo App
 *
 * A Perry app that showcases the terminal component with native
 * rendering via Core Text + Core Graphics (macOS). Click "Show Terminal"
 * to open a native terminal rendering window with sample content.
 *
 * Build:
 *   perry compile examples/standalone-terminal/main.ts --no-link --keep-intermediates
 *   # Then link with: clang++ main_ts.o -L native/macos/target/release -lhone_terminal_macos ...
 *
 * Run:
 *   ./examples/standalone-terminal/hone-terminal-demo
 */

import { App, VStack, HStack, Text, Button, Spacer, Divider } from 'perry/ui';

// FFI function resolved by Perry codegen from the perry.nativeLibrary manifest
declare function hone_terminal_show_demo(): void;

let shown = false;

App({
  title: 'Hone Terminal',
  width: 360,
  height: 300,
  body: VStack(8, [
    HStack(12, [
      Text('Hone Terminal'),
      Spacer(),
    ]),

    Divider(),

    Text('Cross-platform terminal emulator component'),
    Text('Core Text + Core Graphics (macOS)'),
    Text('VT100/xterm, 256-color, truecolor, SGR'),
    Text('14-state VT parser, ScreenBuffer + Scrollback'),

    Divider(),

    Button('Show Terminal', function(): void {
      if (!shown) {
        shown = true;
        hone_terminal_show_demo();
      }
    }),
  ]),
});
