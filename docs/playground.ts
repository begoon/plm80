import { asm, AsmError, type Section } from "asm8080";
import { compile, ParseError, SemaError, CodegenError } from "../src/compile.ts";
import { BUILD_TIME } from "./build-info.ts";

// The "Example" dropdown is populated from a runtime-loaded manifest.
// docs/examples.js defines `window.plm80Examples` as
// `[{ name, filename }, ...]` and is loaded by a classic `<script>` tag
// before this module runs. Each entry's `source` is a Promise kicked off
// immediately so tab-switching feels instant.
interface Example {
    name: string;
    filename: string;
    source: Promise<string>;
    resolvedSource?: string;
}
interface ExampleManifestEntry {
    name: string;
    filename: string;
}
declare global {
    interface Window {
        plm80Examples?: ExampleManifestEntry[];
        plm80EmulatorUrl?: string;
    }
}

const fetchExample = (f: string): Promise<string> =>
    fetch(`examples/${f}`).then((r) => r.text());

const EXAMPLES: Example[] = (window.plm80Examples ?? []).map((e) => {
    const ex: Example = {
        name: e.name,
        filename: e.filename,
        source: fetchExample(e.filename),
    };
    ex.source.then(
        (s) => {
            ex.resolvedSource = s;
            renderTabs();
        },
        () => {},
    );
    return ex;
});

function tabMatchesExample(t: Tab): boolean {
    const ex = EXAMPLES.find((e) => e.filename === t.filename);
    return !!ex && ex.resolvedSource === t.source;
}

const TABS_KEY = "plm80-playground:tabs";
const ACTIVE_KEY = "plm80-playground:active";
const THEME_KEY = "plm80-playground:theme";
const FORMAT_KEY = "plm80-playground:format";
const ORG_KEY = "plm80-playground:org";
const STACK_KEY = "plm80-playground:stack";
const DEFAULT_FILENAME = "program.plm";
const DEFAULT_ORG = "0";
const DEFAULT_STACK = "76CFh";

type OutputFormat = "plm" | "asm" | "bin" | "rk" | "rkr" | "pki" | "gam";
const OUTPUT_FORMATS: readonly OutputFormat[] = ["plm", "asm", "bin", "rk", "rkr", "pki", "gam"];
const DEFAULT_FORMAT: OutputFormat = "plm";

interface Tab {
    filename: string;
    source: string;
}

let tabs: Tab[] = [];
let active = 0;

type Theme = "dark" | "light";

function applyTheme(t: Theme) {
    document.body.classList.toggle("theme-light", t === "light");
}

