import type { Keyword, Pos, Token } from "./token.ts";
import type {
    BinOp, Decl, Expr, IterStmt, Item, LValue, PlmType, Proc, Program, Stmt,
} from "./ast.ts";

export class ParseError extends Error {
    constructor(message: string, readonly pos: Pos) {
        super(`${pos.line}:${pos.col}: ${message}`);
    }
}

export function parse(tokens: Token[]): Program {
    const p = new Parser(tokens);
    return p.program();
}

class Parser {
    private i = 0;
    constructor(private readonly toks: Token[]) {}

    private peek(offset = 0): Token {
        return this.toks[this.i + offset] ?? this.toks[this.toks.length - 1]!;
    }
    private at(): Token { return this.peek(); }
    private eof(): boolean { return this.at().kind === "eof"; }

    private isKw(kw: Keyword, offset = 0): boolean {
        const t = this.peek(offset);
        return t.kind === "kw" && t.keyword === kw;
    }
    private isPunct(s: string, offset = 0): boolean {
        const t = this.peek(offset);
        return t.kind === "punct" && t.text === s;
    }

    private eatKw(kw: Keyword): Token {
        const t = this.at();
        if (!this.isKw(kw)) throw new ParseError(`expected ${kw}, got '${t.text}'`, t.pos);
        this.i++;
        return t;
    }
    private eatPunct(s: string): Token {
        const t = this.at();
        if (!this.isPunct(s)) throw new ParseError(`expected '${s}', got '${t.text}'`, t.pos);
        this.i++;
        return t;
    }
    private eatIdent(): Token {
        const t = this.at();
        if (t.kind !== "ident") throw new ParseError(`expected identifier, got '${t.text}'`, t.pos);
        this.i++;
        return t;
    }

    program(): Program {
        const pos = this.at().pos;
        const items: Item[] = [];
        while (!this.eof()) {
            this.collectItem(items);
        }
        return { kind: "program", items, pos };
    }

    private collectItem(out: Item[]): void {
        if (this.isKw("DECLARE")) { this.declarations(out); return; }
        if (this.peek().kind === "ident" && this.isPunct(":", 1) && this.isKw("PROCEDURE", 2)) {
            out.push(this.procedure());
            return;
        }
        out.push(this.statement());
    }

    private procedure(): Proc {
        const nameTok = this.eatIdent();
        this.eatPunct(":");
        const procKw = this.eatKw("PROCEDURE");
        const params: string[] = [];
        if (this.isPunct("(")) {
            this.eatPunct("(");
            if (!this.isPunct(")")) {
                params.push(this.eatIdent().text);
                while (this.isPunct(",")) {
                    this.eatPunct(",");
                    params.push(this.eatIdent().text);
                }
            }
            this.eatPunct(")");
        }
        let returnType: Proc["returnType"];
        if (this.isKw("BYTE")) { this.eatKw("BYTE"); returnType = "byte"; }
        else if (this.isKw("WORD")) { this.eatKw("WORD"); returnType = "word"; }
        else if (this.isKw("ADDRESS")) { this.eatKw("ADDRESS"); returnType = "address"; }
        let at: number | undefined;
        let regs: import("./ast.ts").ParamReg[] | undefined;
        while (this.isKw("AT") || this.isKw("REGS")) {
            if (this.isKw("AT")) {
                if (at !== undefined) throw new ParseError(`duplicate AT`, this.at().pos);
                this.eatKw("AT");
                at = this.parseAtAddress(procKw.pos);
            } else {
                if (regs !== undefined) throw new ParseError(`duplicate REGS`, this.at().pos);
                this.eatKw("REGS");
                regs = this.parseRegList(procKw.pos);
            }
        }
        this.eatPunct(";");

        const body: Item[] = [];
        while (!this.isKw("END")) {
            if (this.eof()) throw new ParseError(`unterminated PROCEDURE ${nameTok.text}`, procKw.pos);
            this.collectItem(body);
        }
        this.eatKw("END");
        if (this.peek().kind === "ident") {
            const endName = this.eatIdent();
            if (endName.text !== nameTok.text) {
                throw new ParseError(`END ${endName.text} does not match PROCEDURE ${nameTok.text}`, endName.pos);
            }
        }
        this.eatPunct(";");
        if (at !== undefined) {
            for (const item of body) {
                if (item.kind !== "decl") {
                    throw new ParseError(
                        `PROCEDURE ${nameTok.text} AT(...) must have no statements; body may only DECLARE its parameters`,
                        item.pos,
                    );
                }
            }
        }
        if (regs !== undefined && at === undefined) {
            throw new ParseError(`REGS requires AT(...) on procedure ${nameTok.text}`, nameTok.pos);
        }
        if (regs !== undefined && regs.length !== params.length) {
            throw new ParseError(
                `REGS has ${regs.length} registers but procedure ${nameTok.text} has ${params.length} parameters`,
                nameTok.pos,
            );
        }
        const proc: Proc = {
            kind: "proc",
            name: nameTok.text,
            params,
            body,
            pos: nameTok.pos,
        };
        if (returnType) proc.returnType = returnType;
        if (at !== undefined) proc.at = at;
        if (regs !== undefined) proc.regs = regs;
        return proc;
    }

