import { expect, test } from "bun:test";
import { asm } from "asm8080";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../src/codegen.ts";
import { tokenize } from "../src/lexer.ts";
import { preprocess } from "../src/preprocess.ts";
import { parse } from "../src/parser.ts";
import { analyze } from "../src/sema.ts";

function compileToBin(plmPath: string): Uint8Array {
    const src = readFileSync(plmPath, "utf-8");
    const ast = parse(preprocess(tokenize(src)));
    const res = analyze(ast);
    const asmSrc = generate(ast, res, { origin: 0, stack: 0x76CF });
    const sections = asm(asmSrc);
    expect(sections.length).toBe(1);
    return Uint8Array.from(sections[0]!.data);
}

function stripDisplay(raw: string): string {
    return raw
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
        .replace(/[\x80-\xff]/g, "")
        .replace(/\r/g, "");
}

function runUnderRk86(bin: Uint8Array): string {
    const dir = mkdtempSync(join(tmpdir(), "plm-e2e-"));
    const path = join(dir, "prog.bin");
    writeFileSync(path, bin);
    const proc = Bun.spawnSync({
        cmd: ["bunx", "rk86", "--exit-halt", path],
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
    });
    return stripDisplay(proc.stdout.toString());
}

test("demo-rk.plm: banner, sequence, and sum printed by monitor ROM", () => {
    const bin = compileToBin("examples/demo-rk.plm");
    expect(bin.length).toBeGreaterThan(0);
    expect(bin.length).toBeLessThan(512);

    const out = runUnderRk86(bin);
    expect(out).toMatch(/PL\/M-80 COMPILER HERE/);
    expect(out).toMatch(/00 01 02 03 04 05 06 07 08 09 0A/);
    expect(out).toMatch(/SUM \(0\.\.10\) = 37/);
}, 20_000);

test("minimal PUTC program prints three chars via monitor", () => {
    const dir = mkdtempSync(join(tmpdir(), "plm-e2e-"));
    const plm = join(dir, "abc.plm");
    writeFileSync(plm,
        `PUTC: PROCEDURE (CH) REGS(C) AT (0F809H); DECLARE CH BYTE; END PUTC;
         CALL PUTC(41H);
         CALL PUTC(42H);
         CALL PUTC(43H);`,
    );
    const bin = compileToBin(plm);
    const out = runUnderRk86(bin);
    expect(out).toMatch(/ABC/);
}, 20_000);

test("DO I = 1 TO 5 loop runs 5 times under rk86", () => {
    const dir = mkdtempSync(join(tmpdir(), "plm-e2e-"));
    const plm = join(dir, "iter.plm");
    writeFileSync(plm,
        `HEXB: PROCEDURE (B)  REGS(A) AT (0F815H); DECLARE B BYTE;  END HEXB;
         PUTC: PROCEDURE (CH) REGS(C) AT (0F809H); DECLARE CH BYTE; END PUTC;

         DECLARE I BYTE;
         DO I = 1 TO 5;
             CALL HEXB(I);
             CALL PUTC(20H);
         END;`,
    );
    const bin = compileToBin(plm);
    const out = runUnderRk86(bin);
    expect(out).toMatch(/01 02 03 04 05/);
}, 20_000);

test("DO CASE dispatches to the selected branch under rk86", () => {
    const dir = mkdtempSync(join(tmpdir(), "plm-e2e-"));
    const plm = join(dir, "case.plm");
    writeFileSync(plm,
        `PUTC: PROCEDURE (CH) REGS(C) AT (0F809H); DECLARE CH BYTE; END PUTC;

         DECLARE N BYTE;
         N = 2;
         DO CASE N;
             CALL PUTC(41H);   /* 'A' for case 0 */
             CALL PUTC(42H);   /* 'B' for case 1 */
             CALL PUTC(43H);   /* 'C' for case 2 */
             CALL PUTC(44H);   /* 'D' for case 3 */
         END;`,
    );
    const bin = compileToBin(plm);
    const out = runUnderRk86(bin);
    expect(out).toMatch(/C/);
    // Make sure the other cases didn't run:
    expect(out).not.toMatch(/ABCD/);
}, 20_000);

test("LOW / HIGH / SHR / SHL / ROR / ROL compute correctly under rk86", () => {
    const dir = mkdtempSync(join(tmpdir(), "plm-e2e-"));
    const plm = join(dir, "bits.plm");
    writeFileSync(plm,
        `HEXB: PROCEDURE (B)  REGS(A) AT (0F815H); DECLARE B BYTE;  END HEXB;
         PUTC: PROCEDURE (CH) REGS(C) AT (0F809H); DECLARE CH BYTE; END PUTC;

         DECLARE W WORD;
         DECLARE X BYTE;

         W = 0ABCDH;
         CALL HEXB(HIGH(W));   /* AB */
         CALL HEXB(LOW(W));    /*   CD */
         CALL PUTC(20H);

         X = 01H;
         CALL HEXB(SHL(X, 3)); /* 08 */
         CALL PUTC(20H);

         X = 80H;
         CALL HEXB(SHR(X, 3)); /* 10 */
         CALL PUTC(20H);

         X = 01H;
         CALL HEXB(ROR(X, 1)); /* 80 */
         CALL PUTC(20H);

         X = 81H;
         CALL HEXB(ROL(X, 1)); /* 03 */`,
    );
    const bin = compileToBin(plm);
    const out = runUnderRk86(bin);
    expect(out).toMatch(/ABCD 08 10 80 03/);
}, 20_000);

test("byte *, /, MOD helpers compute correct results under rk86", () => {
    const dir = mkdtempSync(join(tmpdir(), "plm-e2e-"));
    const plm = join(dir, "arith.plm");
    writeFileSync(plm,
        `HEXB: PROCEDURE (B)  REGS(A) AT (0F815H); DECLARE B BYTE;  END HEXB;
         PUTC: PROCEDURE (CH) REGS(C) AT (0F809H); DECLARE CH BYTE; END PUTC;

         DECLARE A BYTE; DECLARE B BYTE;
         DECLARE P BYTE; DECLARE Q BYTE; DECLARE R BYTE;

         A = 23;   /* 17h */
         B = 5;    /* 05h */
         P = A * B;       /* 115 = 73h */
         Q = A / B;       /*   4 = 04h */
         R = A MOD B;     /*   3 = 03h */

         CALL HEXB(P); CALL PUTC(20H);
         CALL HEXB(Q); CALL PUTC(20H);
         CALL HEXB(R);`,
    );
    const bin = compileToBin(plm);
    const out = runUnderRk86(bin);
    expect(out).toMatch(/73 04 03/);
}, 20_000);
