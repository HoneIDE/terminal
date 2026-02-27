/**
 * Perry config for the standalone terminal example.
 */
export default {
  name: 'hone-terminal-standalone-example',
  entry: 'main.ts',
  perry: '0.2.162',
  targets: {
    macos: {
      ffi: '../../native/macos/',
    },
    windows: {
      ffi: '../../native/windows/',
    },
  },
  dev: {
    defaultTarget: 'macos',
    hotReload: true,
  },
};
