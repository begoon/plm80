# Notes for Claude sessions

Operational context for future Claude sessions working on this repo. For the public-facing project overview, see `README.md`.

## Shape of the project

- TypeScript + Bun. No framework, no bundler. Entry: `src/cli.ts`.
- Single-pass tree-walking compiler: source → tokens → AST → resolution side-table → 8080 asm (asm8 dialect).
- Strict TS: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Expect to add `!` assertions or conditional spreads rather than loosening tsconfig.

## Commands

```bash
just ci       # bun install --frozen-lockfile, typecheck, full tests
just demo     # compile + assemble + run examples/demo-rk.plm under rk86
bun test      # just the test suite
bun run typecheck
bun run src/cli.ts examples/foo.plm --org 0 --stack 76CFh -o out.asm
```

`rk86` and `asm8080` are both devDeps. CI runs on Ubuntu via `.github/workflows/ci.yml`.

## Pipeline

| File | Role |
| --- | --- |
| `src/token.ts` | Token kinds, keyword list, source positions. |
| `src/lexer.ts` | `tokenize(source) -> Token[]`. Keywords (case-insensitive), identifiers, numeric literals with radix suffixes (`H` `B` `O` `Q` `D`), single-quoted strings with `''` escape, block comments `/* ... */`, compound punctuation (`:=` `<>` `<=` `>=`). |
| `src/ast.ts` | Discriminated-union AST types. Top level is a `Program` of `Item = Decl \| Proc \| Stmt`. |
| `src/parser.ts` | Recursive-descent parser. `parse(tokens) -> Program`. Throws `ParseError` with source position. |
| `src/sema.ts` | Two-pass analyzer: hoist decls/procs/labels, then walk statements and type expressions. Produces `Resolution { global, scopeOf, symOf, typeOf, sigOf }` via maps — **does not rewrite the AST**. Throws `SemaError`. |
| `src/codegen.ts` | Tree-walking emitter → asm8 text. Consults `Resolution` for symbol kinds and label names. Throws `CodegenError` for unsupported constructs (always with a position and a hint). |
| `src/cli.ts` | Argument parsing; chooses which stage to run (`--tokens`, `--ast`, `--check`, otherwise full compile). |

## ABI (static-slot + REGS)

Two conventions live side by side. Details are in `docs/calling-convention.md`.

- **Default (internal + plain `AT`)**: arguments written to static slots named `<proc>_<param>` (lowercased), result in `A` (byte) or `HL` (word/address), all registers clobbered by callee. Safe because expression codegen always spills live intermediates via `push psw`/`push h` before emitting another `call`.
- **`REGS(...)`** attribute on `AT` procedures: each param is moved into a named register (`A B C D E H L` for byte, `HL DE BC` for word/address) instead of a static slot. Return convention unchanged.

Sema enforces register width matches param type; `REGS` without `AT` is a parse error; param count must equal regs count.

## v0 subset

**Supported:** `DECLARE` (scalar + `(n)` arrays for BYTE/WORD/ADDRESS, `INITIAL` with numbers or strings for byte arrays, multi-name `DECLARE (A, B, ...) TYPE;`, `AT (addr)`), `PROCEDURE`/`END` (with params, return type, `AT`, `REGS`, and body `DECLARE`s for param types), assignment (single + multi-target, scalar + indexed LHS), `IF/THEN/ELSE`, `DO...END`, `DO WHILE`, `CALL` with args, `RETURN` with value, labels + `GO TO` / `GOTO`, `.` address-of.

Expressions: `+ - * / MOD AND OR XOR NOT`, comparisons `= <> < > <= >=`, unary `-` and `+`.

**Codegen gaps raising `CodegenError`:** string expressions (except as INITIAL values for byte arrays).

`*` `/` `MOD` are supported for both BYTE and WORD via runtime helpers in `src/runtime.ts` (`rt_mul8`, `rt_div8`, `rt_mod8`, `rt_mul16`, `rt_div16`, `rt_mod16`). The codegen tracks which helpers are referenced and appends only those to the output, after the user procs and before the data section. Helpers follow the same ABI as user procs: byte ops take A=lhs, B=rhs and return result in A; word ops take HL=lhs, DE=rhs and return result in HL.

