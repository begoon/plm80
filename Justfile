default:
    @just --list

ci:
    bun install --frozen-lockfile
    bun run typecheck
    bun test

# Compile examples/rk-demo.plm and run it under the rk86 emulator
demo:
    mkdir -p build
    bun run src/cli.ts examples/rk-demo.plm --org 0 --stack 76CFh -o build/demo.asm
    bunx asm8080 build/demo.asm -o build
    bunx rk86 --exit-halt build/demo.bin

# Compile, assemble, and run examples/<NAME>.plm under rk86
run NAME:
    mkdir -p build
    bun run src/cli.ts examples/{{NAME}}.plm --org 0 --stack 76CFh -o build/{{NAME}}.asm
    bunx asm8080 build/{{NAME}}.asm -o build
    bunx rk86 --exit-halt build/{{NAME}}.bin

# Bump patch version and publish to npm (prepublishOnly runs typecheck + test + build)
publish: ci
    npm version patch --no-git-tag-version
    npm publish
