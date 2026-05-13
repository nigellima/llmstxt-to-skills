#!/usr/bin/env node
"use strict";

const { runCli } = require("../agent-skill-gen.js");

runCli(process.argv.slice(2)).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
