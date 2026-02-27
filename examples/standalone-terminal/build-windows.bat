@echo off
REM Build the Hone Terminal Perry demo app for Windows.
REM
REM Usage: examples\standalone-terminal\build-windows.bat
REM
REM Steps:
REM   1. Build the Rust FFI crate (release)
REM   2. Compile TypeScript via Perry (produces .obj file)
REM   3. Link Perry object + Rust static library + Perry runtime + system libs
setlocal enabledelayedexpansion

cd /d "%~dp0\..\.."

echo ==^> Building Rust FFI crate...
pushd native\windows
cargo build --release
if errorlevel 1 (
    echo ERROR: Rust build failed
    exit /b 1
)
popd

echo ==^> Compiling TypeScript via Perry...
perry compile examples\standalone-terminal\main.ts --no-link --keep-intermediates
if errorlevel 1 (
    echo ERROR: Perry compile failed
    exit /b 1
)

echo ==^> Linking...
link.exe ^
    main_ts.obj ^
    /LIBPATH:native\windows\target\release hone_terminal_windows.lib ^
    /LIBPATH:"%PERRY_LIB_DIR%" perry_runtime.lib perry_stdlib.lib perry_ui_windows.lib ^
    d2d1.lib dwrite.lib user32.lib gdi32.lib ole32.lib shell32.lib advapi32.lib ^
    /OUT:examples\standalone-terminal\hone-terminal-demo.exe
if errorlevel 1 (
    echo ERROR: Linking failed
    exit /b 1
)

del /q main_ts.obj _perry_stubs.obj 2>nul

echo ==^> Built: examples\standalone-terminal\hone-terminal-demo.exe
echo     Run:   examples\standalone-terminal\hone-terminal-demo.exe
