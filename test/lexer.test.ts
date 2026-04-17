import { expect, test } from "bun:test";
import { tokenize } from "../src/lexer.ts";

test("keywords are case-insensitive and classified", () => {
    const t = tokenize("declare x byte;");
    expect(t.map((x) => x.kind)).toEqual(["kw", "ident", "kw", "punct", "eof"]);
    expect(t[0]!.text).toBe("DECLARE");
    expect(t[2]!.text).toBe("BYTE");
});

test("numeric literals with radix suffixes", () => {
    const t = tokenize("0FFH 1010B 77O 42");
    expect(t[0]!.value).toBe(0xff);
    expect(t[1]!.value).toBe(0b1010);
    expect(t[2]!.value).toBe(0o77);
    expect(t[3]!.value).toBe(42);
});

test("strings with doubled quotes", () => {
    const t = tokenize("'it''s'");
    expect(t[0]!.kind).toBe("string");
    expect(t[0]!.text).toBe("it's");
});

test("block comment", () => {
    const t = tokenize("/* hello */ X");
    expect(t[0]!.kind).toBe("ident");
    expect(t[0]!.text).toBe("X");
});

test("compound punctuation", () => {
    const t = tokenize("a := b <> c <= d >= e");
    const puncts = t.filter((x) => x.kind === "punct").map((x) => x.text);
    expect(puncts).toEqual([":=", "<>", "<=", ">=", ";"].slice(0, 4));
});
