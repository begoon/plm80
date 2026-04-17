import { expect, test } from "bun:test";
import { asm } from "asm8080";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../src/codegen.ts";
import { tokenize } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { analyze } from "../src/sema.ts";

function compileToBin(plmPath: string): Uint8Array {
    const src = readFileSync(plmPath, "utf-8");
    const ast = parse(tokenize(src));
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
