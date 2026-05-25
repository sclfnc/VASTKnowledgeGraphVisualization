"""Eager precompute pipeline: spectral → betweenness → closeness. Threadpool-bound."""
import asyncio
import logging

from centrality import compute_spectral, compute_betweenness, compute_closeness
from registry import (
    Caches,
    EMPTY_CENTRALITY_STATUS,
    centrality_cache,
    centrality_status,
    graph_registry,
    load_graph,
    precompute_locks,
    precompute_tasks,
)

logger = logging.getLogger("telescope.centrality")

_PRECOMPUTE_SEQUENCE = (
    ('spectral', compute_spectral),
    ('betweenness', compute_betweenness),
    ('closeness', compute_closeness),
)


async def _run(graph_id: str):
    """Drive the sequence; status written eagerly. One failed measure doesn't block the next."""
    lock = precompute_locks.setdefault(graph_id, asyncio.Lock())
    async with lock:
        centrality_status[graph_id] = dict(EMPTY_CENTRALITY_STATUS)
        centrality_cache.setdefault(graph_id, {})
        loop = asyncio.get_running_loop()

        for name, fn in _PRECOMPUTE_SEQUENCE:
            if graph_id not in graph_registry:
                # Graph was unregistered (new upload); cleanup already popped our state.
                return
            centrality_status[graph_id][name] = 'computing'
            try:
                G = load_graph(graph_id)
                result = await loop.run_in_executor(None, fn, G)
                centrality_cache[graph_id][name] = result
                centrality_status[graph_id][name] = 'ready'
            except asyncio.CancelledError:
                centrality_status[graph_id][name] = 'cancelled'
                raise
            except Exception as e:
                centrality_status[graph_id][name] = 'error'
                logger.exception("precompute %s failed for %s: %s", name, graph_id, e)
                # Continue — partial results are useful.


async def cancel_all():
    """Cancel and await each task before wiping its registries (avoids the cleanup/_run race)."""
    for gid, t in list(precompute_tasks.items()):
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass
        Caches['graph_object'].pop(gid, None)
        centrality_status.pop(gid, None)
        centrality_cache.pop(gid, None)
        precompute_locks.pop(gid, None)
        precompute_tasks.pop(gid, None)


def kickoff(graph_id: str):
    """Spawn the precompute task for `graph_id`. Idempotent within a session."""
    if graph_id in precompute_tasks and not precompute_tasks[graph_id].done():
        return
    precompute_tasks[graph_id] = asyncio.create_task(_run(graph_id))
