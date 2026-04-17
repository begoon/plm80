import type { Pos } from "./token.ts";
import type {
    AssignStmt, Decl, Expr, IfStmt, Item, LValue, PlmType, Proc,
    Program, Stmt,
} from "./ast.ts";

export type ScalarKind = "byte" | "word" | "address";

export type ResolvedType =
    | { kind: "byte" }
    | { kind: "word" }
    | { kind: "address" }
    | { kind: "array"; element: ScalarKind; size: number }
    | { kind: "string"; length: number }
    | { kind: "proc"; params: ScalarKind[]; return?: ScalarKind };

export type Sym =
    | { kind: "var"; decl: Decl; storage: Storage }
    | { kind: "param"; decl: Decl; index: number; proc: Proc }
    | { kind: "proc"; proc: Proc; sig: ProcSig }
    | { kind: "label"; name: string; pos: Pos };

export type Storage = "global" | "local";

export type ProcSig = { params: ScalarKind[]; return?: ScalarKind };

export class Scope {
    private readonly table = new Map<string, Sym>();
    constructor(readonly parent: Scope | null, readonly kind: "global" | "proc") {}

    define(name: string, sym: Sym): Sym | null {
        const existing = this.table.get(name);
        if (existing) return existing;
        this.table.set(name, sym);
        return null;
    }
    lookupLocal(name: string): Sym | undefined { return this.table.get(name); }
    lookup(name: string): Sym | undefined {
        return this.table.get(name) ?? this.parent?.lookup(name);
    }
}

export type Resolution = {
    global: Scope;
    scopeOf: Map<Proc, Scope>;
    symOf: Map<Expr | LValue, Sym>;
    typeOf: Map<Expr, ResolvedType>;
    sigOf: Map<Proc, ProcSig>;
};

export class SemaError extends Error {
    constructor(message: string, readonly pos: Pos) {
        super(`${pos.line}:${pos.col}: ${message}`);
    }
}

export function analyze(program: Program): Resolution {
    const res: Resolution = {
        global: new Scope(null, "global"),
        scopeOf: new Map(),
        symOf: new Map(),
        typeOf: new Map(),
        sigOf: new Map(),
    };
    const a = new Analyzer(res);
    a.program(program);
    return res;
}

class Analyzer {
    constructor(private readonly res: Resolution) {}

    program(p: Program): void {
        this.hoistDecls(p.items, this.res.global, "global");
        for (const item of p.items) this.walkItem(item, this.res.global);
    }

    private hoistDecls(items: Item[], scope: Scope, storage: Storage): void {
        for (const item of items) {
            if (item.kind === "decl") this.defineVar(item, scope, storage);
            else if (item.kind === "proc") this.defineProc(item, scope);
            else if (item.kind === "label") this.defineLabel(item.name, item.pos, scope);
        }
    }

    private defineVar(d: Decl, scope: Scope, storage: Storage): void {
        const prev = scope.define(d.name, { kind: "var", decl: d, storage });
        if (prev) throw new SemaError(`duplicate declaration of '${d.name}'`, d.pos);
    }

    private defineLabel(name: string, pos: Pos, scope: Scope): void {
        const existing = scope.lookupLocal(name);
        if (existing && existing.kind !== "label") {
            throw new SemaError(`label '${name}' conflicts with existing declaration`, pos);
        }
        if (!existing) scope.define(name, { kind: "label", name, pos });
    }

    private defineProc(proc: Proc, parent: Scope): void {
        const procScope = new Scope(parent, "proc");
        this.res.scopeOf.set(proc, procScope);

        const paramKinds: (ScalarKind | undefined)[] = new Array(proc.params.length).fill(undefined);
        for (const item of proc.body) {
            if (item.kind !== "decl") continue;
            const idx = proc.params.indexOf(item.name);
            if (idx >= 0) {
                const k = scalarOf(item.type, item.pos, true);
                paramKinds[idx] = k;
            }
        }
        for (let i = 0; i < proc.params.length; i++) {
            const k = paramKinds[i];
            if (!k) throw new SemaError(`parameter '${proc.params[i]}' has no DECLARE in body of '${proc.name}'`, proc.pos);
        }

        for (const item of proc.body) {
            if (item.kind !== "decl") continue;
            const idx = proc.params.indexOf(item.name);
            if (idx >= 0) {
                const prev = procScope.define(item.name, {
                    kind: "param", decl: item, index: idx, proc,
                });
                if (prev) throw new SemaError(`duplicate parameter '${item.name}'`, item.pos);
            } else {
                this.defineVar(item, procScope, "local");
            }
        }
        for (const item of proc.body) {
            if (item.kind === "label") this.defineLabel(item.name, item.pos, procScope);
            else if (item.kind === "proc") {
                throw new SemaError(`nested procedures not supported in v0`, item.pos);
            }
        }

        const sig: ProcSig = proc.returnType
            ? { params: paramKinds as ScalarKind[], return: proc.returnType }
            : { params: paramKinds as ScalarKind[] };
        this.res.sigOf.set(proc, sig);

        const prev = parent.define(proc.name, { kind: "proc", proc, sig });
        if (prev) throw new SemaError(`duplicate declaration of '${proc.name}'`, proc.pos);
    }

