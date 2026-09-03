import { cp, mkdir, writeFile, access } from "node:fs/promises";
await mkdir("docs", { recursive: true });
for (const file of ["index.html", "style.css", "app.mjs", "model.mjs", "worker.mjs"])
  await cp(`web/${file}`, `docs/${file}`);
await writeFile("docs/.nojekyll", "");
await access("docs/report.html");
console.log("Static dashboard built in docs/. Original report retained at docs/report.html.");
