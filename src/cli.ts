import { tokenize } from "./lexer.ts";
import { preprocess } from "./preprocess.ts";
import { parse, ParseError } from "./parser.ts";
import { analyze, SemaError } from "./sema.ts";
import { generate, CodegenError } from "./codegen.ts";

function usage(): never {
    console.error("usage: bun run plm <input.plm> [-o <out.asm>] [--tokens] [--ast] [--check] [--org <hex>] [--stack <hex>]");
    process.exit(2);
}

function parseAddr(v: string): number {
    const raw = v.replace(/h$/i, "").replace(/^0x/i, "");
    return parseInt(raw, 16);
}

const argv = process.argv.slice(2);
if (argv.length === 0) usage();

let input: string | undefined;
let output: string | undefined;
let dumpTokens = false;
let dumpAst = false;
let checkOnly = false;
let origin: number | undefined;
let stack: number | undefined;

for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o") { output = argv[++i]; }
    else if (a === "--tokens") { dumpTokens = true; }
    else if (a === "--ast") { dumpAst = true; }
    else if (a === "--check") { checkOnly = true; }
    else if (a === "--org") { const v = argv[++i]; if (!v) usage(); origin = parseAddr(v); }
    else if (a === "--stack") { const v = argv[++i]; if (!v) usage(); stack = parseAddr(v); }
    else if (a.startsWith("-")) { console.error(`unknown flag: ${a}`); usage(); }
    else { input = a; }
}

if (!input) usage();

const source = await Bun.file(input).text();
const tokens = preprocess(tokenize(source));

if (dumpTokens) {
    for (const t of tokens) {
        console.log(`${t.pos.line}:${t.pos.col}\t${t.kind}\t${t.text}`);
    }
    process.exit(0);
}

try {
    const ast = parse(tokens);
    if (dumpAst) {
        console.log(JSON.stringify(ast, null, 2));
        process.exit(0);
    }
    const res = analyze(ast);
    if (checkOnly) { process.exit(0); }
    const cgOpts: { origin?: number; stack?: number } = {};
    if (origin !== undefined) cgOpts.origin = origin;
    if (stack !== undefined) cgOpts.stack = stack;
    const asm = generate(ast, res, cgOpts);
    if (!output) output = input.replace(/\.plm$/i, "") + ".asm";
    await Bun.write(output, asm);
    process.exit(0);
} catch (e) {
    if (e instanceof ParseError || e instanceof SemaError || e instanceof CodegenError) {
        console.error(`${input}:${e.message}`);
        process.exit(1);
    }
    throw e;
}
