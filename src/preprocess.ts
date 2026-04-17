import { tokenize } from "./lexer.ts";
import type { Token } from "./token.ts";

/*  Expand PL/M-80 LITERALLY macros at the token level.
    A declaration of the form

        DECLARE NAME LITERALLY 'replacement text';

    registers NAME -> tokens(replacement text) and is stripped from the
    output stream.  Subsequent occurrences of NAME as an identifier are
    replaced by the macro's tokens.  Nested macros are expanded
    recursively; self-references are guarded to prevent infinite loops. */

export function preprocess(tokens: Token[]): Token[] {
    const macros = new Map<string, Token[]>();
    const out: Token[] = [];

    let i = 0;
    while (i < tokens.length) {
        if (isLiterallyDecl(tokens, i)) {
            const name = tokens[i + 1]!.text;
            const body = tokens[i + 3]!.text;
            const bodyTokens = tokenize(body);
            bodyTokens.pop();
            macros.set(name, bodyTokens);
            i += 5;
            continue;
        }
        for (const et of expand(tokens[i]!, macros, new Set())) out.push(et);
        i++;
    }
    return out;
}

function isLiterallyDecl(tokens: Token[], i: number): boolean {
    return (
        tokens[i]?.kind === "kw" && tokens[i]!.keyword === "DECLARE" &&
        tokens[i + 1]?.kind === "ident" &&
        tokens[i + 2]?.kind === "kw" && tokens[i + 2]!.keyword === "LITERALLY" &&
        tokens[i + 3]?.kind === "string" &&
        tokens[i + 4]?.kind === "punct" && tokens[i + 4]!.text === ";"
    );
}

function expand(tok: Token, macros: Map<string, Token[]>, seen: Set<string>): Token[] {
    if (tok.kind !== "ident" || !macros.has(tok.text) || seen.has(tok.text)) {
        return [tok];
    }
    const body = macros.get(tok.text)!;
    const next = new Set(seen); next.add(tok.text);
    const result: Token[] = [];
    for (const bt of body) {
        for (const et of expand(bt, macros, next)) result.push(et);
    }
    return result;
}
