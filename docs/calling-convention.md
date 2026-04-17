# Calling convention

Internal (plm-80-generated) procedures and external `AT`-bound procedures share the same ABI. This document pins down what the compiler emits and what a hand-written external target must honor.

## Arguments

For a procedure `FOO: PROCEDURE (A, B, ...) ...;` the compiler allocates one static slot per parameter named `foo_a`, `foo_b`, etc. (name of the procedure in lowercase, underscore, parameter name in lowercase). Each slot is a `ds 1` for `BYTE` or a `ds 2` for `WORD`/`ADDRESS`.

At a call site `CALL FOO(E1, E2, ...)` (or `R = FOO(E1, E2, ...)`), the compiler:
1. Evaluates each argument into `A` (byte) or `HL` (word), in left-to-right order.
2. Immediately after each argument is evaluated, writes it to its slot via `sta foo_a` or `shld foo_a`.
3. Emits `call foo` once all slots are populated.

Arguments are therefore passed **through memory**, not registers.

## Return value

- A procedure declared `... BYTE;` returns its value in register `A`.
- A procedure declared `... WORD;` or `... ADDRESS;` returns its value in register `HL`.
- A typeless procedure returns nothing; `A`/`HL` are undefined on return.

## Register preservation

**The caller does not assume that any register survives a `call`.** Our expression codegen spills every live intermediate to memory (via `push psw` for a byte or `push h` for a word on the CPU stack, or to a named slot for arguments) before evaluating anything that might emit another `call`. This is why procedures do not need to save callee-state to be usable from generated code.

Concretely, internal procedures clobber `A`, flags, `B`, `C`, `D`, `E`, `H`, `L` freely. The only invariant they honor is:
- On entry, the runtime stack (`SP`) is balanced.
- On exit (`ret`), the runtime stack is the same as on entry, and the return value (if any) is in `A` or `HL`.

## External `AT` procedures

`DECLARE BIOSOUT: PROCEDURE (CH) AT (0F803H); ...` (or the `PROCEDURE (CH) BYTE AT (0F803H)` form) tells the compiler that a routine already exists at address `0F803H` and obeys the convention above. That means the external target, when called, must:

- Read its arguments from the static slots (`biosout_ch`, etc.), **not** from CPU registers.
- Return its result in `A` (byte) or `HL` (word), if typed.
- `ret` cleanly (no stack fixup required).
- Not require any caller-preserved register.

For routines that use a different convention (classic BDOS: function code in `C`, argument in `DE`, result in `A`), write a small hand-written shim in assembly that reads from plm-80's static slots, loads the expected registers, calls the native entry point, and returns.

### Example shim: CP/M BDOS

PL/M source:

```pl/m
BDOS: PROCEDURE (FN, ARG) BYTE AT (0F200H);   /* address of our shim */
    DECLARE FN BYTE;
    DECLARE ARG ADDRESS;
END BDOS;

CALL BDOS(9, .MSG);     /* print string (when we support .address-of) */
```

Hand-written shim, linked at `0F200H`:

```asm
    org  0F200h
bdos_shim:
    lda  bdos_fn          ; read static slot
    mov  c, a
    lhld bdos_arg
    xchg                  ; DE <- arg
    call 0005h            ; real CP/M BDOS entry
    ret                   ; A already holds result
```

The user supplies this shim; the compiler wires the call for them.

## `INTERRUPT` procedures

Not yet supported. When added, they will save all registers on entry and restore them on exit (`push psw / h / d / b` + `pop` in reverse), and terminate with `ei / ret` or `ei / reti`.

## Caveats / things to watch

- **No recursion.** Because parameters and locals are static slots, calling a procedure recursively clobbers its own state. Sema allows recursion syntactically, but codegen for a self-call will overwrite the caller's frame. Fix requires a `REENTRANT` attribute and stack-allocated frames — a v0.1+ project.
- **Re-entry from interrupt.** Same hazard as above. If an interrupt handler might call into a procedure that's already on the call chain, expect corruption. Keep ISRs self-contained or declare their callees `REENTRANT` once we support it.
- **External callee clobbers our static slots.** The convention reserves `<proc>_<param>` slots for that procedure's params. A wild external routine that writes to arbitrary memory can still corrupt other variables — this is the user's problem, not ours.
