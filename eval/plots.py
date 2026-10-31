"""Charts from results/results.json (PNG + SVG) -> results/figs/.

python plots.py [--results results]
"""
import argparse, json, textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).parent
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e4e3df"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]  # validated categorical order, never cycled
PROVIDER_COLOR = {"anthropic": SERIES[0], "openai": SERIES[1], "gemini": SERIES[2], "mock": SERIES[3]}
plt.rcParams.update({"font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "xtick.color": MUTED,
                     "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "axes.grid.axis": "y", "grid.color": GRID, "grid.linewidth": 0.8,
                     "figure.facecolor": "#fcfcfb", "axes.facecolor": "#fcfcfb", "text.color": INK})


def _err(rows):
    return [[r["est"] - r["lo"] for r in rows], [r["hi"] - r["est"] for r in rows]]


def _save(fig, out, name, synthetic):
    if synthetic:
        fig.text(0.99, 0.99, "SYNTHETIC — mock verdicts", ha="right", va="top", color="#e34948", fontsize=9)
    fig.tight_layout()
    for ext in ("png", "svg"):
        fig.savefig(out / f"{name}.{ext}", dpi=200)
    plt.close(fig)


def _resolve(res, c):
    ref = res["meta"]["ref_provider"]
    pcs = res["per_condition"]
    return next((k for k in (f"{c}_{ref}", f"{c}_mixed") if k in pcs), next((k for k in pcs if k.startswith(c + "_")), None))


def _metric(res, cond, arm, metric):
    k = _resolve(res, cond)
    m = k and res["per_condition"][k].get(arm, {}).get(metric)
    return m if m and "lo" in m else None


def ladder(res, out, syn):
    L = res["ladder"]
    if not L:
        return
    fig, ax = plt.subplots(figsize=(7.5, 4))
    x = range(len(L))
    ax.errorbar(x, [r["score"] for r in L], yerr=[[r["score"] - r["lo"] for r in L], [r["hi"] - r["score"] for r in L]],
                fmt="o", ms=8, color=SERIES[0], ecolor=SERIES[0], elinewidth=2, capsize=0, mec="#fcfcfb", mew=2)
    ax.axhline(0, ls="--", color=MUTED, lw=1)
    ax.set_xticks(list(x), [r["id"] + "\n" + "\n".join(textwrap.wrap(r["label"], 14)) for r in L], fontsize=8)
    ax.set_ylabel("BBQ ambiguous bias score (s_amb)")
    ax.set_title("Ablation ladder: bias score by condition (95% CI)", loc="left", fontsize=11)
    note = "   ".join(f"{h['id']} Holm p={h['p_holm']:.3g}" for h in res["confirmatory"] if h["id"] in ("H1", "H2") and h["ran"])
    if note:
        ax.text(0.99, 0.97, note, transform=ax.transAxes, ha="right", va="top", color=MUTED, fontsize=9)
    _save(fig, out, "ablation_ladder", syn)


def providers(res, out, syn):
    keys = sorted(k for k in res["per_condition"] if k.startswith("C0_"))
    if not keys:
        return
    fig, axes = plt.subplots(1, 2, figsize=(7, 3.2))
    for ax, (arm, metric, label) in zip(axes, [("bbq_amb", "s_amb", "s_amb (BBQ ambiguous)"),
                                               ("tqa_forged", "acceptance", "forged-evidence acceptance")]):
        for i, k in enumerate(keys):
            m = res["per_condition"][k].get(arm, {}).get(metric)
            if m and "lo" in m:
                ax.errorbar([i], [m["est"]], yerr=_err([m]), fmt="o", ms=8, elinewidth=2, mec="#fcfcfb", mew=2,
                            color=PROVIDER_COLOR.get(k[3:], SERIES[3]))
        ax.set_xticks(range(len(keys)), [k[3:] for k in keys])
        ax.set_xlim(-0.6, len(keys) - 0.4)
        ax.set_title(label, loc="left", fontsize=10)
        ax.axhline(0, color=MUTED, lw=0.8)
    fig.suptitle("Provider baselines at C0 (95% CI)", x=0.01, ha="left", fontsize=11)
    _save(fig, out, "provider_baselines", syn)


def deltas(res, out, syn):
    rows = []
    for a, b in (("C3", "C2"), ("C4", "C3"), ("C5", "C4")):
        ka, kb = _resolve(res, a), _resolve(res, b)
        c = next((c for c in res["comparisons"] if (c["arm"], c["metric"], c["a"], c["b"]) == ("bbq_amb", "s_amb", ka, kb)), None)
        if c:
            rows.append((f"{a} − {b}", c))
    if not rows:
        return
    fig, ax = plt.subplots(figsize=(6, 3.2))
    x = range(len(rows))
    ax.bar(x, [c["delta"] for _, c in rows], width=0.5, color=SERIES[0], edgecolor="#fcfcfb", linewidth=2)
    ax.errorbar(x, [c["delta"] for _, c in rows], yerr=[[c["delta"] - c["lo"] for _, c in rows], [c["hi"] - c["delta"] for _, c in rows]],
                fmt="none", ecolor=INK, elinewidth=1.5)
    ax.axhline(0, color=MUTED, lw=1)
    ax.set_xticks(list(x), [r[0] for r in rows])
    ax.set_ylabel("Δ s_amb (negative = less bias)")
    ax.set_title("Mechanism deltas (exploratory, 95% CI)", loc="left", fontsize=11)
    _save(fig, out, "mechanism_deltas", syn)


def attacks(res, out, syn):
    conds = [c for c in ("C2", "C3", "C4", "C5") if _resolve(res, c)]
    if not conds:
        return
    fig, axes = plt.subplots(1, 2, figsize=(7, 3.2), sharey=True)
    for ax, (arm, metric, label) in zip(axes, [("bbq_byz", "byz_flip", "Byzantine flip rate"),
                                               ("tqa_forged", "acceptance", "Forged-evidence acceptance")]):
        ms = [(i, _metric(res, c, arm, metric)) for i, c in enumerate(conds)]
        ms = [(i, m) for i, m in ms if m]
        if ms:
            ax.errorbar([i for i, _ in ms], [m["est"] for _, m in ms], yerr=_err([m for _, m in ms]), fmt="o-",
                        lw=2, ms=8, elinewidth=2, color=SERIES[0], mec="#fcfcfb", mew=2)
        ax.set_xticks(range(len(conds)), conds)
        ax.set_title(label, loc="left", fontsize=10)
        ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0))
    fig.suptitle("Attack robustness (95% CI)", x=0.01, ha="left", fontsize=11)
    _save(fig, out, "attack_robustness", syn)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="results")
    d = HERE / ap.parse_args().results
    res = json.loads((d / "results.json").read_text())
    out = d / "figs"
    out.mkdir(exist_ok=True)
    syn = res["meta"]["SYNTHETIC"]
    for f in (ladder, providers, deltas, attacks):
        f(res, out, syn)
    print("wrote", sorted(p.name for p in out.glob("*.png")))


if __name__ == "__main__":
    main()
