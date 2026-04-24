# Radio-86RK Monitor ROM — public API (F800h–F835h)

Derived from `target/monitor.asm` in the asm8 repo. The monitor ROM exposes its routines via a 3-byte-per-entry jump table starting at `F800h`. Each entry is `jmp entry_foo`, so callers can rely on the addresses below even across ROM revisions.

Every routine uses a **register-based ABI** — arguments in `A`, `BC`, `DE`, or `HL`; results in the same. This is incompatible with the static-slot convention used for internal plm-80 procs, so calls from PL/M need either a hand-written asm shim *or* the `REGS(...)` proc attribute once it lands.

| Addr | Name | Inputs | Outputs | Notes |
| --- | --- | --- | --- | --- |
| F800 | `start` | — | (no return; cold-start monitor) | |
| F803 | `getc` | — | `A` = keyboard char (blocks) | |
| F806 | `inpb` | `A` = FFh to search for tape sync, else 8 | `A` = byte read from tape | |
| F809 | `putc` | `C` = char to display | `A` = 0 on exit | handles control codes, pause/break keys |
| F80C | `outb` | `C` = byte to write to tape | — | |
| F80F | `temp` | reserved — duplicates `putc` | — | |
| F812 | `kbhit` | — | `A` = 0 if no key pressed, else key code | non-blocking |
| F815 | `hexb` | `A` = byte to print as two hex digits | — | |
| F818 | `puts` | `HL` = address of 0-terminated string | `A` = 0 on exit | |
| F81B | `scan_kbd` | — | `A` = FFh (none) / FEh (RUS/LAT) / key code | raw scan, no repeat |
| F81E | `getxy` | — | `HL` = cursor position (H = Y, L = X) | |
| F821 | `curc` | — | `A` = character at cursor | |
| F824 | `inpblock` | `HL` = offset added to tape-embedded addrs | `HL` = start, `DE` = end, `BC` = checksum | reads block from tape |
| F827 | `outblock` | `HL` = start addr, `DE` = end addr | `BC` = checksum | writes block to tape |
| F82A | `chksum` | `HL` = start, `DE` = end | `BC` = computed checksum | |
| F82D | `video` | — | — | reinitializes CRTC (VG75) + DMA (VT57) |
| F830 | `getlim` | — | `HL` = top of free memory | |
| F833 | `setlim` | `HL` = new top-of-free-memory | — | |

## Plm-80 bindings we want

Most of these are single-input-single-output routines mapped to a single register, which is exactly what a `REGS(reg)` attribute on an `AT` procedure can express:

```pl/m
/* Basic console I/O */
PUTC:  PROCEDURE (CH)    REGS(C) AT (0F809H); DECLARE CH BYTE; END PUTC;
GETC:  PROCEDURE         BYTE    AT (0F803H);                  END GETC;
KBHIT: PROCEDURE         BYTE    AT (0F812H);                  END KBHIT;
PUTS:  PROCEDURE (P)     REGS(H) AT (0F818H); DECLARE P ADDRESS; END PUTS;
HEXB:  PROCEDURE (B)     REGS(A) AT (0F815H); DECLARE B BYTE;    END HEXB;

/* Screen / cursor */
GETXY: PROCEDURE         ADDRESS AT (0F81EH);                  END GETXY;
CURC:  PROCEDURE         BYTE    AT (0F821H);                  END CURC;
VIDEO: PROCEDURE                 AT (0F82DH);                  END VIDEO;

/* Memory-limit pair */
GETLIM: PROCEDURE        ADDRESS AT (0F830H);                  END GETLIM;
SETLIM: PROCEDURE (L)    REGS(H) AT (0F833H); DECLARE L ADDRESS; END SETLIM;

/* Tape I/O (byte at a time) */
INPB:  PROCEDURE (F)     REGS(A) BYTE AT (0F806H); DECLARE F BYTE; END INPB;
OUTB:  PROCEDURE (B)     REGS(C)      AT (0F80CH); DECLARE B BYTE; END OUTB;
```

For `inpblock`, `outblock`, and `chksum` the return is a 3-register tuple (`HL`, `DE`, `BC`) — these don't fit `REGS` and should be wrapped in a small hand-written shim, or hoisted to plm-80 with a structured return when we support that (v0.2+).

## What this requires from the compiler

- A `REGS(reg1, reg2, ...)` attribute on `AT` procedures.
- Parameter count must equal register count.
- Byte params accept one of `A B C D E H L`. Word/address params accept a register pair: `HL`, `DE`, `BC`.
- At a call site, each argument is evaluated into `A` (byte) or `HL` (word) and then moved into the target register. Evaluation order is left-to-right; the last argument should land in `A` / `HL` so intermediate moves aren't clobbered. For now we trust the user to declare params in a non-conflicting order (BIOS calls have 0 or 1 input, so it rarely matters).
- No static param slots are emitted for register-bound params.
- Return-value convention stays the same: `A` for byte, `HL` for word — which matches every routine in the table above that has a single return.