function loadTheme(): Theme {
    try {
        return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch {
        return "light";
    }
}

function saveTheme(t: Theme) {
    try {
        localStorage.setItem(THEME_KEY, t);
    } catch {}
}

const source = document.getElementById("source") as HTMLTextAreaElement;
const asmOut = document.getElementById("asm") as HTMLPreElement;
const bytesOut = document.getElementById("bytes") as HTMLPreElement;
const bytesTitle = document.getElementById("bytes-title") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
const select = document.getElementById("example") as HTMLSelectElement;
const confirmModal = document.getElementById("confirm-modal") as HTMLDivElement;
const confirmMessage = document.getElementById("confirm-message") as HTMLParagraphElement;
const confirmOk = document.getElementById("confirm-ok") as HTMLButtonElement;
const confirmCancel = document.getElementById("confirm-cancel") as HTMLButtonElement;
const uploadBtn = document.getElementById("upload-btn") as HTMLButtonElement;
const downloadBtn = document.getElementById("download-btn") as HTMLButtonElement;
const downloadFormatSel = document.getElementById("download-format") as HTMLSelectElement;
const runBinBtn = document.getElementById("run-bin") as HTMLButtonElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const themeBtn = document.getElementById("theme") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const filenameInput = document.getElementById("filename") as HTMLInputElement;
const orgInput = document.getElementById("org") as HTMLInputElement;
const stackInput = document.getElementById("stack") as HTMLInputElement;
const tabsEl = document.getElementById("tabs") as HTMLDivElement;

function plmName(): string {
    return filenameInput.value.trim() || DEFAULT_FILENAME;
}

function stem(name: string): string {
    return name.replace(/\.[^.]*$/, "") || name;
}

function outputName(format: OutputFormat): string {
    return `${stem(plmName())}.${format}`;
}

// Ported from asm8 playground: two-byte (big-endian) checksum used in the
// Radio-86RK tape file formats.
function rk86CheckSum(v: number[] | Uint8Array): number {
    let sum = 0;
    let j = 0;
    while (j < v.length - 1) {
        const c = v[j]!;
        sum = (sum + c + (c << 8)) & 0xffff;
        j += 1;
    }
    const sum_h = sum & 0xff00;
    const sum_l = sum & 0xff;
    sum = sum_h | ((sum_l + v[j]!) & 0xff);
    return sum;
}

// Produce the output covering min(start)..max(end) of the sections.
// Gaps are zero-filled; origin is encoded in the tape header.
//   bin        -> raw payload
//   rk, rkr    -> [start_hi, start_lo, end_hi, end_lo] + payload + [E6, cs_hi, cs_lo]
//   pki, gam   -> leading E6 sync byte + the rk layout
function buildOutputFile(sections: Section[], format: OutputFormat): Uint8Array {
    if (sections.length === 0) return new Uint8Array(0);
    const start = sections.reduce((m, s) => Math.min(m, s.start), Infinity);
    const end = sections.reduce((m, s) => Math.max(m, s.end), 0);
    const size = end - start + 1;
    const payload = new Uint8Array(size);
    for (const s of sections) payload.set(s.data, s.start - start);
    if (format === "bin") return payload;
    const hasSync = format === "pki" || format === "gam";
    const headerLen = hasSync ? 5 : 4;
    const out = new Uint8Array(headerLen + size + 3);
    let o = 0;
    if (hasSync) out[o++] = 0xe6;
    out[o++] = (start >> 8) & 0xff;
    out[o++] = start & 0xff;
    out[o++] = (end >> 8) & 0xff;
    out[o++] = end & 0xff;
    out.set(payload, o);
    o += size;
    const checksum = rk86CheckSum(payload);
    out[o++] = 0xe6;
    out[o++] = (checksum >> 8) & 0xff;
    out[o++] = checksum & 0xff;
    return out;
}

for (const ex of EXAMPLES) {
    const opt = document.createElement("option");
    opt.value = ex.name;
    opt.textContent = ex.name;
    select.appendChild(opt);
}

select.addEventListener("change", async () => {
    const ex = EXAMPLES.find((e) => e.name === select.value);
    if (!ex) return;
    const exSource = await ex.source;
    tabs[active]!.source = source.value;
    const uniqueName = uniqueFilename(ex.filename);
    tabs.push({ filename: uniqueName, source: exSource });
    active = tabs.length - 1;
    source.value = exSource;
    filenameInput.value = uniqueName;
    lastGoodName = uniqueName;
    source.scrollTop = 0;
    saveTabs();
    renderTabs();
    onChange();
    source.focus();
});

function uniqueFilename(base: string): string {
    if (!tabs.some((t, i) => i !== active && t.filename === base)) return base;
    const m = base.match(/^(.*?)(\.[^.]*)?$/);
    const s = m ? m[1]! : base;
    const ext = m && m[2] ? m[2] : "";
    let n = 2;
    while (tabs.some((t, i) => i !== active && t.filename === `${s}-${n}${ext}`)) n++;
    return `${s}-${n}${ext}`;
}

function deselectExample() {
    if (select.value) select.value = "";
}

source.addEventListener("input", deselectExample);
filenameInput.addEventListener("input", deselectExample);

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function hex2(n: number): string {
    return n.toString(16).toUpperCase().padStart(2, "0");
}

function hex4(n: number): string {
    return n.toString(16).toUpperCase().padStart(4, "0");
}

// Format bytes as a hexdump with ASCII gutter, starting at `base`.
function formatBytes(data: Uint8Array, base: number): string {
    const perRow = 16;
    const rows: string[] = [];
    for (let i = 0; i < data.length; i += perRow) {
        const chunk = data.slice(i, i + perRow);
        const hex = Array.from(chunk).map(hex2).join(" ").padEnd(perRow * 3 - 1, " ");
        let ascii = "";
        for (const b of chunk) ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
        rows.push(
            `<span class="addr">${hex4(base + i)}</span>  ` +
            `<span class="byte">${esc(hex)}</span>  ` +
            `<span class="ascii">${esc(ascii)}</span>`,
        );
    }
    return rows.join("\n");
}

let confirmResolver: ((ok: boolean) => void) | null = null;

function askConfirm(message: string): Promise<boolean> {
    confirmMessage.textContent = message;
    confirmModal.hidden = false;
    confirmOk.focus();
    return new Promise((resolve) => {
        confirmResolver = resolve;
    });
}

function closeConfirm(result: boolean) {
    confirmModal.hidden = true;
    const r = confirmResolver;
    confirmResolver = null;
    if (r) r(result);
}

confirmOk.addEventListener("click", () => closeConfirm(true));
confirmCancel.addEventListener("click", () => closeConfirm(false));
confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) closeConfirm(false);
});

