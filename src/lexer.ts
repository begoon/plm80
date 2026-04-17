import { KEYWORDS, type Keyword, type Pos, type Token } from "./token.ts";

const KEYWORD_SET = new Set<string>(KEYWORDS);

export function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    let line = 1;
    let col = 1;

    const here = (): Pos => ({ line, col, offset: i });

    const advance = (n = 1): void => {
        for (let k = 0; k < n; k++) {
            if (source[i] === "\n") { line++; col = 1; }
            else col++;
            i++;
        }
    };

    while (i < source.length) {
        const c = source[i]!;

        if (c === " " || c === "\t" || c === "\r" || c === "\n") {
            advance();
            continue;
        }

        if (c === "/" && source[i + 1] === "*") {
            advance(2);
            while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) advance();
            if (i < source.length) advance(2);
            continue;
        }

        const start = here();

        if (isAlpha(c)) {
            let j = i;
            while (j < source.length && isIdent(source[j]!)) j++;
            const text = source.slice(i, j).toUpperCase();
            advance(j - i);
            if (KEYWORD_SET.has(text)) {
                tokens.push({ kind: "kw", text, keyword: text as Keyword, pos: start });
            } else {
                tokens.push({ kind: "ident", text, pos: start });
            }
            continue;
        }

        if (isDigit(c)) {
            let j = i;
            while (j < source.length && isHexDigit(source[j]!)) j++;
            let base = 10;
            let digEnd = j;
            let end = j;
            const next = source[j]?.toUpperCase();
            if (next === "H") { base = 16; end = j + 1; }
            else if (next === "O" || next === "Q") { base = 8; end = j + 1; }
            else {
                const last = source[j - 1]!.toUpperCase();
                if (last === "B") { base = 2; digEnd = j - 1; }
                else if (last === "D") { base = 10; digEnd = j - 1; }
            }
            const digits = source.slice(i, digEnd);
            const value = parseInt(digits, base);
            const text = source.slice(i, end);
            advance(end - i);
            tokens.push({ kind: "number", text, value, pos: start });
            continue;
        }

        if (c === "'") {
            advance();
            let text = "";
            while (i < source.length) {
                if (source[i] === "'") {
                    if (source[i + 1] === "'") { text += "'"; advance(2); continue; }
                    advance();
                    break;
                }
                text += source[i];
                advance();
            }
            tokens.push({ kind: "string", text, pos: start });
            continue;
        }

        const two = source.slice(i, i + 2);
        if (two === ":=" || two === "<>" || two === "<=" || two === ">=") {
            advance(2);
            tokens.push({ kind: "punct", text: two, pos: start });
            continue;
        }

        advance();
        tokens.push({ kind: "punct", text: c, pos: start });
    }

    tokens.push({ kind: "eof", text: "", pos: here() });
    return tokens;
}

function isAlpha(c: string): boolean {
    return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "$" || c === "_";
}
function isDigit(c: string): boolean { return c >= "0" && c <= "9"; }
function isHexDigit(c: string): boolean {
    return isDigit(c) || (c >= "A" && c <= "F") || (c >= "a" && c <= "f");
}
function isIdent(c: string): boolean { return isAlpha(c) || isDigit(c); }
