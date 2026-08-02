import { runLoop } from "../loop.js";

const once = process.argv.includes("--once");
await runLoop({ once });