window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !confirmModal.hidden) closeConfirm(false);
    if (e.key === "Enter" && !confirmModal.hidden) {
        e.preventDefault();
        closeConfirm(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        if (runBinBtn.disabled) return;
        e.preventDefault();
        runBinBtn.click();
    }
});

// `[hex]` or `[hex]h` or `0x[hex]`; empty string returns undefined (use
// compiler default). Returns `null` on parse failure so the UI can surface it.
function parseHex(raw: string): number | undefined | null {
    const v = raw.trim();
    if (!v) return undefined;
    const m = v.match(/^0x([0-9a-f]+)$|^([0-9a-f]+)h?$/i);
    if (!m) return null;
    return parseInt(m[1] ?? m[2]!, 16);
}

let lastAsm: string | null = null;
let lastSections: Section[] | null = null;

function setError(msg: string) {
    errorEl.textContent = msg;
    errorEl.classList.add("visible");
}

function clearError() {
    errorEl.textContent = "";
    errorEl.classList.remove("visible");
}

function formatCompileError(e: unknown, file: string): string {
    if (e instanceof ParseError || e instanceof SemaError || e instanceof CodegenError) {
        return `${file}:${e.message}`;
    }
    if (e instanceof AsmError) {
        return `assembler line ${e.line}: ${e.message}`;
    }
    return (e as Error).message ?? String(e);
}

function runPipeline() {
    const src = source.value;
    const file = plmName();

    const org = parseHex(orgInput.value);
    const sp = parseHex(stackInput.value);
    if (org === null) {
        setError(`org: invalid hex value '${orgInput.value}'`);
        lastAsm = null;
        lastSections = null;
        asmOut.textContent = "";
        bytesOut.innerHTML = "";
        bytesTitle.textContent = "bytes";
        updateDownloadEnabled();
        runBinBtn.disabled = true;
        return;
    }
    if (sp === null) {
        setError(`sp: invalid hex value '${stackInput.value}'`);
        lastAsm = null;
        lastSections = null;
        asmOut.textContent = "";
        bytesOut.innerHTML = "";
        bytesTitle.textContent = "bytes";
        updateDownloadEnabled();
        runBinBtn.disabled = true;
        return;
    }

    const opts: { origin?: number; stack?: number } = {};
    if (org !== undefined) opts.origin = org;
    if (sp !== undefined) opts.stack = sp;

    let asmText: string;
    try {
        asmText = compile(src, opts);
    } catch (e) {
        lastAsm = null;
        lastSections = null;
        asmOut.textContent = "";
        bytesOut.innerHTML = "";
        bytesTitle.textContent = "bytes";
        setError(formatCompileError(e, file));
        updateDownloadEnabled();
        runBinBtn.disabled = true;
        return;
    }
    lastAsm = asmText;
    asmOut.textContent = asmText;

    try {
        lastSections = asm(asmText);
    } catch (e) {
        lastSections = null;
        bytesOut.innerHTML = "";
        bytesTitle.textContent = "bytes";
        setError(formatCompileError(e, file));
        updateDownloadEnabled();
        runBinBtn.disabled = true;
        return;
    }

    clearError();
    const sec = lastSections[0];
    if (!sec) {
        bytesOut.innerHTML = "";
        bytesTitle.textContent = "bytes (empty)";
    } else {
        const bytes = Uint8Array.from(sec.data);
        bytesOut.innerHTML = formatBytes(bytes, sec.start);
        const span = sec.end - sec.start + 1;
        bytesTitle.textContent = `bytes — ${hex4(sec.start)}..${hex4(sec.end)} (${span} B)`;
    }
    updateDownloadEnabled();
    runBinBtn.disabled = !lastSections || lastSections.length === 0;
}

