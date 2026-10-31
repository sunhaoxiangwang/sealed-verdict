// Runs a condition over a JSONL of items and appends one verdict line per item. Re-running skips finished items.
//   npx tsx src/cli.ts --condition C2 --in ../../eval/data/items.jsonl --out ../../eval/results/verdicts/C2.jsonl
//   options: --limit N  --concurrency 2  --rounds 3  --models gpt-4.1-mini,gpt-4.1-nano (C4/C5 juror mix)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { connect } from "./relay.js";
import { isMock, MODEL } from "./llm.js";
import { makePool, runCase } from "./runCase.js";
import { FLAGS, type Condition, type Item } from "./protocol.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const cond = args.get("condition") as Condition;
const inPath = args.get("in");
const outPath = args.get("out");
if (!cond || !(cond in FLAGS) || !inPath || !outPath) {
  console.error("usage: cli.ts --condition C2|C3|C4|C5 --in items.jsonl --out verdicts.jsonl [--limit N] [--concurrency 2] [--rounds 3] [--models a,b]");
  process.exit(2);
}
const readJsonl = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

const done = new Set(readJsonl(outPath).map((r: any) => r.item_id));
const queue: Item[] = readJsonl(inPath).filter((it: Item) => !done.has(it.id)).slice(0, Number(args.get("limit") ?? Infinity));
const concurrency = Number(args.get("concurrency") ?? 2);
const rounds = Number(args.get("rounds") ?? 3);
const models = (args.get("models") ?? MODEL).split(",").map((s) => s.trim());
mkdirSync(dirname(outPath), { recursive: true });
console.log(`${cond}: ${queue.length} items to run (${done.size} already done), concurrency ${concurrency}, ${rounds} rounds${isMock() ? ", MOCK jurors (no OPENAI_API_KEY)" : `, model ${MODEL}`}`);

const relay = await connect();
const tag = Date.now().toString(36);
let ok = 0;
let failed = 0;
const total = queue.length;
const attempts = new Map<string, number>();
await Promise.all(
  Array.from({ length: Math.min(concurrency, total) }, async (_, w) => {
    let pool;
    try {
      pool = await makePool(relay, `${tag}-w${w}`);
    } catch (e: any) {
      console.error(`  worker ${w}: could not register agents (${e?.rawCode ?? e?.message}); other workers continue`);
      return;
    }
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const v = await runCase(pool, item, cond, { rounds, models });
        appendFileSync(outPath, JSON.stringify(v) + "\n");
        ok++;
        console.log(`  [${ok + failed}/${total}] ${item.id}: verdict ${v.verdict_idx} (label ${item.label ?? "?"})${v.no_quorum ? " no quorum" : ""}`);
      } catch (e: any) {
        const n = (attempts.get(item.id) ?? 0) + 1;
        attempts.set(item.id, n);
        if (n < 2) {
          queue.push(item); // one automatic retry at the back of the queue
          console.error(`  ${item.id}: ${e?.rawCode ?? ""} ${String(e?.message ?? e).slice(0, 120)}; will retry`);
          continue;
        }
        failed++;
        console.error(`  [${ok + failed}/${total}] ${item.id}: FAILED ${e?.rawCode ?? ""} ${String(e?.message ?? e).slice(0, 160)}`);
      }
    }
  }),
);
console.log(`${cond}: ${ok} done, ${failed} failed (re-run the same command to retry failures) -> ${outPath}`);
process.exit(failed && !ok ? 1 : 0);
