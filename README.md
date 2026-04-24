# PL/M-80

A compiler for a useful subset of **PL/M-80** targeting the bare **Intel 8080**. Written in TypeScript on the Bun runtime, emits assembly in the dialect accepted by [asm8](https://github.com/begoon/asm8), and is verified end-to-end against the [Radio-86RK](https://github.com/begoon/rk86-monitor) monitor ROM.

---

## What is PL/M-80

PL/M-80 is the systems language Intel published in 1973 for the 8080. It was used for CP/M, ISIS-II, and most early Intel firmware. It is block-structured, statically typed (`BYTE`, `WORD`, `ADDRESS`), and maps closely onto the 8080 architecture. This project implements a working compiler for the useful core of that language — enough to write practical bare-metal programs for the 8080, including code that calls into a ROM monitor via its jump table.

See [`info/plm80-refs.md`](info/plm80-refs.md) for the Intel manuals we follow (bitsavers order numbers 9800268 and 9800300).

---

## Status

- Lexer, recursive-descent parser, semantic analyzer, codegen: **working for the v0 subset**.
- 73 passing tests (lexer, parser, sema, codegen, and live end-to-end runs under the rk86 emulator).
- CI on every push/PR via GitHub Actions.
- Two example programs assemble to valid 8080 binaries and run under the real monitor ROM.

### Language features supported

| Area | Supported |
| --- | --- |
| Types | `BYTE`, `WORD`, `ADDRESS`, fixed-size `(n)` arrays of any scalar |
| Declarations | `DECLARE name TYPE`, multi-name `DECLARE (a, b, c) TYPE`, `INITIAL(...)` with numeric or string values (strings only in byte arrays), `AT (addr)` for absolute placement |
| Procedures | `NAME: PROCEDURE (params) [type] [REGS(regs)] [AT (addr)]; ... END NAME;`, params typed via body `DECLARE`s |
| Statements | assignment (single + multi-target), indexed assignment, `IF/THEN/ELSE`, `DO ... END`, `DO WHILE cond`, `DO I = a TO b [BY s]`, `DO CASE expr`, `CALL name(args)`, `RETURN [value]`, labels + `GO TO` / `GOTO` |
| Expressions | `+ - * / MOD AND OR XOR NOT`, comparisons `= <> < > <= >=`, unary `+` `-`, `(` `)` grouping, `.NAME` address-of, array indexing, procedure calls, `LOW` / `HIGH`, `SHR` / `SHL` / `ROR` / `ROL` |
| Macros | `DECLARE NAME LITERALLY 'replacement';` — textual token-level substitution |

### Not yet implemented

These either raise a `CodegenError` with a clear message, or are rejected at parse/sema:

- Nested procedures, `REENTRANT`, `INTERRUPT n`.
- `BASED` pointers, `STRUCTURE`.
- Whole-array arguments (must pass an address via `.NAME`).
- Multi-register structured returns (e.g. monitor's `inpblock` which returns `HL` + `DE` + `BC`).
- Built-ins: `DEC`, `MOV`, `MOVE`, `LENGTH`, `LAST`, `SIZE`, `TIME`.

---

## Quick start

### Install from npm

```bash
npm install -g plm80                   # or: bun add -g plm80
plm80 foo.plm --org 0 --stack 76CFh -o foo.asm
```

Or run ad-hoc without installing:

```bash
npx plm80 foo.plm --org 0 --stack 76CFh -o foo.asm   # or bunx plm80 ...
```

### Hack on the compiler

Requirements: [Bun](https://bun.sh), [just](https://github.com/casey/just).

```bash
git clone <this-repo>
cd plm-80
just ci          # installs deps, typechecks, runs full test suite (including rk86 e2e)
just demo        # compiles docs/examples/greeting.plm and runs it under the Radio-86RK emulator
```

### Compile a single source file

```bash
plm80 path/to/foo.plm --org 0 --stack 76CFh -o foo.asm
bunx asm8080 foo.asm -o .              # -> foo.bin, foo.lst, foo.sym, foo.map
bunx rk86 --exit-halt foo.bin          # run on a Radio-86RK emulator
```

### Compiler flags

| Flag | Purpose |
| --- | --- |
| `-o <path>` | Output `.asm` path (default: input name with `.plm` replaced by `.asm`). |
| `--org <hex>` | `org` address for the code section. Default `0100h`. Pass `0` for Radio-86RK. |
| `--stack <hex>` | Emit `lxi sp, <hex>` as the first instruction. For rk86 pass `76CFh` (just below video memory). |
| `--tokens` | Dump the token stream and exit. |
| `--ast` | Dump the AST as JSON and exit. |
| `--check` | Parse + analyze only; exit 0 if clean, non-zero on error. Useful for editor linting. |

Errors look like `docs/examples/foo.plm:12:3: undefined identifier 'BAR'` — file path, line, column, message.

---

## Examples

Each program in `docs/examples/` is a complete source you can build and run, and every one of them is also available in the [browser playground](#playground).

| File | Demonstrates |
| --- | --- |
| [`docs/examples/counter.plm`](docs/examples/counter.plm) | `DO WHILE` loop, byte arithmetic, scalar `DECLARE`s. Assembles to 63 bytes. |
| [`docs/examples/sum.plm`](docs/examples/sum.plm) | `PROCEDURE` with args + return value, array indexing, recursion-free self-contained proc. |
| [`docs/examples/hello.plm`](docs/examples/hello.plm) | Radio-86RK monitor ROM calls via `REGS(...)` + `.` address-of. |
| [`docs/examples/literally.plm`](docs/examples/literally.plm) | `LITERALLY` macros for named constants: monitor vectors, loop bound, byte literals. |
| [`docs/examples/strlen.plm`](docs/examples/strlen.plm) | C-like strlen accepting any string address — uses `BYTE(65535) AT (0)` as a pre-BASED pointer-deref trick. |
| [`docs/examples/videomem.plm`](docs/examples/videomem.plm) | Direct writes to Radio-86RK video RAM at `76D0h` — fills all 78×30 cells with a rolling byte counter, no monitor calls. |
| [`docs/examples/greeting.plm`](docs/examples/greeting.plm) | End-to-end demo: banner, number sequence, sum, halt — all via monitor routines. |

Example output from the demo, running under rk86:

```text
PL/M-80 COMPILER HERE
00 01 02 03 04 05 06 07 08 09 0A
SUM (0..10) = 37
```

---

## Playground

An in-browser playground lives in [`docs/`](docs/). Sources at the top, generated asm in the middle, assembled bytes at the bottom — all recompiled on every keystroke. Both the PL/M compiler and the [asm8080](https://github.com/begoon/asm8) assembler are bundled into a single `playground.js`, so there is no server and no round-trip. Tabs, the example dropdown, and state are modelled on [asm8's playground](https://github.com/begoon/asm8/tree/main/docs); the three-pane layout is modelled on [c8080-js](https://github.com/alexey-f-morozov/c8080).

```bash
just serve-playground    # bundles docs/playground.js, serves docs/ on :8733
```

`docs/examples.js` is the manifest shown in the `Example` dropdown — each entry's source text is fetched from `docs/examples/` on demand. `docs/conf.js` holds per-deployment overrides (for example, pointing `Run` at a same-origin emulator).

---

## Calling conventions

Two ABIs live side by side. Full details in [`info/calling-convention.md`](info/calling-convention.md).

### 1. Static-slot (internal procedures and plain `AT` externals)

- Arguments are written to static memory slots named `<proc>_<param>` (both lowercased) before `call`.
- Result in `A` for `BYTE`, `HL` for `WORD` or `ADDRESS`.
- The callee may clobber any register; the caller never assumes register state survives a `call`. Expression codegen spills every live intermediate onto the CPU stack before emitting another call, so this is safe.

### 2. `REGS(reg, reg, ...)` on `AT` procedures

Declares a register-based ABI for external routines that don't use our static-slot convention — such as Radio-86RK monitor entries and classic CP/M BDOS.

```plm
PUTC: PROCEDURE (CH) REGS(C)  AT (0F809H); DECLARE CH BYTE;    END PUTC;
PUTS: PROCEDURE (P)  REGS(HL) AT (0F818H); DECLARE P  ADDRESS; END PUTS;
HEXB: PROCEDURE (B)  REGS(A)  AT (0F815H); DECLARE B  BYTE;    END HEXB;

CALL PUTC(41H);       /* mvi a,41h; mov c,a; call putc */
CALL PUTS(.MSG);      /* lxi h,msg;           call puts */
```

Byte params can be assigned to `A B C D E H L`; word/address params to `HL DE BC`. The compiler validates that register widths match parameter types. Return convention (result in `A` or `HL`) is unchanged.

For the full list of Radio-86RK monitor entries with their register bindings, see [`info/radio86rk-bios.md`](info/radio86rk-bios.md).

---

## Architecture

The compiler is a four-stage pipeline. Each stage produces a value you can inspect via a CLI flag:

```text
source.plm
   │
   ├─ lexer (src/lexer.ts)         -- plm80 --tokens
   ▼
   tokens
   │
   ├─ parser (src/parser.ts)       -- plm80 --ast
   ▼
   AST  (src/ast.ts)
   │
   ├─ semantic analyzer (src/sema.ts)  -- plm80 --check
   ▼
   AST + Resolution side-table
   │
   ├─ codegen (src/codegen.ts)
   ▼
   asm8 source (.asm)
   │
   ├─ bunx asm8080
   ▼
   8080 binary (.bin)
```

Design choices worth calling out:

- **No AST rewriting.** The semantic analyzer produces a side table (`symOf`, `typeOf`, `sigOf`, `scopeOf`, `global`) via `Map`s keyed by AST node identity. Codegen consults it. The AST itself stays a plain data tree, which keeps each stage focused and makes it cheap to add new analyses later.
- **Static allocation model.** All variables — globals, locals, parameters — get a labeled `ds` / `db` / `dw` slot. No stack frames, no frame pointer. This matches PL/M-80's default (non-`REENTRANT`) semantics and produces very small binaries, at the cost of no recursion.
- **Typed expression codegen.** Expressions evaluate into `A` when the target type is byte, `HL` when word/address. Intermediates spill onto the 8080 stack via `push psw` / `push h`. Byte↔word conversions go through two small helpers (`byteToWord` / `wordToByte`).
- **Strict TypeScript.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. This catches a lot of would-be codegen bugs at compile time.

---

## Target platforms

- **Assembler: [asm8](https://github.com/begoon/asm8)** (npm: `asm8080`). Two-pass 8080 assembler in TypeScript. Full instruction set, sensible expression language with `LOW(x)` / `HIGH(x)` functions. See [`info/asm8-notes.md`](info/asm8-notes.md) for the syntax details we target.
- **Emulator: [rk86](https://github.com/begoon/rk86)** (npm: `rk86`). Terminal-mode Radio-86RK (Intel 8080) emulator. Boots the monitor ROM from F800 for 500 ms on startup — which initializes CRTC, DMA, and the monitor work area — then jumps to the user program at its entry. Our programs therefore only need to set `SP` themselves; all hardware and monitor state is already live by the time user code runs. Exit cleanly on `HLT` with `--exit-halt`.

Both are pinned as devDependencies via `bun.lock` so CI is reproducible.

---

## Project layout

```text
plm-80/
├─ src/
│  ├─ token.ts      # token kinds + keyword list
│  ├─ lexer.ts      # source -> tokens
│  ├─ ast.ts        # AST node types
│  ├─ parser.ts     # recursive-descent parser
│  ├─ sema.ts       # scopes, resolution, typing
│  ├─ codegen.ts    # AST + Resolution -> asm8 text
│  └─ cli.ts        # argument parsing + stage selection
├─ test/
│  ├─ lexer.test.ts
│  ├─ parser.test.ts
│  ├─ sema.test.ts
│  ├─ codegen.test.ts
│  └─ e2e.test.ts   # compile + assemble + run under rk86
├─ docs/                      # browser playground + sources it ships
│  ├─ index.html
│  ├─ playground.ts           # compile → asm → assemble in-browser
│  ├─ conf.js                 # optional local overrides (emulator URL etc.)
│  ├─ examples.js             # manifest of example programs
│  └─ examples/
│     ├─ counter.plm
│     ├─ sum.plm
│     ├─ hello.plm
│     ├─ literally.plm
│     ├─ strlen.plm
│     ├─ videomem.plm
│     └─ greeting.plm
├─ info/                      # long-form reference (rendered on GitHub)
│  ├─ plm80-refs.md           # Intel manuals + language notes
│  ├─ asm8-notes.md           # asm8 syntax + codegen conventions
│  ├─ calling-convention.md   # ABI: static slots + REGS
│  └─ radio86rk-bios.md       # full F800-F835 monitor jump table
├─ Justfile                   # `just ci`, `just demo`
├─ .github/workflows/ci.yml   # runs `just ci` on push/PR
├─ package.json               # bun + typescript + asm8080 + rk86 as devDeps
├─ tsconfig.json              # strict TS
└─ CLAUDE.md                  # notes for Claude sessions
```

---

## Roadmap

Rough ordering, highest leverage first within each group.

### Language features

1. **`REENTRANT` — stack frames, recursion.** Requires refactoring every storage-access site in codegen to route through a helper that switches between static-slot and SP-relative addressing. Naive "callee-saves" does not work for genuine recursion. Unblocks every program that recurses or needs re-entrant ISRs.
2. **`INTERRUPT n` procs.** Register save/restore prologue plus `ei / ret`. Prerequisite for driving timer and keyboard ISRs on real hardware.
3. **`BASED` pointers.** Indirect addressing through a variable — unlocks linked lists, ring buffers, and anything that needs heap-like references.
4. **`STRUCTURE`.** Named aggregates with field offsets. Mostly layout arithmetic plus a field-resolution pass in sema, once `BASED` is in.
5. **Nested procedures.** Shares frame-management machinery with `REENTRANT`; cheaper to land after that.
6. **Structured returns.** Specifically the `HL + DE + BC` tuple returned by monitor routines like `inpblock`. Needs an AST-level multi-value notion and destructuring assignment.
7. **Whole-array arguments.** PL/M-80 allows passing an array by name (not just `.NAME`) and having the callee index into it. Covers a large fraction of idiomatic monitor-ROM usage.
8. **String expressions.** Currently refused outside `INITIAL`. Expose them as `(address, length)` so they flow through expression codegen and into `CALL` arguments.
9. **Remaining built-ins.** `DEC`, `MOV`, `MOVE`, `LENGTH`, `LAST`, `SIZE`, `TIME` — each a small runtime helper once the above is in place.
10. **Multi-module builds.** `PUBLIC` / `EXTERNAL` declarations with per-file compilation and a single `asm8080` invocation at link time.

### Tooling and quality

1. **Peephole optimizer.** Coalesce `mvi a,X / mov r,a` into `mvi r,X`, drop redundant `mov r,r`, fuse adjacent pointer increments, fold `lxi h,0 / dad d` patterns. The monitor ROM is only 2 KB and every byte on an 8080 system competes for space.
2. **Listing output.** Interleaved PL/M source + emitted assembly with addresses, matching Intel's original PLM-80 listing format. Makes it easy to audit codegen quality by eye.
3. **Editor integration.** `--check` already emits positioned errors. Wrapping it in a minimal LSP (diagnostics only) gives inline squigglies in VS Code and Zed for free.
4. **Richer diagnostics.** "Did you mean…" for mistyped identifiers, caret-under-token source rendering, typed `expected X, got Y` mismatches.

### Examples and reach

1. **CP/M BDOS demo.** Smallest useful `.com` program using BDOS call 9 — same `REGS(C)` shape as the existing RK monitor bindings, on a different target.
2. **Larger end-to-end example.** A small REPL or tape-loader utility that exercises the whole v0 subset and forces the next round of missing features to surface.

---

## Contributing

The repo is easy to hack on:

- Every compiler stage is one file; tests sit next to their stage's concerns.
- Adding a feature almost always touches 3–5 files in a predictable pattern: lexer (if new keyword), parser, sema, codegen, and the corresponding `.test.ts`.
- Run `bun test --watch` while working. The e2e tests take ~1.5s each and run the emulator for real — they catch subtle codegen bugs that would otherwise slip past the assembly-layer checks.

---

## Credits

- PL/M-80 language: Intel Corporation (1973-present).
- [asm8](https://github.com/begoon/asm8) and [rk86](https://github.com/begoon/rk86) emulator, both by Alexander Demin.
- Radio-86RK monitor ROM source reproduced for reference in `asm8/target/monitor.asm`.

---

## License

MIT. See [LICENSE](LICENSE).
