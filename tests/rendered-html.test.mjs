import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished image workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>图片尺寸与文案检查<\/title>/);
  assert.doesNotMatch(html, /\u56fe\u51c6/);
  assert.match(html, /尺寸统一，/);
  assert.match(html, /重复文案一眼看见。/);
  assert.match(html, /800 × 800/);
  assert.match(html, /1000 × 1000/);
  assert.match(html, /不上传图片 · 不保存记录/);
  assert.match(html, /property="og:image" content="http:\/\/localhost:3000\/og.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("keeps processing local and includes the required safety flow", async () => {
  const [page, layout, css, packageJson, og] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    stat(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(page, /showDirectoryPicker/);
  assert.match(page, /startIn:\s*"desktop"/);
  assert.match(page, /mode:\s*"readwrite"/);
  assert.match(page, /queryPermission\(\{ mode: "readwrite" \}\)/);
  assert.doesNotMatch(page, /requestPermission/);
  assert.doesNotMatch(page, /mode:\s*"read",/);
  assert.doesNotMatch(page, /indexedDB/);
  assert.match(page, /createWritable/);
  assert.match(page, /文件夹编辑权限已失效，没有覆盖任何图片/);
  const permissionCheckIndex = page.indexOf("if (!(await hasWritePermission()))");
  const firstWriteIndex = page.indexOf("const writable = await job.handle.createWritable()");
  assert.ok(permissionCheckIndex >= 0);
  assert.ok(firstWriteIndex > permissionCheckIndex);
  assert.match(page, /createImageBitmap/);
  assert.match(page, /await import\("tesseract\.js"\)/);
  assert.match(page, /\["chi_sim", "eng"\]/);
  assert.match(page, /bigramDice/);
  assert.match(page, /similarity >= 0\.85/);
  assert.match(page, /仍然覆盖/);
  assert.match(page, /MAX_DIMENSION = 8192/);
  assert.match(layout, /\/og\.png/);
  assert.match(css, /backdrop-filter:\s*blur\(28px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /prefers-reduced-transparency:\s*reduce/);
  assert.match(packageJson, /"tesseract\.js": "\^7\.0\.0"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.ok(og.size > 100_000);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("builds the GitHub Pages app at the repository base path", async () => {
  const [html, config, workflow, readme, og] = await Promise.all([
    readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../vite.github-pages.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    stat(new URL("../dist-pages/og.png", import.meta.url)),
  ]);

  assert.match(html, /<title>图片尺寸与文案检查<\/title>/);
  assert.match(html, /\/Size-modification\/assets\//);
  assert.match(config, /base:\s*"\/Size-modification\/"/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(readme, /https:\/\/bigrooo\.github\.io\/Size-modification\//);
  assert.ok(og.size > 100_000);
});