function saveTabs() {
    try {
        localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
        localStorage.setItem(ACTIVE_KEY, String(active));
    } catch {}
}

function save() {
    tabs[active]!.source = source.value;
    saveTabs();
}

function renderTabs() {
    tabsEl.innerHTML = "";
    tabs.forEach((t, i) => {
        const el = document.createElement("div");
        const live = i === active ? source.value : t.source;
        const matches = tabMatchesExample({ filename: t.filename, source: live });
        el.className = "tab" + (i === active ? " active" : "") + (matches ? " example" : " modified");
        el.title = t.filename;
        const name = document.createElement("span");
        name.textContent = t.filename || "(untitled)";
        el.appendChild(name);
        const close = document.createElement("button");
        close.type = "button";
        close.className = "close";
        close.textContent = "×";
        close.title = "close tab";
        close.addEventListener("click", (e) => {
            e.stopPropagation();
            void closeTab(i);
        });
        el.appendChild(close);
        el.addEventListener("click", () => switchTab(i));
        tabsEl.appendChild(el);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "tab-add";
    add.textContent = "+";
    add.title = "new tab";
    add.addEventListener("click", () => newTab());
    tabsEl.appendChild(add);
}

function nextUntitled(): string {
    let n = 1;
    while (tabs.some((t) => t.filename === `untitled-${n}.plm`)) n++;
    return `untitled-${n}.plm`;
}

function switchTab(i: number) {
    if (i === active || i < 0 || i >= tabs.length) return;
    tabs[active]!.source = source.value;
    active = i;
    source.value = tabs[active]!.source;
    filenameInput.value = tabs[active]!.filename;
    lastGoodName = tabs[active]!.filename;
    source.scrollTop = 0;
    saveTabs();
    renderTabs();
    deselectExample();
    runPipeline();
    source.focus();
}

function newTab() {
    tabs[active]!.source = source.value;
    tabs.push({ filename: nextUntitled(), source: "" });
    active = tabs.length - 1;
    source.value = "";
    filenameInput.value = tabs[active]!.filename;
    lastGoodName = tabs[active]!.filename;
    source.scrollTop = 0;
    saveTabs();
    renderTabs();
    deselectExample();
    runPipeline();
    source.focus();
}

async function closeTab(i: number) {
    const current = i === active ? source.value : tabs[i]!.source;
    const matchesExample = tabMatchesExample({
        filename: tabs[i]!.filename,
        source: current,
    });
    if (current.trim().length > 0 && !matchesExample) {
        const ok = await askConfirm(`Close "${tabs[i]!.filename}"? Its content will be lost.`);
        if (!ok) return;
    }
    if (tabs.length === 1) {
        tabs[0] = { filename: DEFAULT_FILENAME, source: "" };
        active = 0;
        source.value = "";
        filenameInput.value = tabs[0]!.filename;
        lastGoodName = tabs[0]!.filename;
    } else {
        tabs.splice(i, 1);
        if (active > i) active--;
        else if (active === i && active >= tabs.length) active = tabs.length - 1;
        source.value = tabs[active]!.source;
        filenameInput.value = tabs[active]!.filename;
        lastGoodName = tabs[active]!.filename;
    }
    saveTabs();
    renderTabs();
    deselectExample();
    runPipeline();
}

let lastGoodName = "";
filenameInput.addEventListener("focus", () => {
    lastGoodName = filenameInput.value;
});
filenameInput.addEventListener("input", () => {
    tabs[active]!.filename = filenameInput.value;
    saveTabs();
    renderTabs();
});
filenameInput.addEventListener("change", () => {
    const val = filenameInput.value.trim();
    const dup = tabs.findIndex((t, i) => i !== active && t.filename === val);
    if (!val || dup !== -1) {
        if (dup !== -1) alert(`A tab named "${val}" already exists.`);
        filenameInput.value = lastGoodName;
        tabs[active]!.filename = lastGoodName;
    } else {
        filenameInput.value = val;
        tabs[active]!.filename = val;
        lastGoodName = val;
    }
    saveTabs();
    renderTabs();
});

function onChange() {
    save();
    runPipeline();
    renderTabs();
}

source.addEventListener("input", onChange);

function saveOrgStack() {
    try {
        localStorage.setItem(ORG_KEY, orgInput.value);
        localStorage.setItem(STACK_KEY, stackInput.value);
    } catch {}
}

orgInput.addEventListener("input", () => {
    saveOrgStack();
    runPipeline();
});
stackInput.addEventListener("input", () => {
    saveOrgStack();
    runPipeline();
});

function downloadBlob(data: BlobPart, name: string, type: string) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function findOverlap(sections: Section[]): [Section, Section] | null {
    const sorted = [...sections].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.start <= sorted[i - 1]!.end) return [sorted[i - 1]!, sorted[i]!];
    }
    return null;
}

