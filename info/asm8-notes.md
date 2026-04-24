# asm8 syntax notes (for codegen)

Source: https://github.com/begoon/asm8 (README + `target/monitor.asm` at `main` as of 2026-04-17).

Our codegen must emit valid asm8 input. asm8 is a two-pass 8080 assembler in TypeScript; all documented Intel 8080 mnemonics are accepted.

## Lexical

- **Case-insensitive** for mnemonics, registers, and symbols. We'll emit lowercase mnemonics, symbols untouched.
- **Comments**: `;` to end of line. No block comments.
- **Statement terminator**: newline. No `;` between statements.
- **Multi-statement lines**: ` / ` (spaces on both sides), up to 10 per line. We won't use this — one statement per line is easier to diff against listings.

## Numbers and literals

- Decimal: `255`.
- Hex: **must start with a digit**, `h` suffix — `0FFh`, `8000h`. If we compute a hex literal starting with `A–F`, prefix with `0`.
- Character: `'A'` — usable anywhere a byte value fits.
- Strings (in `db` only): `db "hello"` or `db 'hello'`.
- **Expressions**: C precedence, operators `+ - * / % | & ^ ~ << >>` and parentheses. `LOW(expr)` / `HIGH(expr)` extract low/high byte of a 16-bit value — maps 1:1 to PL/M `LOW`/`HIGH` builtins.

## Directives

Each directive may optionally be written with a leading dot (`.org`, `.db`, ...) but we'll stick to the undotted form.

- `org <addr>` — start a new section at `<addr>`.
- `section <name>` — name the current section.
- `equ <expr>` — constant; used as `label equ <expr>`.
- `db <b1>, <b2>, ...` — emit bytes (expressions or strings).
- `dw <w1>, <w2>, ...` — emit 16-bit words, little-endian (8080 convention).
- `ds N` — reserve N bytes of zeros. `ds N (F)` — reserve N bytes filled with byte `F`.
- `end` — end of source.

## Labels

`name:` at column 0 before an instruction or directive. Names are case-insensitive and can include digits after the first char.

## Output model

- Every `org` opens a new section. Default output is a single `.bin` file covering first section start → last section end, zero-padded between sections (and in front of the first section if its `org` isn't 0). Overlapping sections are an error.
- With `--split`, each section becomes its own `<base>-<sectionname>.bin`.

## Implications for plm-80 codegen

1. **One big module, one `org`** for v0. Default `org 0100h` (CP/M-style) unless the user overrides.
2. **Code section first, then data section** via a second `org` — avoid interleaving so the `.bin` stays compact.
3. **Global variables** → labeled `ds` entries in the data section. A `BYTE x` becomes `x: ds 1`; a `WORD w` becomes `w: ds 2`; a `BYTE a(10)` becomes `a: ds 10`.
4. **`INITIAL` constants** → `db` / `dw` with the provided values, still at a labeled location in the data section (or a rodata section if we later split code/data/rodata).
5. **Constants / `LITERALLY`** → `equ` directives emitted at the top.
6. **Numeric literals we emit**: decimal for small values, `0NNh` for anything derived from addresses or bit masks. Never rely on implicit leading-zero-less hex.
7. **Symbol names**: PL/M allows `$` as a visual separator inside identifiers (must be stripped before emitting); asm8 symbol rules don't include `$`, so `COUNT$LO` in PL/M source becomes `COUNTLO` in asm.
8. **Built-ins that map cleanly**: `LOW(x)` → `LOW(x)`, `HIGH(x)` → `HIGH(x)`. `SHR/SHL` → `>>`/`<<` at compile-time for constants, or `ana`/`rar`/`ral`/`rlc`/`rrc` sequences at runtime (TBD).
9. **Strings**: PL/M string literals become `db "…"` — but note PL/M doubles `''` for a single quote; convert to `"…"` form to avoid the escape dance.
10. **Multi-statement ` / `** — avoid. Keeps golden-file diffs readable.

## Emitter conventions (proposal)

- 4-space indent for instructions; labels at column 0.
- Single blank line between procedures.
- Header comment with source file + compiler version.
- Symbols: uppercase mnemonics feel more authentic to the 8080 era, but asm8 examples are lowercase — **go lowercase** to match the reference corpus (`monitor.asm`).

## Open questions to resolve before codegen lands

- How do we want to surface `CALL` to an `EXTERNAL` procedure when there's no linker? (Probably: require a user-supplied `equ` for its address, or a separate `externals.asm` stub.)
- 16-bit arithmetic helpers (`__mulhi`, `__divhi`, `__shlhi`) — ship as hand-written asm in `runtime/` and concatenate onto compiler output, or emit inline?
- Entry point convention: do we emit a `jmp start` at `org` and let the user define `start`, or assume the PL/M program's top-level block *is* `start`?