    private walkItem(item: Item, scope: Scope): void {
        if (item.kind === "decl") {
            if (item.initial) {
                for (const e of item.initial) this.typeExpr(e, scope);
            }
            return;
        }
        if (item.kind === "proc") {
            const inner = this.res.scopeOf.get(item);
            if (!inner) throw new Error("internal: proc scope missing");
            for (const bodyItem of item.body) {
                if (bodyItem.kind === "decl") {
                    if (bodyItem.initial) {
                        for (const e of bodyItem.initial) this.typeExpr(e, inner);
                    }
                    continue;
                }
                this.walkStmt(bodyItem as Stmt, inner, item);
            }
            return;
        }
        this.walkStmt(item, scope, null);
    }

    private walkStmt(s: Stmt, scope: Scope, enclosingProc: Proc | null): void {
        switch (s.kind) {
            case "null": case "label": return;
            case "assign":
                this.checkAssign(s, scope);
                return;
            case "if":
                this.typeExpr(s.cond, scope);
                this.walkStmt(s.then, scope, enclosingProc);
                if (s.else) this.walkStmt(s.else, scope, enclosingProc);
                return;
            case "do":
            case "while":
                if (s.kind === "while") this.typeExpr(s.cond, scope);
                for (const it of s.body) {
                    if (it.kind === "decl") continue;
                    if (it.kind === "proc") throw new SemaError("nested procedures not supported in v0", it.pos);
                    this.walkStmt(it, scope, enclosingProc);
                }
                return;
            case "call": {
                const sym = scope.lookup(s.name);
                if (!sym) throw new SemaError(`undefined procedure '${s.name}'`, s.pos);
                if (sym.kind !== "proc") throw new SemaError(`'${s.name}' is not a procedure`, s.pos);
                if (sym.sig.params.length !== s.args.length) {
                    throw new SemaError(
                        `procedure '${s.name}' expects ${sym.sig.params.length} args, got ${s.args.length}`,
                        s.pos,
                    );
                }
                for (const a of s.args) this.typeExpr(a, scope);
                return;
            }
            case "return":
                if (!enclosingProc) {
                    if (s.value) throw new SemaError(`RETURN with value outside procedure`, s.pos);
                    return;
                }
                if (s.value) {
                    this.typeExpr(s.value, scope);
                    if (!enclosingProc.returnType) {
                        throw new SemaError(`procedure '${enclosingProc.name}' is typeless; RETURN must not have a value`, s.pos);
                    }
                } else if (enclosingProc.returnType) {
                    throw new SemaError(`procedure '${enclosingProc.name}' returns ${enclosingProc.returnType}; RETURN needs a value`, s.pos);
                }
                return;
            case "goto": {
                const sym = scope.lookup(s.label);
                if (!sym || sym.kind !== "label") {
                    throw new SemaError(`undefined label '${s.label}'`, s.pos);
                }
                return;
            }
        }
    }

    private checkAssign(s: AssignStmt, scope: Scope): void {
        for (const t of s.targets) {
            const sym = scope.lookup(t.name);
            if (!sym) throw new SemaError(`undefined variable '${t.name}'`, t.pos);
            if (sym.kind === "proc") throw new SemaError(`cannot assign to procedure '${t.name}'`, t.pos);
            if (sym.kind === "label") throw new SemaError(`cannot assign to label '${t.name}'`, t.pos);
            this.res.symOf.set(t, sym);
            if (t.kind === "index") {
                if (sym.decl.type.kind !== "array") {
                    throw new SemaError(`'${t.name}' is not an array`, t.pos);
                }
                this.typeExpr(t.index, scope);
            } else {
                if (sym.decl.type.kind === "array") {
                    throw new SemaError(`cannot assign to whole array '${t.name}'`, t.pos);
                }
            }
        }
        this.typeExpr(s.value, scope);
    }

