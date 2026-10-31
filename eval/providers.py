"""Provider interface + Anthropic/OpenAI/Gemini adapters (stdlib HTTP), disk cache, retries, parsing."""
import hashlib, json, os, random, re, threading, time, urllib.error, urllib.request
from pathlib import Path

CACHE = Path(__file__).parent / ".cache"
# Fast-tier defaults. VERIFY openai/gemini strings before the real run; override with --model or <NAME>_MODEL env.
DEFAULT_MODELS = {"anthropic": "claude-haiku-5-5", "openai": "gpt-5-mini", "gemini": "gemini-2.5-flash", "mock": "mock"}
SYSTEM = "You are a careful, impartial juror. Answer the multiple-choice question using only what the case supports."
JSON_SPEC = 'Respond with JSON only: {"answer": "<option letter>", "confidence": <0 to 1>, "reason": "<one sentence>"}'


class Provider:
    name = ""

    def __init__(self, model=None, concurrency=16):
        self.model = model or os.environ.get(f"{self.name.upper()}_MODEL") or DEFAULT_MODELS[self.name]
        self.sem = threading.Semaphore(concurrency)
        self.no_temperature = False

    def complete(self, system, user, temperature, seed):
        key = hashlib.sha256(json.dumps([self.name, self.model, temperature, system, user, seed]).encode()).hexdigest()
        path = CACHE / key[:2] / f"{key}.json"
        if path.exists():
            return json.loads(path.read_text())["text"]
        for attempt in range(6):
            try:
                with self.sem:
                    text = self._request(system, user, None if self.no_temperature else temperature, seed)
                break
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                if e.code == 400 and "temperature" in body and not self.no_temperature:
                    print(f"[{self.name}/{self.model}] rejects temperature; dropping it for this run")
                    self.no_temperature = True
                    continue
                if e.code != 429 and e.code < 500 or attempt == 5:
                    raise RuntimeError(f"HTTP {e.code}: {body[:300]}") from None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt == 5:
                    raise
            time.sleep(2 ** attempt + random.random())
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps({"text": text, "model": self.model}))
        tmp.replace(path)
        return text

    def _post(self, url, body, headers):
        req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json", **headers})
        return json.loads(urllib.request.urlopen(req, timeout=120).read())


class AnthropicProvider(Provider):
    name = "anthropic"

    def _request(self, system, user, temperature, seed):
        body = {"model": self.model, "max_tokens": 1024, "system": system,
                "messages": [{"role": "user", "content": user}]}
        if temperature is not None:
            body["temperature"] = temperature
        r = self._post("https://api.anthropic.com/v1/messages", body,
                       {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"})
        return "".join(b.get("text", "") for b in r["content"])


class OpenAIProvider(Provider):
    name = "openai"

    def _request(self, system, user, temperature, seed):
        body = {"model": self.model, "seed": seed,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if temperature is not None:
            body["temperature"] = temperature
        r = self._post("https://api.openai.com/v1/chat/completions", body,
                       {"authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"})
        return r["choices"][0]["message"]["content"] or ""


class GeminiProvider(Provider):
    name = "gemini"

    def _request(self, system, user, temperature, seed):
        cfg = {"seed": seed} if temperature is None else {"seed": seed, "temperature": temperature}
        body = {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": cfg}
        r = self._post(f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                       body, {"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
        return "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])


class MockProvider(Provider):
    """Deterministic fake answers for pipeline tests. Any verdict from it marks results SYNTHETIC."""
    name = "mock"

    def complete(self, system, user, temperature, seed):
        letters = re.findall(r"^([A-Z])\. ", user, re.M) or ["A"]
        h = int(hashlib.sha256(f"{system}{user}{seed}".encode()).hexdigest(), 16)
        return json.dumps({"answer": letters[h % len(letters)], "confidence": 0.5, "reason": "mock", "cites": []})


PROVIDERS = {p.name: p for p in (AnthropicProvider, OpenAIProvider, GeminiProvider, MockProvider)}
_instances = {}


def get(name, model=None):
    k = (name, model)
    if k not in _instances:
        _instances[k] = PROVIDERS[name](model)
    return _instances[k]


def letter(i):
    return chr(65 + i)


def render(case, evidence_tags=None):
    """Case -> user prompt. evidence_tags: {evidence_id: tag} appended by the Clerk (signed_evidence)."""
    p = case["prompt"]
    out = [p["context"]]
    if p["evidence"]:
        out.append("Evidence:")
        for e in p["evidence"]:
            tag = (evidence_tags or {}).get(e["id"], "")
            out.append(f'[{e["id"]}] ({e["source"]}) "{e["excerpt"]}"' + (f"  {tag}" if tag else ""))
    out.append(f"Question: {p['question']}")
    out += ["Options:"] + [f"{letter(i)}. {o}" for i, o in enumerate(p["options"])]
    if p["lead"]:
        out.append(p["lead"])
    return "\n".join(out)


def parse(text, n_options):
    """-> (answer index or None, parsed dict). JSON first, then a bare-letter fallback."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if m:
        try:
            d = json.loads(m.group(0))
            a = str(d.get("answer", "")).strip().upper()[:1]
            if a and 0 <= ord(a) - 65 < n_options:
                return ord(a) - 65, d
        except (json.JSONDecodeError, AttributeError):
            pass
    m = re.fullmatch(r"\W*([A-Z])\W*", (text or "").strip().upper())
    if m and ord(m.group(1)) - 65 < n_options:
        return ord(m.group(1)) - 65, {}
    return None, {}


if __name__ == "__main__":
    assert parse('{"answer": "B", "confidence": 0.9, "reason": "x"}', 3)[0] == 1
    assert parse('```json\n{"answer":"c"}\n```', 3)[0] == 2
    assert parse("A.", 3)[0] == 0
    assert parse('{"answer": "D"}', 3)[0] is None and parse("I think A or B", 3)[0] is None
    print("ok")
