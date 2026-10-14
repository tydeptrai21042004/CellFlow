#!/usr/bin/env node
/** Vercel workspace install: fail closed on broken locks; allow bootstrap without one. */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function selectInstall({ packageLock = false, shrinkwrap = false, lockValid = true } = {}) {
  if (packageLock || shrinkwrap) {
    if (!lockValid) throw new Error("Existing npm lockfile is invalid; refusing unlocked fallback");
    return { command: "npm", args: ["ci", "--no-audit", "--no-fund"], mode: "locked" };
  }
  return {
    command: "npm", args: ["install", "--no-audit", "--no-fund", "--package-lock=false"], mode: "unlocked-bootstrap",
  };
}

function validateLock(path) {
  try {
    const lock = JSON.parse(readFileSync(path, "utf8"));
    return Number.isInteger(lock.lockfileVersion) && lock.lockfileVersion >= 2 &&
      lock.name === "cellflow" && Boolean(lock.packages?.[""]);
  } catch { return false; }
}

export function main() {
  const pkg = join(root, "package-lock.json");
  const shrink = join(root, "npm-shrinkwrap.json");
  const hasPackageLock = existsSync(pkg);
  const hasShrinkwrap = existsSync(shrink);
  if (hasPackageLock && hasShrinkwrap) {
    console.error("CellFlow install: remove one of package-lock.json / npm-shrinkwrap.json");
    return 1;
  }
  let plan;
  try {
    plan = selectInstall({
      packageLock: hasPackageLock,
      shrinkwrap: hasShrinkwrap,
      lockValid: !(hasPackageLock || hasShrinkwrap) || validateLock(hasPackageLock ? pkg : shrink),
    });
  } catch (error) {
    console.error(`CellFlow install: ${error.message}`);
    return 1;
  }
  if (plan.mode === "unlocked-bootstrap") {
    console.warn("CellFlow: package-lock.json is absent. Installing pinned direct dependencies with npm install.");
    console.warn("CellFlow: commit a generated package-lock.json later to enable reproducible npm ci deployments.");
  } else {
    console.log("CellFlow: valid npm lockfile present; using reproducible npm ci.");
  }
  console.log(`CellFlow install command: ${plan.command} ${plan.args.join(" ")}`);
  // Pure plan inspection for offline tests; does not weaken the deployment path.
  if (process.argv.includes("--print-plan")) return 0;
  const result = spawnSync(plan.command, plan.args, { cwd: root, stdio: "inherit", env: process.env, shell: false });
  if (result.error) { console.error(`CellFlow install failed: ${result.error.message}`); return 1; }
  if (result.signal) { console.error(`CellFlow install killed by ${result.signal}`); return 1; }
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
