// Private case archive. The secret key stays on the server; the UI uses /api/aml.
const bucket = "sealed-verdict";
function settings() {
  return { url: (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, ""), key: process.env.SUPABASE_API_KEY };
}
export function hasArchive() { const { url, key } = settings(); return !!(url && key); }
async function request(route, options = {}) {
  const { url, key } = settings();
  const response = await fetch(`${url}/storage/v1/${route}`, {
    ...options, signal: AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 || body.statusCode === "404") return null;
    throw new Error(`Supabase archive HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
  }
  return response.json();
}
export async function readArchive() {
  if (!hasArchive()) return null;
  return request(`object/authenticated/${bucket}/latest.json`);
}
export async function archiveCase(snapshot) {
  if (!hasArchive()) return;
  const existing = await request(`bucket/${bucket}`);
  if (existing?.public) throw new Error("The sealed-verdict archive bucket must be private");
  if (!existing) await request("bucket", { method: "POST", body: JSON.stringify({ id: bucket, name: bucket, public: false }) });
  const options = { method: "POST", headers: { "x-upsert": "true" }, body: JSON.stringify(snapshot) };
  await request(`object/${bucket}/cases/${snapshot.run.caseId}.json`, options);
  await request(`object/${bucket}/latest.json`, options);
}
