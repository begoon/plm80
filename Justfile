default:
    @just --list

# Run the full test suite: install deps, typecheck, tests (including rk86 e2e)
ci:
    bun install --frozen-lockfile
    bun run typecheck
    bun test

# Compile examples/demo-rk.plm and run it under the rk86 emulator
demo:
    mkdir -p build
    bun run src/cli.ts examples/demo-rk.plm --org 0 --stack 76CFh -o build/demo.asm
    bunx asm8080 build/demo.asm -o build
    bunx rk86 --exit-halt build/demo.bin