    private typeExpr(e: Expr, scope: Scope): ResolvedType {
        const cached = this.res.typeOf.get(e);
        if (cached) return cached;
        const t = this.computeType(e, scope);
        this.res.typeOf.set(e, t);
        return t;
    }

    private computeType(e: Expr, scope: Scope): ResolvedType {
        switch (e.kind) {
            case "num":
                return e.value > 0xff ? { kind: "word" } : { kind: "byte" };
            case "str":
                return { kind: "string", length: e.value.length };
            case "ref": {
                const sym = scope.lookup(e.name);
                if (!sym) throw new SemaError(`undefined identifier '${e.name}'`, e.pos);
                this.res.symOf.set(e, sym);
                if (sym.kind === "label") throw new SemaError(`label '${e.name}' used as value`, e.pos);
                if (sym.kind === "proc") {
                    if (sym.sig.params.length !== 0) {
                        throw new SemaError(`procedure '${e.name}' expects arguments`, e.pos);
                    }
                    if (!sym.sig.return) throw new SemaError(`typeless procedure '${e.name}' has no value`, e.pos);
                    return { kind: sym.sig.return };
                }
                return toResolved(sym.decl.type);
            }
            case "index": {
                const sym = scope.lookup(e.name);
                if (!sym) throw new SemaError(`undefined identifier '${e.name}'`, e.pos);
                if (sym.kind !== "var" && sym.kind !== "param") {
                    throw new SemaError(`'${e.name}' is not indexable`, e.pos);
                }
                this.res.symOf.set(e, sym);
                if (sym.decl.type.kind !== "array") throw new SemaError(`'${e.name}' is not an array`, e.pos);
                this.typeExpr(e.index, scope);
                return { kind: sym.decl.type.element };
            }
            case "call": {
                const sym = scope.lookup(e.name);
                if (!sym) throw new SemaError(`undefined identifier '${e.name}'`, e.pos);
                this.res.symOf.set(e, sym);
                if (sym.kind === "var" || sym.kind === "param") {
                    if (sym.decl.type.kind !== "array") {
                        throw new SemaError(`'${e.name}' is not indexable`, e.pos);
                    }
                    if (e.args.length !== 1) {
                        throw new SemaError(`array '${e.name}' requires a single index`, e.pos);
                    }
                    this.typeExpr(e.args[0]!, scope);
                    return { kind: sym.decl.type.element };
                }
                if (sym.kind !== "proc") {
                    throw new SemaError(`'${e.name}' is not callable`, e.pos);
                }
                if (sym.sig.params.length !== e.args.length) {
                    throw new SemaError(
                        `procedure '${e.name}' expects ${sym.sig.params.length} args, got ${e.args.length}`,
                        e.pos,
                    );
                }
                for (const a of e.args) this.typeExpr(a, scope);
                if (!sym.sig.return) throw new SemaError(`typeless procedure '${e.name}' has no value`, e.pos);
                return { kind: sym.sig.return };
            }
            case "un":
                return this.typeExpr(e.arg, scope);
            case "bin": {
                const lt = this.typeExpr(e.lhs, scope);
                const rt = this.typeExpr(e.rhs, scope);
                switch (e.op) {
                    case "=": case "<>": case "<": case ">": case "<=": case ">=":
                        return { kind: "byte" };
                    default:
                        return promote(lt, rt, e.pos);
                }
            }
        }
    }
}

function scalarOf(t: PlmType, pos: Pos, allowScalarOnly: boolean): ScalarKind {
    if (t.kind === "array") {
        if (allowScalarOnly) throw new SemaError(`array not allowed here`, pos);
        return t.element;
    }
    return t.kind;
}

function toResolved(t: PlmType): ResolvedType {
    if (t.kind === "array") return { kind: "array", element: t.element, size: t.size };
    return { kind: t.kind };
}

function promote(l: ResolvedType, r: ResolvedType, pos: Pos): ResolvedType {
    const lk = scalarKindOf(l, pos);
    const rk = scalarKindOf(r, pos);
    if (lk === "word" || rk === "word") return { kind: "word" };
    if (lk === "address" || rk === "address") return { kind: "address" };
    return { kind: "byte" };
}

function scalarKindOf(t: ResolvedType, pos: Pos): ScalarKind {
    if (t.kind === "byte" || t.kind === "word" || t.kind === "address") return t.kind;
    throw new SemaError(`expected scalar, got ${t.kind}`, pos);
}
