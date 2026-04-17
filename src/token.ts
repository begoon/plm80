export type Pos = { line: number; col: number; offset: number };

export const KEYWORDS = [
    "DECLARE", "PROCEDURE", "END", "IF", "THEN", "ELSE",
    "DO", "WHILE", "CASE", "CALL", "RETURN", "GO", "TO", "GOTO",
    "BYTE", "WORD", "ADDRESS", "LABEL",
    "BASED", "AT", "DATA", "INITIAL", "LITERALLY",
    "PUBLIC", "EXTERNAL", "REENTRANT", "INTERRUPT",
    "AND", "OR", "XOR", "NOT", "MOD",
    "PLUS", "MINUS", "EQ", "LT", "GT", "LE", "GE", "NE",
    "HIGH", "LOW",
    "STRUCTURE", "HALT", "ENABLE", "DISABLE",
] as const;

export type Keyword = (typeof KEYWORDS)[number];

export type TokenKind =
    | "kw"
    | "ident"
    | "number"
    | "string"
    | "punct"
    | "eof";

export type Token = {
    kind: TokenKind;
    text: string;
    keyword?: Keyword;
    value?: number;
    pos: Pos;
};