**Rejected outright (for v0):** nested procedures, `REENTRANT`, `INTERRUPT`, `LITERALLY`, `BASED`, `STRUCTURE`, `DO CASE`, `DO I = a TO b`, passing a whole array as a value (must use `.NAME` for address-of), multi-register structured returns like monitor's `inpblock`.

Adding a feature typically touches: lexer (if a new keyword), `ast.ts` (if a new node shape), parser, sema (resolution/typing), codegen (emission), and a test per stage.

## asm8 output conventions

See `docs/asm8-notes.md` for the full syntax reference. Conventions to maintain:

- Lowercase mnemonics and symbols (matches `target/monitor.asm` style in asm8's repo).
- 4-space indent for instructions; labels at column 0 with trailing colon.
- One statement per line (avoid asm8's ` / ` multi-stmt syntax — keeps diffs readable).
- Hex literals must start with a digit: use the `hex8` / `hex16` helpers in `codegen.ts` (they leading-zero-pad when the first nibble is `A-F`).
- `LOW(x)` / `HIGH(x)` map 1:1 to PL/M `LOW` / `HIGH` and can be emitted as expressions rather than pre-folded.

## rk86 workflow specifics

Captured in memory (`reference_rk86_emulator`). Key points:

- `bunx rk86` loads `mon32.bin` into `F800-FFFF` and **runs the monitor from F800 for 500 ms** (initializing CRTC, DMA, monitor work area at 7600+, stack). Then it jumps the CPU to the loaded program's entry. Our prog therefore does **not** need to init video or cursor — only to set `SP` (`--stack 76CFh`).
- `bunx rk86 --exit-halt prog.bin` exits cleanly on `HLT`.
- rk86 bundles an older asm8080 fork that does NOT know `ds`. Always go through our newer `asm8080` devDep to produce `.bin`, then hand the `.bin` to rk86 — don't pass `.asm` directly. The `just demo` recipe does this.
- rk86's stdout is ANSI + cp1251 frame drawing. To extract text programmatically, strip `\x1b\[[0-9;?]*[A-Za-z]` and `[\x80-\xff]` and then `grep` for known strings. **Never `tail -N` the raw output** — the frame always wins and hides the text rows. `test/e2e.test.ts` has a working extractor.

## Tests

73 tests across 5 files:

- `test/lexer.test.ts` — tokens, radix numbers, strings, comments, compound punct.
- `test/parser.test.ts` — grammar coverage including error positions.
- `test/sema.test.ts` — resolution, typing, arity, scope, call-vs-index.
- `test/codegen.test.ts` — string-match on emitted asm + assembly round-trip via `asm8080`.
- `test/e2e.test.ts` — compile → assemble → run under rk86 → grep stdout for expected output. ~1.5s per case.

When changing codegen, expect to update codegen.test.ts golden patterns. When changing parser, most sema and codegen tests should still pass unchanged — if they don't, something unintended changed.

## Risky operations to watch

- Recursion in PL/M source: sema allows it, codegen silently miscompiles because params/locals are static slots. A self-call overwrites its own frame. Fix when `REENTRANT` lands; until then trust the programmer not to recurse.
- Monitor work cells (7600+) are shared with the ROM BIOS. Declaring overlapping `AT` variables is allowed but the user can clobber the monitor mid-call.
- Top-of-stack at `76CFh` is just below video memory (`76D0h`). Deeper stacks eat into the monitor's own variables around `7640..76CE`. If you hit weird display issues, check stack depth.

## Memory pointers

Saved project memories to consult:

- `project_plm80_stack` — tech stack
- `project_regs_and_bios` — REGS convention + Radio-86RK BIOS bindings
- `reference_rk86_emulator` — emulator boot behavior and output-extraction gotchas