    private declarations(out: Item[]): void {
        const kw = this.eatKw("DECLARE");
        const names: { name: string; pos: Pos }[] = [];
        if (this.isPunct("(")) {
            this.eatPunct("(");
            const first = this.eatIdent();
            names.push({ name: first.text, pos: first.pos });
            while (this.isPunct(",")) {
                this.eatPunct(",");
                const nx = this.eatIdent();
                names.push({ name: nx.text, pos: nx.pos });
            }
            this.eatPunct(")");
        } else {
            const first = this.eatIdent();
            names.push({ name: first.text, pos: first.pos });
        }
        const type = this.typeSpec();
        let initial: Expr[] | undefined;
        let at: number | undefined;
        if (this.isKw("AT")) {
            this.eatKw("AT");
            at = this.parseAtAddress(kw.pos);
            if (names.length > 1) {
                throw new ParseError(
                    `AT not allowed with multi-name DECLARE; declare names separately`,
                    kw.pos,
                );
            }
        }
        if (this.isKw("INITIAL")) {
            if (at !== undefined) throw new ParseError(`INITIAL cannot combine with AT`, kw.pos);
            this.eatKw("INITIAL");
            this.eatPunct("(");
            initial = [this.expression()];
            while (this.isPunct(",")) { this.eatPunct(","); initial.push(this.expression()); }
            this.eatPunct(")");
            if (names.length > 1) {
                throw new ParseError(
                    `INITIAL not allowed with multi-name DECLARE; declare names separately`,
                    kw.pos,
                );
            }
        }
        this.eatPunct(";");

        for (const n of names) {
            const base: Decl = { kind: "decl", name: n.name, type, pos: n.pos };
            if (initial) base.initial = initial;
            if (at !== undefined) base.at = at;
            out.push(base);
        }
    }

    private isBuiltin(name: string): boolean {
        return name === "LOW" || name === "HIGH" ||
            name === "SHR" || name === "SHL" ||
            name === "ROR" || name === "ROL";
    }

    private parseRegList(errPos: Pos): import("./ast.ts").ParamReg[] {
        this.eatPunct("(");
        const regs: import("./ast.ts").ParamReg[] = [];
        regs.push(this.parseReg(errPos));
        while (this.isPunct(",")) { this.eatPunct(","); regs.push(this.parseReg(errPos)); }
        this.eatPunct(")");
        return regs;
    }

    private parseReg(errPos: Pos): import("./ast.ts").ParamReg {
        const t = this.at();
        if (t.kind !== "ident") throw new ParseError(`expected register name`, t.pos);
        const name = t.text;
        const valid = ["A", "B", "C", "D", "E", "H", "L", "BC", "DE", "HL"];
        if (!valid.includes(name)) throw new ParseError(`'${name}' is not a valid register`, t.pos);
        this.i++;
        return name as import("./ast.ts").ParamReg;
    }

    private parseAtAddress(errPos: Pos): number {
        let hadParen = false;
        if (this.isPunct("(")) { this.eatPunct("("); hadParen = true; }
        const t = this.at();
        if (t.kind !== "number") throw new ParseError(`AT address must be a numeric literal`, t.pos);
        this.i++;
        if (hadParen) this.eatPunct(")");
        if (t.value === undefined) throw new ParseError(`AT address missing value`, errPos);
        return t.value;
    }

    private typeSpec(): PlmType {
        let element: "byte" | "word" | "address";
        if (this.isKw("BYTE")) { this.eatKw("BYTE"); element = "byte"; }
        else if (this.isKw("WORD")) { this.eatKw("WORD"); element = "word"; }
        else if (this.isKw("ADDRESS")) { this.eatKw("ADDRESS"); element = "address"; }
        else {
            const t = this.at();
            throw new ParseError(`expected BYTE/WORD/ADDRESS, got '${t.text}'`, t.pos);
        }
        if (this.isPunct("(")) {
            this.eatPunct("(");
            const size = this.at();
            if (size.kind !== "number") throw new ParseError(`array size must be a numeric literal`, size.pos);
            this.i++;
            this.eatPunct(")");
            return { kind: "array", element, size: size.value! };
        }
        return { kind: element };
    }

