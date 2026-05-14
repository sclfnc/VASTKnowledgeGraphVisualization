"""
Fitting theoretical distributions to empirical degree sequences.

Strategy:
- Use the `powerlaw` package (Alstott et al.) for power law, exponential
  (Lambda parameter), and lognormal. The package implements the
  Clauset-Shalizi-Newman 2009 framework correctly (discrete MLE, Hurwitz zeta
  normalisation, k_min selection via KS minimisation) and exposes `.pdf()`,
  `.ccdf()`, `.loglikelihood` on each fitted distribution.
- Use scipy for Poisson (not natively in the powerlaw package).
- All fitting work happens server-side. The backend pre-computes the
  theoretical CCDF and PMF on a log-spaced k-grid and ships them to the
  frontend ready to plot — no maths in JS.

Goodness-of-fit: mean log-likelihood per point (`ll`). Higher = better.
"""
import warnings
import numpy as np
from scipy.stats import poisson

# resolution of the theoretical curves shipped to the frontend
GRID_SIZE = 200


def _log_grid(k_lo, k_hi, n=GRID_SIZE):
    """Log-spaced grid of distinct integers in [k_lo, k_hi]."""
    k_lo = max(1, int(k_lo))
    k_hi = max(k_lo + 1, int(k_hi))
    raw = np.logspace(np.log10(k_lo), np.log10(k_hi), n)
    return sorted(set(int(round(x)) for x in raw if x >= k_lo))


def _ll_per_point(total_ll, n):
    if total_ll is None or n == 0:
        return None
    val = total_ll / n
    return round(float(val), 4) if np.isfinite(val) else None


def _curves(dist, grid):
    """Evaluate ccdf and pdf of a fitted powerlaw distribution on a grid."""
    arr = np.asarray(grid, dtype=float)
    pdf = dist.pdf(arr).tolist()
    ccdf = dist.ccdf(arr).tolist()
    return [float(p) for p in pdf], [float(c) for c in ccdf]


def _fit_with_library(seq, k_max):
    """Run powerlaw.Fit once; extract power_law / exponential / lognormal."""
    import powerlaw
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = powerlaw.Fit(seq, discrete=True, verbose=False)
    return fit


def _fit_powerlaw(fit, k_max):
    try:
        pl = fit.power_law
        gamma = float(pl.alpha)
        k_min = int(pl.xmin)

        grid = _log_grid(k_min, k_max)
        pmf, ccdf = _curves(pl, grid)
        ll = _ll_per_point(float(pl.loglikelihood), int(fit.n_tail))

        return {
            "gamma": round(gamma, 4),
            "k_min": k_min,
            "ll": ll,
            "grid": grid,
            "pmf": pmf,
            "ccdf": ccdf,
        }
    except Exception:
        return None


def _fit_exponential(fit, k_max):
    try:
        ex = fit.exponential
        lam = float(ex.Lambda)
        k_min = int(fit.xmin)  # exponential is fitted on the same tail as power_law

        grid = _log_grid(k_min, k_max)
        pmf, ccdf = _curves(ex, grid)
        ll = _ll_per_point(float(ex.loglikelihood), int(fit.n_tail))

        return {
            "lambda": round(lam, 6),
            "k_min": k_min,
            "ll": ll,
            "grid": grid,
            "pmf": pmf,
            "ccdf": ccdf,
        }
    except Exception:
        return None


def _fit_lognormal(fit, k_max):
    try:
        ln = fit.lognormal
        mu = float(ln.mu)
        sigma = float(ln.sigma)
        k_min = int(fit.xmin)

        grid = _log_grid(k_min, k_max)
        pmf, ccdf = _curves(ln, grid)
        ll = _ll_per_point(float(ln.loglikelihood), int(fit.n_tail))

        return {
            "mu": round(mu, 4),
            "sigma": round(sigma, 4),
            "k_min": k_min,
            "ll": ll,
            "grid": grid,
            "pmf": pmf,
            "ccdf": ccdf,
        }
    except Exception:
        return None


def _fit_poisson(seq, k_max):
    """Poisson on the full sequence; powerlaw package doesn't include it."""
    try:
        arr = np.array(seq, dtype=float)
        mu = float(arr.mean())
        if mu <= 0:
            return None

        grid = _log_grid(1, k_max)
        grid_arr = np.array(grid, dtype=float)
        pmf = poisson.pmf(grid_arr, mu).tolist()
        ccdf = poisson.sf(grid_arr - 1, mu).tolist()  # P(K >= k) = sf(k-1)
        total_ll = float(np.sum(poisson.logpmf(arr, mu)))
        ll = _ll_per_point(total_ll, len(arr))

        return {
            "mu": round(mu, 4),
            "ll": ll,
            "grid": grid,
            "pmf": [float(p) for p in pmf],
            "ccdf": [float(c) for c in ccdf],
        }
    except Exception:
        return None


def fit_degree_sequence(seq):
    if not seq or len(seq) < 5:
        return {"powerlaw": None, "exponential": None, "poisson": None, "lognormal": None}
    k_max = int(max(seq))
    try:
        fit = _fit_with_library(seq, k_max)
    except Exception:
        fit = None

    return {
        "powerlaw":    _fit_powerlaw(fit, k_max) if fit else None,
        "exponential": _fit_exponential(fit, k_max) if fit else None,
        "lognormal":   _fit_lognormal(fit, k_max) if fit else None,
        "poisson":     _fit_poisson(seq, k_max),
    }


def compute_degree_fit(G):
    degree_seq = [d for _, d in G.degree()]

    by_type = {}
    for node, deg in G.degree():
        ntype = G.nodes[node].get('Node Type', 'Unknown')
        by_type.setdefault(ntype, []).append(deg)

    return {
        "all": fit_degree_sequence(degree_seq),
        "by_type": {t: fit_degree_sequence(s) for t, s in by_type.items()},
    }
