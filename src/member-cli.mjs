#!/usr/bin/env node
// Run one formation-lianqun member from its data: `formation-lianqun-member --root <member section>
// [--operation <op>] [--now <iso>]`, activity on stdin. The member section (a *-xiaowei repository)
// holds only data: content/member.json and its offices and contracts. --root defaults to the working directory.
import { readFileSync } from "node:fs";
import { runFormationLianqunMember } from "./formation-lianqun-member.mjs";

const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const result = await runFormationLianqunMember({ root: arg("--root", process.cwd()), activity: JSON.parse(readFileSync(0, "utf8")), operation: arg("--operation", "solicit-service"), at: arg("--now", new Date().toISOString()) });
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.type === "Reject") process.exitCode = 2;
