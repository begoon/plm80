# plm-80

A compiler for a useful subset of **PL/M-80** targeting the bare **Intel 8080**. Written in TypeScript on the Bun runtime, emits assembly in the dialect accepted by [asm8](https://github.com/begoon/asm8), and is verified end-to-end against the [Radio-86RK](https://github.com/begoon/rk86) monitor ROM.

---

## What is PL/M-80

PL/M-80 is the systems language Intel published in 1973 for the 8080. It was used for CP/M, ISIS-II, and most early Intel firmware. It is block-structured, statically typed (`BYTE`, `WORD`, `ADDRESS`), and maps closely onto the 8080 architecture. This project implements a working compiler for the useful core of that language — enough to write practical bare-metal programs for the 8080, including code that calls into a ROM monitor via its jump table.

See [`docs/plm80-refs.md`](docs/plm80-refs.md) for the Intel manuals we follow (bitsavers order numbers 9800268 and 9800300).

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
| Statements | assignment (single + multi-target), indexed assignment, `IF/THEN/ELSE`, `DO ... END`, `DO WHILE cond`, `CALL name(args)`, `RETURN [value]`, labels + `GO TO` / `GOTO` |
| Expressions | `+ - AND OR XOR NOT`, comparisons `= <> < > <= >=`, unary `+` `-`, `(` `)` grouping, `.NAME` address-of, array indexing, procedure calls |

### Not yet implemented

These either raise a `CodegenError` with a clear message, or are rejected at parse/sema:

- `*` `/` `MOD` — need a runtime library of 8/16-bit multiply/divide helpers.
- Nested procedures, `REENTRANT`, `INTERRUPT n`.
- `BASED` pointers, `STRUCTURE`, `LITERALLY`.
- `DO CASE`, `DO I = a TO b [BY s]`.
- Whole-array arguments (must pass an address via `.NAME`).
- Multi-register structured returns (e.g. monitor's `inpblock` which returns `HL` + `DE` + `BC`).
- Built-ins: `LOW` / `HIGH` can be expressed as asm8 functions in the output but aren't yet wired as PL/M source operators; also `SHR`, `SHL`, `ROL`, `ROR`, `DEC`, `MOV`, `MOVE`, `LENGTH`, `LAST`, `SIZE`, `TIME`.

---

## Quick start

Requirements: [Bun](https://bun.sh), [just](https://github.com/casey/just).

```bash
git clone <this-repo>
cd plm-80
just ci          # installs deps, typechecks, runs full test suite (including rk86 e2e)
just demo        # compiles examples/demo-rk.plm and runs it under the Radio-86RK emulator
```

### Compile a single source file

```bash
bun run src/cli.ts path/to/foo.plm --org 0 --stack 76CFh -o foo.asm
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

Errors look like `examples/foo.plm:12:3: undefined identifier 'BAR'` — file path, line, column, message.

---

## Examples

Each program in `examples/` is a complete source you can build and run.

| File | Demonstrates |
| --- | --- |
| [`examples/counter.plm`](examples/counter.plm) | `DO WHILE` loop, byte arithmetic, scalar `DECLARE`s. Assembles to 63 bytes. |
| [`examples/sum.plm`](examples/sum.plm) | `PROCEDURE` with args + return value, array indexing, recursion-free self-contained proc. |
| [`examples/bios.plm`](examples/bios.plm) | `AT` on variables and procedures — memory-mapped I/O port, absolute-address array, external ROM call with static-slot ABI. |
| [`examples/hello-rk.plm`](examples/hello-rk.plm) | Radio-86RK monitor ROM calls via `REGS(...)` + `.` address-of. |
| [`examples/demo-rk.plm`](examples/demo-rk.plm) | End-to-end demo: banner, number sequence, sum, halt — all via monitor routines. |

Example output from the demo, running under rk86:

```text
PL/M-80 COMPILER HERE
00 01 02 03 04 05 06 07 08 09 0A
SUM (0..10) = 37
```

---

## Calling conventions

Two ABIs live side by side. Full details in [`docs/calling-convention.md`](docs/calling-convention.md).

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

For the full list of Radio-86RK monitor entries with their register bindings, see [`docs/radio86rk-bios.md`](docs/radio86rk-bios.md).

---

## Architecture

The compiler is a four-stage pipeline. Each stage produces a value you can inspect via a CLI flag:

```
source.plm
   │
   ├─ lexer (src/lexer.ts)         -- bun run src/cli.ts --tokens
   ▼
   tokens
   │
   ├─ parser (src/parser.ts)       -- bun run src/cli.ts --ast
   ▼
   AST  (src/ast.ts)
   │
   ├─ semantic analyzer (src/sema.ts)  -- bun run src/cli.ts --check
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

- **Assembler: [asm8](https://github.com/begoon/asm8)** (npm: `asm8080`). Two-pass 8080 assembler in TypeScript. Full instruction set, sensible expression language with `LOW(x)` / `HIGH(x)` functions. See [`docs/asm8-notes.md`](docs/asm8-notes.md) for the syntax details we target.
- **Emulator: [rk86](https://github.com/begoon/rk86)** (npm: `rk86`). Terminal-mode Radio-86RK (Intel 8080) emulator. Boots the monitor ROM from F800 for 500 ms on startup — which initializes CRTC, DMA, and the monitor work area — then jumps to the user program at its entry. Our programs therefore only need to set `SP` themselves; all hardware and monitor state is already live by the time user code runs. Exit cleanly on `HLT` with `--exit-halt`.

Both are pinned as devDependencies via `bun.lock` so CI is reproducible.

---

## Project layout

```
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
├─ examples/
│  ├─ counter.plm
│  ├─ sum.plm
│  ├─ bios.plm
│  ├─ hello-rk.plm
│  └─ demo-rk.plm
├─ docs/
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

Rough ordering, highest leverage first:

1. `*` `/` `MOD` with hand-written 8/16-bit runtime helpers (`runtime/mul8.asm`, `runtime/div8.asm`) emitted inline when referenced.
2. Built-ins that are free from asm8: `LOW` / `HIGH` as PL/M-level operators.
3. Shift/rotate built-ins: `SHR`, `SHL`, `ROL`, `ROR`, `DEC`.
4. `INTERRUPT n` procs — register save/restore prologue + `ei / ret`.
5. `REENTRANT` — stack frames, enabling recursion.
6. `DO CASE expr;` and `DO I = a TO b [BY s];`.
7. Structured returns for BIOS routines like `inpblock` (HL+DE+BC tuple).
8. `BASED` pointers and `STRUCTURE`.
9. `LITERALLY` macros (preprocess pass).

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
