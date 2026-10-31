import { sleep } from "./relay.js";

export const MODEL = process.env.EVAL_MODEL ?? "gpt-4.1-mini";

// No OPENAI_API_KEY (or JURY_LLM=mock) runs scripted jurors so the Relay plumbing can be tested. Verdicts are tagged mock.
export const isMock = () => !process.env.OPENAI_API_KEY || process.env.JURY_LLM === "mock";

let temperatureOk = true;

// One chat completion that must return a JSON object. Retries 429/5xx; drops temperature for models that reject it.
export async function chatJSON(model: string, system: string, user: string, temperature = 0.7): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    };
    if (temperatureOk) body.temperature = temperature;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const j: any = await r.json();
      try {
        return JSON.parse(j.choices[0].message.content ?? "{}");
      } catch {
        return {};
      }
    }
    const text = await r.text();
    if (r.status === 400 && temperatureOk && text.includes("temperature")) {
      temperatureOk = false;
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 8) {
      await sleep(Math.min(1000 * 2 ** attempt, 20000));
      continue;
    }
    throw new Error(`OpenAI ${r.status}: ${text.slice(0, 200)}`);
  }
}
