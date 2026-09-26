// .railwayignore decides what reaches the Railway build context. Railway reads it
// with gitignore semantics, so a bare name matches a directory of that name at ANY
// depth. A bare `recorder` once stripped src/app/api/recorder along with the
// top-level Electron app, and every /api/recorder/* route 404'd in production.
//
// The file is judged by git itself: it is copied into a scratch repo as its
// .gitignore and each path is put to `git check-ignore`, so the test measures the
// same rules Railway applies rather than a hand-rolled matcher.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let repo: string;

function isIgnored(p: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: repo });
    return true;
  } catch (err) {
    // Exit 1 means "not ignored"; anything else is a real failure.
    if ((err as { status?: number }).status === 1) return false;
    throw err;
  }
}

describe(".railwayignore", () => {
  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "railwayignore-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const rules = readFileSync(path.resolve(__dirname, "../../.railwayignore"), "utf8");
    writeFileSync(path.join(repo, ".gitignore"), rules);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("ships the server recorder routes", () => {
    for (const route of ["session", "live", "token", "upload", "finalize"]) {
      expect(isIgnored(`src/app/api/recorder/${route}/route.ts`), route).toBe(false);
    }
  });

  it("keeps the desktop Electron recorder out of the build", () => {
    expect(isIgnored("recorder/package.json")).toBe(true);
    expect(isIgnored("recorder/src/main.ts")).toBe(true);
  });
});
