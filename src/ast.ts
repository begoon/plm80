import type { Pos } from "./token.ts";

export type PlmType =
    | { kind: "byte" }
    | { kind: "word" }
    | { kind: "address" }
    | { kind: "array"; element: "byte" | "word" | "address"; size: number };

export type Program = { kind: "program"; items: Item[]; pos: Pos };
export type Item = Decl | Proc | Stmt;

export type Decl = {
    kind: "decl";
    name: string;
    type: PlmType;
    initial?: Expr[];
    at?: number;
    pos: Pos;
};

export type Proc = {
    kind: "proc";
    name: string;
    params: string[];
    returnType?: "byte" | "word" | "address";
    body: Item[];
    at?: number;
    regs?: ParamReg[];
    pos: Pos;
};

export type ParamReg =
    | "A" | "B" | "C" | "D" | "E" | "H" | "L"
    | "BC" | "DE" | "HL";

export type Stmt =
    | AssignStmt
    | IfStmt
    | DoStmt
    | WhileStmt
    | IterStmt
    | CaseStmt
    | CallStmt
    | ReturnStmt
    | GotoStmt
    | LabelStmt
    | NullStmt;

export type AssignStmt = { kind: "assign"; targets: LValue[]; value: Expr; pos: Pos };
export type IfStmt = { kind: "if"; cond: Expr; then: Stmt; else?: Stmt; pos: Pos };
export type DoStmt = { kind: "do"; body: Item[]; pos: Pos };
export type WhileStmt = { kind: "while"; cond: Expr; body: Item[]; pos: Pos };
export type IterStmt = {
    kind: "iter";
    var: string;
    from: Expr;
    to: Expr;
    step?: Expr;
    body: Item[];
    pos: Pos;
};
export type CaseStmt = { kind: "case"; selector: Expr; cases: Stmt[]; pos: Pos };
export type CallStmt = { kind: "call"; name: string; args: Expr[]; pos: Pos };
export type ReturnStmt = { kind: "return"; value?: Expr; pos: Pos };
export type GotoStmt = { kind: "goto"; label: string; pos: Pos };
export type LabelStmt = { kind: "label"; name: string; pos: Pos };
export type NullStmt = { kind: "null"; pos: Pos };

export type LValue =
    | { kind: "ref"; name: string; pos: Pos }
    | { kind: "index"; name: string; index: Expr; pos: Pos };

export type Expr =
    | { kind: "num"; value: number; pos: Pos }
    | { kind: "str"; value: string; pos: Pos }
    | { kind: "ref"; name: string; pos: Pos }
    | { kind: "index"; name: string; index: Expr; pos: Pos }
    | { kind: "call"; name: string; args: Expr[]; pos: Pos }
    | { kind: "bin"; op: BinOp; lhs: Expr; rhs: Expr; pos: Pos }
    | { kind: "un"; op: UnOp; arg: Expr; pos: Pos }
    | { kind: "addrOf"; name: string; pos: Pos };

export type BinOp =
    | "+" | "-" | "*" | "/" | "MOD"
    | "AND" | "OR" | "XOR"
    | "=" | "<>" | "<" | ">" | "<=" | ">=";

export type UnOp = "NOT" | "-" | "+";
