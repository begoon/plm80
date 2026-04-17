import { expect, test } from "bun:test";
import { tokenize } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { analyze } from "../src/sema.ts";
import { generate, CodegenError } from "../src/codegen.ts";
import { asm } from "asm8080";

function compile(src: string): string {
    const ast = parse(tokenize(src));
    const res = analyze(ast);
    return generate(ast, res);
}

test("empty program yields valid asm with entry + halt", () => {
    const out = compile("");
    expect(out).toContain("start:");
    expect(out).toContain("hlt");
    expect(out).toContain("end");
});

test("byte literals use 0-prefixed hex when first digit is A-F", () => {
    const out = compile("DECLARE X BYTE; X = 0FFH;");
    expect(out).toContain("mvi  a, 0FFh");
});

test("byte literals stay 2-digit uppercase hex", () => {
    const out = compile("DECLARE X BYTE; X = 10;");
    expect(out).toContain("mvi  a, 0Ah");
});

test("assignment emits sta", () => {
    const out = compile("DECLARE X BYTE; X = 1;");
    expect(out).toMatch(/sta\s+x/);
});

test("DO WHILE produces loop with conditional jump", () => {
    const out = compile("DECLARE I BYTE; I = 0; DO WHILE I < 10; I = I + 1; END;");
    expect(out).toMatch(/^L\d+_while:/m);
    expect(out).toMatch(/jz\s+L\d+_endw/);
    expect(out).toMatch(/jmp\s+L\d+_while/);
});

test("IF/ELSE creates both branches", () => {
    const out = compile(`
        DECLARE X BYTE;
        IF X = 0 THEN X = 1; ELSE X = 2;
    `);
    expect(out).toMatch(/jz\s+L\d+_else/);
    expect(out).toMatch(/^L\d+_else:/m);
    expect(out).toMatch(/^L\d+_endif:/m);
});

test("procedure emits labeled entry and trailing ret", () => {
    const out = compile(`
        FOO: PROCEDURE;
            DECLARE X BYTE;
            X = 7;
        END FOO;
    `);
    expect(out).toMatch(/^foo:/m);
    const retCount = (out.match(/^\s+ret$/gm) ?? []).length;
    expect(retCount).toBe(1);
});

test("explicit RETURN does not produce a double ret", () => {
    const out = compile(`
        FOO: PROCEDURE BYTE;
            RETURN 1;
        END FOO;
    `);
    const retCount = (out.match(/^\s+ret$/gm) ?? []).length;
    expect(retCount).toBe(1);
});

test("array index read computes base + index", () => {
    const out = compile(`
        DECLARE BUF BYTE(16);
        DECLARE X BYTE;
        DECLARE I BYTE;
        X = BUF(I);
    `);
    expect(out).toMatch(/lxi\s+d,\s+buf/);
    expect(out).toMatch(/dad\s+d/);
    expect(out).toMatch(/mov\s+a,\s+m/);
});

test("CALL stores args into static param slots", () => {
    const out = compile(`
        ADD1: PROCEDURE(A) BYTE;
            DECLARE A BYTE;
            RETURN A + 1;
        END ADD1;
        DECLARE R BYTE;
        R = ADD1(5);
    `);
    expect(out).toMatch(/sta\s+add1_a/);
    expect(out).toMatch(/call\s+add1/);
});

test("INITIAL packs values into db", () => {
    const out = compile("DECLARE A BYTE(4) INITIAL(1, 2, 3, 4);");
    expect(out).toMatch(/a:\s+db\s+01h,\s+02h,\s+03h,\s+04h/);
});

test("unsupported * operator is reported", () => {
    expect(() => compile("DECLARE X BYTE; X = X * 2;")).toThrow(CodegenError);
});

test("byte literal out of range is rejected", () => {
    expect(() => compile("DECLARE X BYTE; X = 300;")).toThrow(CodegenError);
});

test("counter.plm assembles via asm8 without errors", () => {
    const src = `
        DECLARE I BYTE;
        DECLARE SUM BYTE;
        I = 0;
        SUM = 0;
        DO WHILE I < 10;
            SUM = SUM + I;
            I = I + 1;
        END;
    `;
    const asmSrc = compile(src);
    const sections = asm(asmSrc);
    expect(sections.length).toBe(1);
    expect(sections[0]!.data.length).toBeGreaterThan(0);
});

test("sum.plm with procedure + array assembles via asm8", () => {
    const src = `
        DECLARE BUF BYTE(8) INITIAL(1, 2, 3, 4, 5, 6, 7, 8);
        DECLARE N BYTE INITIAL(8);
        DECLARE R BYTE;

        SUMBUF: PROCEDURE(COUNT) BYTE;
            DECLARE COUNT BYTE;
            DECLARE I BYTE;
            DECLARE ACC BYTE;
            ACC = 0;
            I = 0;
            DO WHILE I < COUNT;
                ACC = ACC + BUF(I);
                I = I + 1;
            END;
            RETURN ACC;
        END SUMBUF;

        R = SUMBUF(N);
    `;
    const asmSrc = compile(src);
    const sections = asm(asmSrc);
    expect(sections.length).toBe(1);
    expect(sections[0]!.data.length).toBeGreaterThan(0);
});
