import type { Pos } from "./token.ts";

export type PlmType = "BYTE" | "WORD" | "ADDRESS";

export type Node =
    | Program
    | Decl
    | Proc
    | Stmt
    | Expr;

export type Program = { kind: "program"; items: (Decl | Proc | Stmt)[]; pos: Pos };

export type Decl = {
    kind: "decl";
    name: string;
    type: PlmType;
    arraySize?: number;
    initial?: Expr[];
    pos: Pos;
};

export type Proc = {
    kind: "proc";
    name: string;
    params: { name: string; type: PlmType }[];
    returnType?: PlmType;
    body: Stmt[];
    pos: Pos;
};

export type Stmt =
    | { kind: "assign"; target: Expr; value: Expr; pos: Pos }
    | { kind: "if"; cond: Expr; then: Stmt[]; else?: Stmt[]; pos: Pos }
    | { kind: "do"; body: Stmt[]; pos: Pos }
    | { kind: "while"; cond: Expr; body: Stmt[]; pos: Pos }
    | { kind: "call"; name: string; args: Expr[]; pos: Pos }
    | { kind: "return"; value?: Expr; pos: Pos };

export type Expr =
    | { kind: "num"; value: number; pos: Pos }
    | { kind: "ref"; name: string; pos: Pos }
    | { kind: "index"; name: string; index: Expr; pos: Pos }
    | { kind: "bin"; op: BinOp; lhs: Expr; rhs: Expr; pos: Pos }
    | { kind: "un"; op: "NOT" | "-"; arg: Expr; pos: Pos };

export type BinOp =
    | "+" | "-" | "*" | "/" | "MOD"
    | "AND" | "OR" | "XOR"
    | "=" | "<>" | "<" | ">" | "<=" | ">=";
