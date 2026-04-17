import { expect, test } from "bun:test";
import { tokenize } from "../src/lexer.ts";
import { preprocess } from "../src/preprocess.ts";
import { parse } from "../src/parser.ts";
import { analyze } from "../src/sema.ts";
import { generate } from "../src/codegen.ts";

function pp(src: string) { return preprocess(tokenize(src)); }
function compile(src: string) {
    const ast = parse(preprocess(tokenize(src)));
    return generate(ast, analyze(ast));
}

test("LITERALLY decl is stripped from the token stream", () => {
    const out = pp("DECLARE TRUE LITERALLY 'OFFH'; X");
    expect(out.map((t) => t.text)).toEqual(["X", ""]);
});

test("single-token macro expands", () => {
    const out = pp("DECLARE TRUE LITERALLY '0FFH'; X = TRUE;");
    const texts = out.map((t) => t.text);
    expect(texts).toContain("0FFH");
    expect(texts).not.toContain("TRUE");
});

test("multi-token macro expands", () => {
    const out = pp("DECLARE LIMIT LITERALLY '1024 * 64'; X = LIMIT;");
    const texts = out.map((t) => t.text);
    expect(texts.join(" ")).toContain("1024 * 64");
});

test("nested macros expand recursively", () => {
    const out = pp(`
        DECLARE N LITERALLY '42';
        DECLARE M LITERALLY 'N + 1';
        X = M;
    `);
    const texts = out.map((t) => t.text);
    expect(texts.join(" ")).toMatch(/42 \+ 1/);
});

test("self-reference is guarded (no infinite loop)", () => {
    const out = pp(`DECLARE X LITERALLY 'X'; Y = X;`);
    const texts = out.map((t) => t.text).filter((s) => s.length > 0);
    expect(texts).toEqual(["Y", "=", "X", ";"]);
});

test("LITERALLY integrates into full compile", () => {
    const out = compile(`
        DECLARE MAX LITERALLY '10';
        DECLARE I BYTE;
        I = MAX;
    `);
    expect(out).toMatch(/mvi\s+a,\s+0Ah/);
});