function buildBinary(format: Exclude<OutputFormat, "plm" | "asm">): Uint8Array | null {
    if (!lastSections || lastSections.length === 0) return null;
    const overlap = findOverlap(lastSections);
    if (overlap) {
        const [a, b] = overlap;
        alert(`sections overlap: ${hex4(a.start)}-${hex4(a.end)} and ${hex4(b.start)}-${hex4(b.end)}`);
        return null;
    }
    return buildOutputFile(lastSections, format);
}

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return btoa(s);
}

function loadFormat(): OutputFormat {
    try {
        const v = localStorage.getItem(FORMAT_KEY);
        if (v && (OUTPUT_FORMATS as readonly string[]).includes(v)) {
            return v as OutputFormat;
        }
    } catch {}
    return DEFAULT_FORMAT;
}

function saveFormat(f: OutputFormat) {
    try {
        localStorage.setItem(FORMAT_KEY, f);
    } catch {}
}

function selectedFormat(): OutputFormat {
    return downloadFormatSel.value as OutputFormat;
}

// .plm is always available (downloads source); .asm requires a successful
// compile; binary formats additionally need a successful assembly.
function updateDownloadEnabled() {
    const fmt = selectedFormat();
    if (fmt === "plm") {
        downloadBtn.disabled = false;
        return;
    }
    if (fmt === "asm") {
        downloadBtn.disabled = lastAsm === null;
        return;
    }
    downloadBtn.disabled = !lastSections || lastSections.length === 0;
}

downloadFormatSel.value = loadFormat();
updateDownloadEnabled();
downloadFormatSel.addEventListener("change", () => {
    saveFormat(selectedFormat());
    updateDownloadEnabled();
});

downloadBtn.addEventListener("click", () => {
    const fmt = selectedFormat();
    if (fmt === "plm") {
        downloadBlob(source.value, plmName(), "text/plain");
        return;
    }
    if (fmt === "asm") {
        if (lastAsm === null) return;
        downloadBlob(lastAsm, outputName("asm"), "text/plain");
        return;
    }
    const data = buildBinary(fmt);
    if (!data) return;
    downloadBlob(data, outputName(fmt), "application/octet-stream");
});

// Same handoff protocol as the asm8 playground:
// - same-origin: stash the .rk data-URL in localStorage under
//   `plm80-handoff:<uuid>` and open the emulator with `?handoff=<uuid>`.
//   The emulator's boot reads and deletes the key once. Dodges Chrome's
//   ~2 MB URL-length cap.
// - cross-origin (default rk86.ru): fall back to `?run=<dataUrl>`.
const EMULATOR_URL_DEFAULT = "https://rk86.ru/beta/index.html";
const EMULATOR_URL = window.plm80EmulatorUrl ?? EMULATOR_URL_DEFAULT;

