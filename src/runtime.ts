/*  Assembly-level runtime helpers for the PL/M-80 compiler.
    Each helper is a named snippet.  Codegen tracks which helpers an
    output references and emits only those at the end of the code
    section.

    ABI:
      byte op:  input  A = lhs, B = rhs
                output A = result
                clobbers A/B/C/D/E/flags
      word op:  input  HL = lhs, DE = rhs
                output HL = result
                clobbers A/BC/DE/HL/flags                              */

export const RUNTIME: Record<string, string> = {
    // A = (A * B) & 0xFF   -- shift-and-add, MSB-first on the multiplier (C).
    rt_mul8: `rt_mul8:
    mov  c, a
    mvi  a, 0
    mvi  d, 8
rt_mul8_loop:
    add  a
    mov  e, a
    mov  a, c
    add  a
    mov  c, a
    mov  a, e
    jnc  rt_mul8_skip
    add  b
rt_mul8_skip:
    dcr  d
    jnz  rt_mul8_loop
    ret`,

    // A = A / B   -- unsigned, repeated subtraction.
    // B = 0 hangs forever (consistent with Intel PL/M: divide-by-zero is UB).
    rt_div8: `rt_div8:
    mvi  c, 0
rt_div8_loop:
    sub  b
    jc   rt_div8_done
    inr  c
    jmp  rt_div8_loop
rt_div8_done:
    mov  a, c
    ret`,

    // A = A MOD B   -- unsigned, repeated subtraction.
    rt_mod8: `rt_mod8:
    sub  b
    jnc  rt_mod8
    add  b
    ret`,

    // HL = (HL * DE) & 0xFFFF   -- shift-and-add, 16 iterations, MSB-first on the multiplier in BC.
    rt_mul16: `rt_mul16:
    mov  b, h
    mov  c, l
    lxi  h, 0
    mvi  a, 16
rt_mul16_loop:
    push psw
    dad  h
    ora  a
    mov  a, c
    ral
    mov  c, a
    mov  a, b
    ral
    mov  b, a
    jnc  rt_mul16_skip
    dad  d
rt_mul16_skip:
    pop  psw
    dcr  a
    jnz  rt_mul16_loop
    ret`,

    // HL = HL / DE   -- unsigned, repeated subtraction (BC counts quotient).
    rt_div16: `rt_div16:
    lxi  b, 0
rt_div16_loop:
    mov  a, l
    sub  e
    mov  l, a
    mov  a, h
    sbb  d
    mov  h, a
    jc   rt_div16_done
    inx  b
    jmp  rt_div16_loop
rt_div16_done:
    mov  h, b
    mov  l, c
    ret`,

    // HL = HL MOD DE   -- unsigned, repeated subtraction.
    rt_mod16: `rt_mod16:
    mov  a, l
    sub  e
    mov  l, a
    mov  a, h
    sbb  d
    mov  h, a
    jnc  rt_mod16
    dad  d
    ret`,
};
