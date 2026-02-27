#!/bin/bash
# Build the Hone Terminal Perry demo app.
#
# Usage: ./examples/standalone-terminal/build.sh
#
# Steps:
#   1. Build the Rust FFI crate (release)
#   2. Compile TypeScript via Perry (produces .o file)
#   3. Link Perry object + Rust static library + Perry runtime
set -e

cd "$(dirname "$0")/../.."

echo "==> Building Rust FFI crate..."
(cd native/macos && cargo build --release 2>&1 | grep -E "Compiling hone|Finished|error")

echo "==> Compiling TypeScript via Perry..."
perry compile examples/standalone-terminal/main.ts --no-link --keep-intermediates 2>&1

echo "==> Linking..."
clang++ \
  main_ts.o \
  -L native/macos/target/release -lhone_terminal_macos \
  -L/usr/local/lib -lperry_runtime -lperry_stdlib -lperry_ui_macos \
  -framework AppKit -framework CoreFoundation -framework CoreGraphics \
  -framework CoreText -framework QuartzCore -framework Security \
  -framework SystemConfiguration -liconv -lresolv -lobjc \
  -o examples/standalone-terminal/hone-terminal-demo

rm -f main_ts.o _perry_stubs.o

SIZE=$(du -h examples/standalone-terminal/hone-terminal-demo | cut -f1)
echo "==> Built: examples/standalone-terminal/hone-terminal-demo ($SIZE)"
echo "    Run:   ./examples/standalone-terminal/hone-terminal-demo"