    private statement(): Stmt {
        const t = this.at();

        if (t.kind === "ident" && this.isPunct(":", 1) && !this.isKw("PROCEDURE", 2)) {
            this.i++;
            this.eatPunct(":");
            return { kind: "label", name: t.text, pos: t.pos };
        }

        if (this.isKw("IF")) return this.ifStmt();
        if (this.isKw("DO")) return this.doStmt();
        if (this.isKw("CALL")) return this.callStmt();
        if (this.isKw("RETURN")) return this.returnStmt();
        if (this.isKw("GO") || this.isKw("GOTO")) return this.gotoStmt();
        if (this.isPunct(";")) { this.i++; return { kind: "null", pos: t.pos }; }

        return this.assignStmt();
    }

    private ifStmt(): Stmt {
        const kw = this.eatKw("IF");
        const cond = this.expression();
        this.eatKw("THEN");
        const then = this.statement();
        let elseS: Stmt | undefined;
        if (this.isKw("ELSE")) { this.eatKw("ELSE"); elseS = this.statement(); }
        return { kind: "if", cond, then, ...(elseS ? { else: elseS } : {}), pos: kw.pos };
    }

    private doStmt(): Stmt {
        const kw = this.eatKw("DO");
        if (this.isKw("WHILE")) {
            this.eatKw("WHILE");
            const cond = this.expression();
            this.eatPunct(";");
            const body = this.doBody(kw.pos);
            return { kind: "while", cond, body, pos: kw.pos };
        }
        if (this.isKw("CASE")) {
            this.eatKw("CASE");
            const selector = this.expression();
            this.eatPunct(";");
            const cases: Stmt[] = [];
            while (!this.isKw("END")) {
                if (this.eof()) throw new ParseError(`unterminated DO CASE`, kw.pos);
                cases.push(this.statement());
            }
            this.eatKw("END");
            this.eatPunct(";");
            return { kind: "case", selector, cases, pos: kw.pos };
        }
        if (this.peek().kind === "ident" && this.isPunct("=", 1)) {
            const varTok = this.eatIdent();
            this.eatPunct("=");
            const from = this.expression();
            this.eatKw("TO");
            const to = this.expression();
            let step: Expr | undefined;
            if (this.isKw("BY")) { this.eatKw("BY"); step = this.expression(); }
            this.eatPunct(";");
            const body = this.doBody(kw.pos);
            const s: IterStmt = { kind: "iter", var: varTok.text, from, to, body, pos: kw.pos };
            if (step) s.step = step;
            return s;
        }
        this.eatPunct(";");
        const body = this.doBody(kw.pos);
        return { kind: "do", body, pos: kw.pos };
    }

    private doBody(startPos: Pos): Item[] {
        const body: Item[] = [];
        while (!this.isKw("END")) {
            if (this.eof()) throw new ParseError(`unterminated DO`, startPos);
            this.collectItem(body);
        }
        this.eatKw("END");
        this.eatPunct(";");
        return body;
    }

    private callStmt(): Stmt {
        const kw = this.eatKw("CALL");
        const name = this.eatIdent();
        const args: Expr[] = [];
        if (this.isPunct("(")) {
            this.eatPunct("(");
            if (!this.isPunct(")")) {
                args.push(this.expression());
                while (this.isPunct(",")) { this.eatPunct(","); args.push(this.expression()); }
            }
            this.eatPunct(")");
        }
        this.eatPunct(";");
        return { kind: "call", name: name.text, args, pos: kw.pos };
    }

    private returnStmt(): Stmt {
        const kw = this.eatKw("RETURN");
        let value: Expr | undefined;
        if (!this.isPunct(";")) value = this.expression();
        this.eatPunct(";");
        return { kind: "return", ...(value ? { value } : {}), pos: kw.pos };
    }

    private gotoStmt(): Stmt {
        const kw = this.at();
        if (this.isKw("GO")) { this.eatKw("GO"); this.eatKw("TO"); }
        else this.eatKw("GOTO");
        const label = this.eatIdent();
        this.eatPunct(";");
        return { kind: "goto", label: label.text, pos: kw.pos };
    }

    private assignStmt(): Stmt {
        const first = this.lvalue();
        const targets: LValue[] = [first];
        while (this.isPunct(",")) {
            this.eatPunct(",");
            targets.push(this.lvalue());
        }
        const eq = this.eatPunct("=");
        const value = this.expression();
        this.eatPunct(";");
        return { kind: "assign", targets, value, pos: eq.pos };
    }

