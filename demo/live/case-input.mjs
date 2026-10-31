export function validateCase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Upload one JSON case object");
  const text = (v, name, max) => {
    if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`${name} must contain 1–${max} characters`);
    return v.trim();
  };
  const source = text(value.source, "source URL", 1000);
  if (!/^https?:\/\//i.test(source)) throw new Error("source must be an HTTP or HTTPS URL");
  new URL(source);
  if (!Array.isArray(value.context) || value.context.length < 1 || value.context.length > 24) throw new Error("context must contain 1–24 evidence items");
  const choices = ["escalate", "close", "need_more_info"];
  if (JSON.stringify(value.choices) !== JSON.stringify(choices)) throw new Error("choices must be escalate, close, need_more_info (in that order)");
  const context = value.context.map((e, i) => ({ source: text(e?.source, `Evidence ${i + 1} source`, 400), content: text(e?.content, `Evidence ${i + 1} content`, 240) }));
  if (new Set(context.map(e => e.source)).size !== context.length) throw new Error("Each evidence item needs a distinct source label");
  return { id: text(value.id, "id", 100), title: text(value.title, "title", 200), description: text(value.description, "description", 2000),
    question: text(value.question, "question", 1000), source, choices, context,
    dataKind: value.dataKind === "public_enforcement_record" ? value.dataKind : "uploaded_case" };
}