const HANDOFF_PREFIX = "plm80-handoff:";
const HANDOFF_TTL_MS = 60 * 60 * 1000;

function sweepStaleHandoffs() {
    try {
        const now = Date.now();
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(HANDOFF_PREFIX)) continue;
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            try {
                const { ts } = JSON.parse(raw) as { ts?: number };
                if (!ts || now - ts > HANDOFF_TTL_MS) localStorage.removeItem(key);
            } catch {
                localStorage.removeItem(key);
            }
        }
    } catch {}
}

function newHandoffId(): string {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

runBinBtn.addEventListener("click", () => {
    const rk = buildBinary("rk");
    if (!rk) return;
    const target = new URL(EMULATOR_URL, location.href);
    const dataUrl = `data:;name=${outputName("rk")};base64,${toBase64(rk)}`;

    if (target.origin === location.origin) {
        sweepStaleHandoffs();
        const id = newHandoffId();
        try {
            localStorage.setItem(HANDOFF_PREFIX + id, JSON.stringify({ ts: Date.now(), url: dataUrl }));
        } catch (e) {
            alert(`localStorage unavailable, cannot hand off to emulator: ${(e as Error).message}`);
            return;
        }
        target.searchParams.set("handoff", id);
    } else {
        target.searchParams.set("run", dataUrl);
    }
    window.open(target.toString(), "_blank", "noopener");
});

uploadBtn.addEventListener("click", () => fileInput.click());

resetBtn.addEventListener("click", async () => {
    const ok = await askConfirm("Reset the current tab to the first example? This replaces its content.");
    if (!ok) return;
    const def = EXAMPLES[0];
    if (!def) return;
    const defSource = await def.source;
    const uniqueName = uniqueFilename(def.filename);
    tabs[active] = { filename: uniqueName, source: defSource };
    source.value = defSource;
    filenameInput.value = uniqueName;
    lastGoodName = uniqueName;
    select.value = def.name;
    source.scrollTop = 0;
    saveTabs();
    renderTabs();
    onChange();
    source.focus();
});

fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const text = await f.text();
    const uniqueName = uniqueFilename(f.name);
    tabs.push({ filename: uniqueName, source: text });
    active = tabs.length - 1;
    source.value = text;
    filenameInput.value = uniqueName;
    lastGoodName = uniqueName;
    source.scrollTop = 0;
    fileInput.value = "";
    saveTabs();
    renderTabs();
    onChange();
    source.focus();
});

const buildTimeEl = document.getElementById("build-time");
if (buildTimeEl && BUILD_TIME) buildTimeEl.textContent = BUILD_TIME;

themeBtn.addEventListener("click", () => {
    const next: Theme = document.body.classList.contains("theme-light") ? "dark" : "light";
    applyTheme(next);
    saveTheme(next);
});

applyTheme(loadTheme());

function loadOrgStack() {
    try {
        orgInput.value = localStorage.getItem(ORG_KEY) ?? DEFAULT_ORG;
        stackInput.value = localStorage.getItem(STACK_KEY) ?? DEFAULT_STACK;
    } catch {
        orgInput.value = DEFAULT_ORG;
        stackInput.value = DEFAULT_STACK;
    }
}

async function loadTabsFromStorage(): Promise<void> {
    try {
        const raw = localStorage.getItem(TABS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                tabs = parsed.map((t) => ({
                    filename: String(t.filename ?? DEFAULT_FILENAME),
                    source: String(t.source ?? ""),
                }));
                const a = Number(localStorage.getItem(ACTIVE_KEY) ?? 0) | 0;
                active = a < 0 || a >= tabs.length ? 0 : a;
                return;
            }
        }
    } catch {}
    const src = (await EXAMPLES[0]?.source) ?? "";
    const name = EXAMPLES[0]?.filename ?? DEFAULT_FILENAME;
    tabs = [{ filename: name, source: src }];
    active = 0;
    saveTabs();
}

(async () => {
    loadOrgStack();
    await loadTabsFromStorage();
    source.value = tabs[active]!.source;
    filenameInput.value = tabs[active]!.filename;
    lastGoodName = tabs[active]!.filename;
    renderTabs();
    onChange();
})();
