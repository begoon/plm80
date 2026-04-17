import { tokenize } from "./lexer.ts";

function usage(): never {
    console.error("usage: bun run plm <input.plm> [-o <out.asm>] [--tokens]");
    process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length === 0) usage();

let input: string | undefined;
let output: string | undefined;
let dumpTokens = false;

for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o") { output = argv[++i]; }
    else if (a === "--tokens") { dumpTokens = true; }
    else if (a.startsWith("-")) { console.error(`unknown flag: ${a}`); usage(); }
    else { input = a; }
}

if (!input) usage();

const source = await Bun.file(input).text();
const tokens = tokenize(source);

if (dumpTokens) {
    for (const t of tokens) {
        console.log(`${t.pos.line}:${t.pos.col}\t${t.kind}\t${t.text}`);
    }
    process.exit(0);
}

if (!output) output = input.replace(/\.plm$/i, "") + ".asm";
console.error(`codegen not implemented; would write ${output}`);
process.exit(1);
