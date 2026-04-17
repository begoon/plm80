import { expect, test } from "bun:test";
import { tokenize } from "../src/lexer.ts";
import { parse, ParseError } from "../src/parser.ts";
import type { AssignStmt, Decl, DoStmt, IfStmt, Item, Proc, Stmt, WhileStmt } from "../src/ast.ts";

function p(src: string) { return parse(tokenize(src)); }
function first<T extends Item>(items: Item[], kind: T["kind"]): T {
    const it = items[0];
    if (!it || it.kind !== kind) throw new Error(`expected first item to be ${kind}, got ${it?.kind}`);
    return it as T;
}

test("empty program", () => {
    expect(p("").items).toEqual([]);
});

test("simple declaration", () => {
    const d = first<Decl>(p("DECLARE X BYTE;").items, "decl");
    expect(d.name).toBe("X");
    expect(d.type).toEqual({ kind: "byte" });
});

test("declaration with INITIAL", () => {
    const d = first<Decl>(p("DECLARE N WORD INITIAL(1000);").items, "decl");
    expect(d.type).toEqual({ kind: "word" });
    expect(d.initial?.[0]).toMatchObject({ kind: "num", value: 1000 });
});

test("array declaration", () => {
    const d = first<Decl>(p("DECLARE BUF BYTE(16);").items, "decl");
    expect(d.type).toEqual({ kind: "array", element: "byte", size: 16 });
});

test("multi-name DECLARE expands to separate decls", () => {
    const items = p("DECLARE (A, B, C) BYTE;").items;
    expect(items).toHaveLength(3);
    expect(items.map((i) => (i.kind === "decl" ? i.name : null))).toEqual(["A", "B", "C"]);
});

test("assignment", () => {
    const s = first<AssignStmt>(p("X = 42;").items, "assign");
    expect(s.targets[0]).toMatchObject({ kind: "ref", name: "X" });
    expect(s.value).toMatchObject({ kind: "num", value: 42 });
});

test("multi-target assignment", () => {
    const s = first<AssignStmt>(p("A, B, C = 0;").items, "assign");
    expect(s.targets.map((t) => (t.kind === "ref" ? t.name : ""))).toEqual(["A", "B", "C"]);
});

test("indexed assignment", () => {
    const s = first<AssignStmt>(p("BUF(I) = 5;").items, "assign");
    expect(s.targets[0]).toMatchObject({ kind: "index", name: "BUF" });
});

test("expression precedence: mul binds tighter than add", () => {
    const s = first<AssignStmt>(p("X = 1 + 2 * 3;").items, "assign");
    if (s.value.kind !== "bin") throw new Error();
    expect(s.value.op).toBe("+");
    expect(s.value.rhs).toMatchObject({ kind: "bin", op: "*" });
});

test("comparison in IF", () => {
    const s = first<IfStmt>(p("IF A < 10 THEN X = 1;").items, "if");
    expect(s.cond).toMatchObject({ kind: "bin", op: "<" });
});

test("IF/THEN/ELSE", () => {
    const s = first<IfStmt>(p("IF A = 0 THEN X = 1; ELSE X = 2;").items, "if");
    expect(s.then.kind).toBe("assign");
    expect(s.else?.kind).toBe("assign");
});

test("DO ... END block", () => {
    const s = first<DoStmt>(p("DO; X = 1; Y = 2; END;").items, "do");
    expect(s.body).toHaveLength(2);
});

test("DO WHILE", () => {
    const s = first<WhileStmt>(p("DO WHILE X < 10; X = X + 1; END;").items, "while");
    expect(s.cond).toMatchObject({ kind: "bin", op: "<" });
    expect(s.body).toHaveLength(1);
});

test("PROCEDURE with params and body", () => {
    const proc = first<Proc>(p(`
        ADD: PROCEDURE(A, B) BYTE;
            DECLARE (A, B) BYTE;
            RETURN A + B;
        END ADD;
    `).items, "proc");
    expect(proc.name).toBe("ADD");
    expect(proc.params).toEqual(["A", "B"]);
    expect(proc.returnType).toBe("byte");
    expect(proc.body).toHaveLength(3);
});

test("mismatched END name is rejected", () => {
    expect(() => p("FOO: PROCEDURE; END BAR;")).toThrow(ParseError);
});

test("CALL with args", () => {
    const s = first<Stmt>(p("CALL PRINT(X, Y);").items, "call");
    if (s.kind !== "call") throw new Error();
    expect(s.name).toBe("PRINT");
    expect(s.args).toHaveLength(2);
});

test("labeled statement", () => {
    const items = p("LOOP: X = X + 1;").items;
    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("label");
    expect(items[1]?.kind).toBe("assign");
});

test("GO TO label", () => {
    const s = first<Stmt>(p("GO TO LOOP;").items, "goto");
    if (s.kind !== "goto") throw new Error();
    expect(s.label).toBe("LOOP");
});

test("parse error carries source position", () => {
    try {
        p("DECLARE X BYTE\n");
        throw new Error("should have thrown");
    } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        expect((e as ParseError).pos.line).toBe(2);
    }
});
