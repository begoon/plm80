import { expect, test } from "bun:test";
import { tokenize } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { analyze, SemaError } from "../src/sema.ts";
import type { AssignStmt, Expr, Proc } from "../src/ast.ts";

function run(src: string) {
    const ast = parse(tokenize(src));
    return { ast, res: analyze(ast) };
}

test("reports undefined variable", () => {
    expect(() => run("X = 1;")).toThrow(SemaError);
});

test("reports duplicate declaration", () => {
    expect(() => run("DECLARE X BYTE; DECLARE X BYTE;")).toThrow(SemaError);
});

test("global decls are resolvable from top-level statements", () => {
    const { ast, res } = run("DECLARE X BYTE; X = 42;");
    const assign = ast.items[1] as AssignStmt;
    const sym = res.symOf.get(assign.targets[0]!);
    expect(sym?.kind).toBe("var");
});

test("procedure signature captured from inner DECLARE", () => {
    const { ast, res } = run(`
        ADD: PROCEDURE(A, B) BYTE;
            DECLARE (A, B) BYTE;
            RETURN A + B;
        END ADD;
    `);
    const proc = ast.items[0] as Proc;
    const sig = res.sigOf.get(proc);
    expect(sig?.params).toEqual(["byte", "byte"]);
    expect(sig?.return).toBe("byte");
});

test("parameter without DECLARE is rejected", () => {
    expect(() => run(`
        FOO: PROCEDURE(A) BYTE;
            RETURN A;
        END FOO;
    `)).toThrow(SemaError);
});

test("wrong arity in CALL is rejected", () => {
    expect(() => run(`
        ADD: PROCEDURE(A, B) BYTE; DECLARE (A, B) BYTE; RETURN A + B; END ADD;
        CALL ADD(1);
    `)).toThrow(SemaError);
});

test("RETURN with value in typeless procedure is rejected", () => {
    expect(() => run(`
        FOO: PROCEDURE;
            RETURN 1;
        END FOO;
    `)).toThrow(SemaError);
});

test("RETURN without value in typed procedure is rejected", () => {
    expect(() => run(`
        FOO: PROCEDURE BYTE;
            RETURN;
        END FOO;
    `)).toThrow(SemaError);
});

test("call-vs-index resolved via symbol kind", () => {
    const { ast, res } = run(`
        DECLARE BUF BYTE(8);
        DECLARE X BYTE;
        X = BUF(3);
    `);
    const assign = ast.items[2] as AssignStmt;
    const rhs = assign.value;
    expect(rhs.kind).toBe("call");
    const sym = res.symOf.get(rhs);
    expect(sym?.kind).toBe("var");
    expect(res.typeOf.get(rhs)).toEqual({ kind: "byte" });
});

test("array index of non-array is rejected", () => {
    expect(() => run("DECLARE X BYTE; DECLARE Y BYTE; Y = X(1);")).toThrow(SemaError);
});

test("number literal typing: byte vs word", () => {
    const { ast, res } = run("DECLARE X WORD; X = 300;");
    const assign = ast.items[1] as AssignStmt;
    expect(res.typeOf.get(assign.value)).toEqual({ kind: "word" });

    const { ast: ast2, res: res2 } = run("DECLARE X BYTE; X = 5;");
    const a2 = ast2.items[1] as AssignStmt;
    expect(res2.typeOf.get(a2.value)).toEqual({ kind: "byte" });
});

test("binary op promotes byte+word to word", () => {
    const { ast, res } = run(`
        DECLARE B BYTE;
        DECLARE W WORD;
        DECLARE R WORD;
        R = B + W;
    `);
    const assign = ast.items[3] as AssignStmt;
    expect(res.typeOf.get(assign.value)).toEqual({ kind: "word" });
});

test("relational expression is byte", () => {
    const { ast, res } = run(`
        DECLARE A BYTE; DECLARE B BYTE; DECLARE C BYTE;
        C = A < B;
    `);
    const assign = ast.items[3] as AssignStmt;
    expect(res.typeOf.get(assign.value)).toEqual({ kind: "byte" });
});

test("procedure can be called recursively from its own body", () => {
    expect(() => run(`
        FACT: PROCEDURE(N) BYTE;
            DECLARE N BYTE;
            IF N = 0 THEN RETURN 1;
            RETURN N * FACT(N - 1);
        END FACT;
    `)).not.toThrow();
});

test("inner procedure decl shadows outer", () => {
    const { ast, res } = run(`
        DECLARE X BYTE;
        FOO: PROCEDURE;
            DECLARE X BYTE;
            X = 1;
        END FOO;
    `);
    const proc = ast.items[1] as Proc;
    const assign = proc.body.find((i) => i.kind === "assign") as AssignStmt;
    const sym = res.symOf.get(assign.targets[0]!);
    expect(sym?.kind).toBe("var");
    if (sym?.kind !== "var") throw new Error();
    expect(sym.storage).toBe("local");
});

test("GOTO to undefined label is rejected", () => {
    expect(() => run("GO TO NOWHERE;")).toThrow(SemaError);
});

test("GOTO to defined label is accepted", () => {
    expect(() => run("LOOP: X = 0; GO TO LOOP;")).toThrow(SemaError);
    expect(() => run("DECLARE X BYTE; LOOP: X = 0; GO TO LOOP;")).not.toThrow();
});

test("sum.plm example analyzes cleanly", () => {
    const src = `
        DECLARE BUF BYTE(16);
        DECLARE N BYTE INITIAL(10);

        SUM: PROCEDURE(P, COUNT) BYTE;
            DECLARE (P, COUNT) BYTE;
            DECLARE I BYTE;
            DECLARE ACC BYTE;
            ACC = 0;
            I = 0;
            DO WHILE I < COUNT;
                ACC = ACC + BUF(I);
                I = I + 1;
            END;
            RETURN ACC;
        END SUM;

        DECLARE RESULT BYTE;
        RESULT = SUM(BUF, N);
    `;
    const { res } = run(src);
    expect(res.global.lookup("SUM")?.kind).toBe("proc");
    expect(res.global.lookup("BUF")?.kind).toBe("var");
    expect(res.global.lookup("RESULT")?.kind).toBe("var");
});