    private lvalue(): LValue {
        const name = this.eatIdent();
        if (this.isPunct("(")) {
            this.eatPunct("(");
            const index = this.expression();
            this.eatPunct(")");
            return { kind: "index", name: name.text, index, pos: name.pos };
        }
        return { kind: "ref", name: name.text, pos: name.pos };
    }

    expression(): Expr { return this.orExpr(); }

    private orExpr(): Expr {
        let lhs = this.andExpr();
        while (this.isKw("OR") || this.isKw("XOR")) {
            const op = (this.at().keyword as "OR" | "XOR");
            const pos = this.at().pos;
            this.i++;
            const rhs = this.andExpr();
            lhs = { kind: "bin", op, lhs, rhs, pos };
        }
        return lhs;
    }

    private andExpr(): Expr {
        let lhs = this.notExpr();
        while (this.isKw("AND")) {
            const pos = this.at().pos;
            this.i++;
            const rhs = this.notExpr();
            lhs = { kind: "bin", op: "AND", lhs, rhs, pos };
        }
        return lhs;
    }

    private notExpr(): Expr {
        if (this.isKw("NOT")) {
            const pos = this.at().pos;
            this.i++;
            const arg = this.notExpr();
            return { kind: "un", op: "NOT", arg, pos };
        }
        return this.relExpr();
    }

    private relExpr(): Expr {
        const lhs = this.addExpr();
        const relOps: Record<string, BinOp> = { "=": "=", "<>": "<>", "<": "<", ">": ">", "<=": "<=", ">=": ">=" };
        const t = this.at();
        if (t.kind === "punct" && t.text in relOps) {
            const op = relOps[t.text]!;
            const pos = t.pos;
            this.i++;
            const rhs = this.addExpr();
            return { kind: "bin", op, lhs, rhs, pos };
        }
        return lhs;
    }

    private addExpr(): Expr {
        let lhs = this.mulExpr();
        while (this.isPunct("+") || this.isPunct("-")) {
            const op = (this.at().text as "+" | "-");
            const pos = this.at().pos;
            this.i++;
            const rhs = this.mulExpr();
            lhs = { kind: "bin", op, lhs, rhs, pos };
        }
        return lhs;
    }

    private mulExpr(): Expr {
        let lhs = this.unaryExpr();
        while (this.isPunct("*") || this.isPunct("/") || this.isKw("MOD")) {
            const op: BinOp = this.isKw("MOD") ? "MOD" : (this.at().text as "*" | "/");
            const pos = this.at().pos;
            this.i++;
            const rhs = this.unaryExpr();
            lhs = { kind: "bin", op, lhs, rhs, pos };
        }
        return lhs;
    }

    private unaryExpr(): Expr {
        if (this.isPunct("-")) {
            const pos = this.at().pos;
            this.i++;
            const arg = this.unaryExpr();
            return { kind: "un", op: "-", arg, pos };
        }
        if (this.isPunct("+")) {
            const pos = this.at().pos;
            this.i++;
            const arg = this.unaryExpr();
            return { kind: "un", op: "+", arg, pos };
        }
        return this.primary();
    }

    private primary(): Expr {
        const t = this.at();
        if (t.kind === "number") { this.i++; return { kind: "num", value: t.value!, pos: t.pos }; }
        if (t.kind === "string") { this.i++; return { kind: "str", value: t.text, pos: t.pos }; }
        if (this.isPunct(".")) {
            const dot = this.at();
            this.eatPunct(".");
            const id = this.eatIdent();
            return { kind: "addrOf", name: id.text, pos: dot.pos };
        }
        if (t.kind === "kw" && this.isBuiltin(t.text)) {
            const name = t.text as import("./ast.ts").BuiltinName;
            const pos = t.pos;
            this.i++;
            this.eatPunct("(");
            const args: Expr[] = [this.expression()];
            while (this.isPunct(",")) { this.eatPunct(","); args.push(this.expression()); }
            this.eatPunct(")");
            return { kind: "builtin", name, args, pos };
        }
        if (this.isPunct("(")) {
            this.eatPunct("(");
            const e = this.expression();
            this.eatPunct(")");
            return e;
        }
        if (t.kind === "ident") {
            this.i++;
            if (this.isPunct("(")) {
                this.eatPunct("(");
                const args: Expr[] = [];
                if (!this.isPunct(")")) {
                    args.push(this.expression());
                    while (this.isPunct(",")) { this.eatPunct(","); args.push(this.expression()); }
                }
                this.eatPunct(")");
                return { kind: "call", name: t.text, args, pos: t.pos };
            }
            return { kind: "ref", name: t.text, pos: t.pos };
        }
        throw new ParseError(`unexpected '${t.text}'`, t.pos);
    }
}
