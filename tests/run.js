// Runs every test file in this directory and reports a total.
//
//   node tests/run.js
//
// The suite executes the real source text of Code.gs against stubs, so it catches
// reference errors, wrong argument shapes, and logic faults without an Apps Script
// deployment. It does NOT prove the bot works end to end: nothing here talks to
// Telegram or Google Sheets. For the live check, run diagnose() in the editor.

"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith("test-") && f.endsWith(".js"))
  .sort();

let totalPass = 0;
let totalFail = 0;
const failed = [];

for (const file of files) {
  let out = "";
  let crashed = false;
  try {
    out = execFileSync(process.execPath, [path.join(dir, file)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    out = (err.stdout || "") + (err.stderr || "");
    crashed = true;
  }

  const m = /(\d+) passed, (\d+) failed/.exec(out);
  const passes = m ? Number(m[1]) : 0;
  const fails = m ? Number(m[2]) : 0;
  totalPass += passes;
  totalFail += fails;

  const label = file.replace(/^test-/, "").replace(/\.js$/, "");
  const ok = !crashed && fails === 0 && m;
  if (!ok) failed.push(file);

  console.log((ok ? "  ok   " : "  FAIL ") + label.padEnd(16) + passes + " passed" + (fails ? ", " + fails + " failed" : ""));

  if (!ok) {
    out
      .split("\n")
      .filter((l) => /FAIL |Error|throw/.test(l))
      .slice(0, 8)
      .forEach((l) => console.log("         " + l.trim()));
  }
}

console.log("");
console.log(totalPass + " assertions passed, " + totalFail + " failed, across " + files.length + " files");
if (failed.length) console.log("failing files: " + failed.join(", "));
process.exit(totalFail || failed.length ? 1 : 0);
