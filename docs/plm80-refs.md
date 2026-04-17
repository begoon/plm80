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

BYTE/WORD only; no BASED, no structures, no `AT`, no reentrant, no interrupt, no `LITERALLY`.
Statements: assignment, `IF/THEN/ELSE`, `DO...END`, `DO WHILE`, `CALL`, `RETURN`.
Expressions: `+ - * / MOD`, `AND OR XOR NOT`, comparisons.
Single module, no linking.
