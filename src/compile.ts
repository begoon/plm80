import { tokenize } from "./lexer.ts";
import { preprocess } from "./preprocess.ts";
import { parse, ParseError } from "./parser.ts";
import { analyze, SemaError } from "./sema.ts";
import { generate, CodegenError, type CodegenOptions } from "./codegen.ts";

export interface CompileOptions extends CodegenOptions {}

export type CompileError = ParseError | SemaError | CodegenError;

// Pure, node-free entry point used by the browser playground. The CLI still
// has its own flag-parsing + fs flow in cli.ts; they share this function's
// stages via the imports above.
export function compile(source: string, opts: CompileOptions = {}): string {
    const tokens = preprocess(tokenize(source));
    const ast = parse(tokens);
    const res = analyze(ast);
    return generate(ast, res, opts);
}

export { ParseError, SemaError, CodegenError };
