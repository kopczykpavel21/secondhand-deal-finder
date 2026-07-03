"""
Formal selection model — simulation for Appendix A.

Observation model. A unit of brand b has:
  failure age  T ~ Weibull(shape kappa, scale lambda_b)   [lab durability]
  retention    R_b = age at which a *working* unit is released to resale
  scrap prob.  q_b = probability a *failed* unit is scrapped instead of
                     being listed for parts (repair economics)

A working unit appears as a resale listing iff its owner releases it while it
still works (R_b < T). A failed unit appears (broken) with prob (1 - q_b).

The observable working share is then
  S1(b) = P(listed working) / [P(listed working) + P(listed broken)]
        = P(T > R_b) / [P(T > R_b) + (1 - q_b) * P(T < A_max)]
(approximated below by Monte Carlo over a finite ownership horizon A_max).

The point: S1 depends on (lambda_b, R_b, q_b) jointly. Identical lab
durability lambda produces very different S1 under different retention R and
scrap q — reproducing the observed S1 x endurance null — and the Miele
(late-release, low-scrap) and Bauknecht (early-fail, high-list) signatures.

Usage: python3 research/selection_model_sim.py [--out-dir ../figures]
"""

import argparse
import pathlib

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

RNG = np.random.default_rng(42)
N = 200_000          # units per brand archetype
KAPPA = 1.8          # Weibull shape (wear-out regime)
A_MAX = 25.0         # ownership horizon, years

# Archetypes: (label, lambda = characteristic life yr, R_mean = release age yr, q = scrap prob)
ARCHETYPES = [
    ("Durable, released early (Bosch-like)",   14.0,  7.0, 0.50),
    ("Durable, kept until death (Miele-like)", 16.0, 13.0, 0.30),
    ("Durable, growing entrant (Hisense-like)",13.0,  5.0, 0.70),
    ("Fragile, listed broken (Bauknecht-like)", 9.0,  7.0, 0.30),
    ("Fragile, scrapped (budget-like)",         8.0,  7.0, 0.80),
]


def simulate(lam, r_mean, q):
    t_fail = lam * RNG.weibull(KAPPA, N)                    # failure ages
    r_release = np.clip(RNG.normal(r_mean, 2.0, N), 1, A_MAX)  # release ages
    listed_working = (t_fail > r_release)
    failed_in_horizon = t_fail < A_MAX
    listed_broken = failed_in_horizon & ~listed_working & (RNG.random(N) > q)
    nw, nb = listed_working.sum(), listed_broken.sum()
    return nw / (nw + nb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", type=pathlib.Path,
                    default=pathlib.Path(__file__).parent.parent / "figures")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"{'Archetype':42s}  {'λ (life)':>8s}  {'R (release)':>11s}  {'q (scrap)':>9s}  {'S1':>6s}")
    print("─" * 88)
    results = []
    for label, lam, r, q in ARCHETYPES:
        s1 = simulate(lam, r, q)
        results.append((label, lam, s1))
        print(f"{label:42s}  {lam:>8.1f}  {r:>11.1f}  {q:>9.2f}  {s1:>6.1%}")

    lams = [r[1] for r in results]
    s1s = [r[2] for r in results]
    rho = np.corrcoef(lams, s1s)[0, 1]
    print(f"\nPearson r(lab durability λ, observed S1) across archetypes = {rho:+.2f}")
    print("Identical-λ brands span a wide S1 range — the endurance null is structural.")

    # Figure: S1 as a function of release age for three λ values
    plt.rcParams.update({"font.family": "sans-serif", "font.size": 9,
                         "axes.spines.top": False, "axes.spines.right": False})
    fig, ax = plt.subplots(figsize=(6.2, 4.0))
    r_grid = np.linspace(3, 18, 25)
    for lam, style in [(16.0, "-"), (12.0, "--"), (8.0, ":")]:
        s1_curve = [simulate(lam, r, 0.5) for r in r_grid]
        ax.plot(r_grid, s1_curve, style, color="#3465a4", lw=1.6,
                label=f"λ = {lam:.0f} yr")
    ax.set_xlabel("mean release age R (years owners keep a working unit)")
    ax.set_ylabel("observed S1 (working share of listings)")
    ax.set_title("Identical lab durability, different retention → different S1\n"
                 "(scrap probability q = 0.5, Weibull shape κ = 1.8)",
                 fontsize=9.5, loc="left")
    ax.legend(frameon=False)
    fig.tight_layout()
    out = args.out_dir / "fig5_selection_model.png"
    fig.savefig(out, dpi=200)
    print(f"Figure → {out}")


if __name__ == "__main__":
    main()
