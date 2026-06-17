import * as fs from "node:fs/promises";
import * as path from "node:path";
import ts from "typescript";

const sourceDir = path.join("extensions", "pi-fusion");
const outputDir = path.join("dist", "extensions", "pi-fusion");

function rewriteLocalTsImports(code: string): string {
  return code.replace(/(from\s+["']\.\.?\/[^"']*)\.ts(["'])/g, "$1.js$2").replace(/(import\(\s*["']\.\.?\/[^"']*)\.ts(["']\s*\))/g, "$1.js$2");
}

await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const entries = await fs.readdir(sourceDir);
const tsFiles = entries.filter((entry) => entry.endsWith(".ts")).sort();

for (const file of tsFiles) {
  const sourcePath = path.join(sourceDir, file);
  const outputPath = path.join(outputDir, file.replace(/\.ts$/, ".js"));
  const source = await fs.readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      sourceMap: false,
    },
    reportDiagnostics: true,
  });

  const diagnostics = transpiled.diagnostics ?? [];
  if (diagnostics.length > 0) {
    const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
    throw new Error(message);
  }

  await fs.writeFile(outputPath, rewriteLocalTsImports(transpiled.outputText), "utf8");
}

console.log(`built ${tsFiles.length} extension files into ${outputDir}`);
