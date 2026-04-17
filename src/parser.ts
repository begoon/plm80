import type { Token } from "./token.ts";
import type { Program } from "./ast.ts";

export function parse(tokens: Token[]): Program {
    if (tokens.length === 0) throw new Error("no tokens");
    throw new Error("parser not implemented yet");
}
