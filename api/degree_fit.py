"""
Fitting theoretical distributions to empirical degree sequences.

All four families are fitted on the full sequence (xmin=1) so the curves
describe the same data the user sees, and the per-point log-likelihoods can be
compared directly across families. We give up the CSN tail-only approach in
exchange for one honest answer to "which shape best matches *these* data".
"""
import logging
import warnings
import numpy as np
from scipy.stats import poisson

from schema import node_type

logger = logging.getLogger("telescope.degree_fit")

# resolution of the theoretical curves shipped to the frontend
GRID_SIZE = 200


def _log_grid(k_lo, k_hi, n=GRID_SIZE):
    """Log-spaced grid of distinct integers in [k_lo, k_hi]."""
    k_lo = max(1, int(k_lo))
    k_hi = max(k_lo + 1, int(k_hi))
    raw = np.logspace(np.log10(k_lo), np.log10(k_hi), n)
    return sorted(set(int(round(x)) for x in raw if x >= k_lo))


def _ll_per_point(total_ll, n):
    """Per-point log-likelihood (total LL / n) — comparable across families; None on empty/non-finite."""
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


def _fit_with_library(seq):
    """Run powerlaw.Fit on the full sequence (xmin=1)."""
    import powerlaw
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = powerlaw.Fit(seq, discrete=True, xmin=1, verbose=False)
    return fit


def _fit_powerlaw(fit, k_max, n):
    """Power-law family fit → curve payload (gamma, grid, pmf, ccdf, per-point ll); None on failure."""
    try:
        pl = fit.power_law
        grid = _log_grid(1, k_max)
        pmf, ccdf = _curves(pl, grid)
        ll = _ll_per_point(float(pl.loglikelihood), n)

        return {
            "gamma": round(float(pl.alpha), 4),
            "k_min": 1,
            "ll": ll,
            "grid": grid,
            "pmf": pmf,
            "ccdf": ccdf,
        }
    except Exception as e:
        logger.warning("power-law fit failed: %s", e)
        return None


def _fit_exponential(fit, k_max, n):
    """Exponential family fit → curve payload (lambda, grid, pmf, ccdf, per-point ll); None on failure."""
    try:
        ex = fit.exponential
        grid = _log_grid(1, k_max)
        pmf, ccdf = _curves(ex, grid)
        ll = _ll_per_point(float(ex.loglikelihood), n)

        return {
            "lambda": round(float(ex.Lambda), 6),
            "k_min": 1,
            "ll": ll,
            "grid": grid,
            "pmf": pmf,
            "ccdf": ccdf,
        }
    except Exception as e:
        logger.warning("exponential fit failed: %s", e)
        return None


def _fit_lognormal(fit, k_max, n):
    """Log-normal family fit → curve payload (mu, sigma, grid, pmf, ccdf, per-point ll); None on failure."""
    try:
        ln = fit.lognormal
        grid = _log_grid(1, k_max)
        pmf, ccdf = _curves(ln, grid)
        ll = _ll_per_point(float(ln.loglikelihood), n)

        return {
            "mu": round(float(ln.mu), 4),
            "sigma": round(float(ln.sigma), 4),
            "k_min": 1,
            "ll": ll,
            "grid": grid,
            "pmf": pmf,
            "ccdf": ccdf,
        }
    except Exception as e:
        logger.warning("lognormal fit failed: %s", e)
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
    except Exception as e:
        logger.warning("poisson fit failed: %s", e)
        return None


def fit_degree_sequence(seq):
    """Fit all four families to one degree sequence (xmin=1). Returns {family: payload|None};
    sequences shorter than 5 are too small to fit and yield all-None."""
    if not seq or len(seq) < 5:
        return {"powerlaw": None, "exponential": None, "poisson": None, "lognormal": None}
    k_max = int(max(seq))
    n = len(seq)
    try:
        fit = _fit_with_library(seq)
    except Exception as e:
        logger.warning("powerlaw.Fit() raised: %s", e)
        fit = None

    return {
        "powerlaw":    _fit_powerlaw(fit, k_max, n) if fit else None,
        "exponential": _fit_exponential(fit, k_max, n) if fit else None,
        "lognormal":   _fit_lognormal(fit, k_max, n) if fit else None,
        "poisson":     _fit_poisson(seq, k_max),
    }


def compute_degree_fit(G):
    """Degree-distribution fits for the whole graph plus a per-node-type breakdown."""
    degree_seq = [d for _, d in G.degree()]

    by_type = {}
    for n, deg in G.degree():
        by_type.setdefault(node_type(G, n), []).append(deg)

    return {
        "all": fit_degree_sequence(degree_seq),
        "by_type": {t: fit_degree_sequence(s) for t, s in by_type.items()},
    }
