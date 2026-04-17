# PL/M-80 references

## Primary specs

- **PL/M-80 Programming Manual** (Intel, 1976; revised editions into 1978). Order number 9800268. The language reference.
- **ISIS-II PL/M-80 Compiler Operator's Manual** (Intel). Order number 9800300. Describes compiler options, listing format, and the object/link format.
- **8080/8085 Assembly Language Programming Manual** (Intel, 9800301). For register conventions and instruction semantics we generate.

Both PL/M manuals are archived on bitsavers (`bitsavers.org/pdf/intel/`). Search by the order numbers above.

## Target assembler

- **asm8** — https://github.com/begoon/asm8. Our codegen output must be valid asm8 input. Syntax quirks to verify (number literals, `org`/`equ`, label form, comment char) before we commit to a codegen style.

## Useful corpora

- Intel ISIS-II sources (where available) — real-world PL/M-80.
- CP/M BDOS and BIOS sources — mostly 8080 asm, but some modules have PL/M originals.
- Tiny-BASIC and various Intel sample programs shipped with ISIS-II disks (bitsavers has disk images).

## Language notes to pin down early

- Types: `BYTE`, `WORD`, `ADDRESS`, `LABEL`; arrays via `(n)`; structures via `STRUCTURE`.
- `BASED` (pointer-like) and `AT` (absolute address).
- `LITERALLY` — textual macro; expands before parsing proper.
- `INITIAL` (ROMable init data) vs `DATA` (constant table).
- Procedure attributes: `PUBLIC`, `EXTERNAL`, `REENTRANT`, `INTERRUPT n`.
- Built-ins: `MOV`, `MOVE`, `SHR`, `SHL`, `ROR`, `ROL`, `DEC`, `HIGH`, `LOW`, `LENGTH`, `LAST`, `SIZE`, `.` (address-of), `TIME`.
- Reserved identifiers / `$` as a visual separator inside identifiers (ignored).
- Number literals: decimal default; suffixes `H` (hex), `B` (binary), `O`/`Q` (octal), `D` (decimal).
- String literals in single quotes; `''` for embedded quote.

## Subset for v0

BYTE/WORD only; no BASED, no structures, no reentrant, no interrupt, no `LITERALLY`.
Statements: assignment, `IF/THEN/ELSE`, `DO...END`, `DO WHILE`, `CALL`, `RETURN`.
Expressions: `+ - * / MOD`, `AND OR XOR NOT`, comparisons.
Single module, no linking.

## External entry points via `AT` (v0 requirement)

Bare 8080 targets (ROM monitors, BDOS-like services) need a way to call routines at known ROM/RAM addresses without a linker. PL/M-80 uses the `AT` clause for this. Required forms:

```pl/m
/* Typeless external procedure at a fixed address */
BIOSOUT: PROCEDURE (CH) EXTERNAL AT (0F803H);
    DECLARE CH BYTE;
END BIOSOUT;

/* Typed external procedure */
BIOSCALL: PROCEDURE BYTE EXTERNAL AT (0F808H);
END BIOSCALL;

/* Alternative shorthand (non-standard, seen in some PL/M-80 code) */
DECLARE BIOSCALL PROCEDURE BYTE AT 0F808H;
```

Call sites:

```pl/m
CALL BIOSOUT(65);        /* typeless */
RESULT = BIOSCALL;       /* typed, zero args -- proc name used as value */
```

Codegen for `AT`-bound procedures:

- No body emitted. Instead, a single `equ` at the top: `BIOSCALL equ 0F808h`.
- `CALL BIOSCALL` → `call BIOSCALL`. Assembler resolves via the `equ`.
- Arguments go through the same static param slots as for normal procs. But since there's no body, the *callee* must be using a documented ABI (registers or well-known addresses) — we need to honor that. This means the `AT` form needs an **ABI annotation** beyond pure PL/M: e.g., "args passed in A, result in A". Decide syntax later; for now, document that plain `CALL BIOSOUT(ch)` will pass `ch` via a static slot `BIOSOUT_CH:`, which the external target is expected to read. (Not realistic for BDOS-style routines that expect A/C/E; will likely need an `INTEL` or `REGS` extension attribute.)

`AT` also applies to variables (`DECLARE VRAM BYTE AT 8000H;`) — codegen emits `VRAM equ 8000h` and treats it as an absolute address when loading/storing. Support both procedure and variable forms in v0.
