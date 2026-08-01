"""
api.insights
============

Aggregates for the Insights view. One call, because a dashboard that fires
fifteen requests is a dashboard that renders in pieces.

Everything is computed from the ACTIVE snapshot, so the numbers on screen always
describe the rules that are actually assessing duty right now — not the draft
someone is mid-way through writing.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from .state import STATE

router = APIRouter(prefix="/v1", tags=["insights"])

#: Rough import weight by origin, used only to order the country chart so the
#: eye lands on the origins that matter. Not used in any calculation.
_MAJOR = ["CN", "MX", "CA", "VN", "DE", "JP", "KR", "TW", "IN", "IT", "FR", "GB",
          "TH", "MY", "ID", "BR", "CH", "ES", "NL", "SG"]


def _dt(v) -> Optional[datetime]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


@router.get("/insights")
async def insights(expiring_within_days: int = 60) -> Dict[str, Any]:
    pack = STATE.pack
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=expiring_within_days)

    by_program: Dict[str, Dict[str, Any]] = {}
    actions = Counter()
    confidence = Counter()
    bases = Counter()
    slots = Counter()
    countries: Counter = Counter()
    expiring: List[Dict[str, Any]] = []
    undated = 0

    for r in pack.rules:
        p = by_program.setdefault(r.program, {
            "program": r.program, "total": 0, "actions": Counter(),
            "countries": set(), "headings": 0,
        })
        p["total"] += 1
        p["actions"][r.action.value] += 1
        if r.ch99:
            p["headings"] += 1
        actions[r.action.value] += 1
        confidence[r.confidence] += 1
        bases[r.basis.value] += 1
        slots[r.stack_slot.value] += 1

        for c in r.when.coo_in:
            countries[c.upper()] += 1
            p["countries"].add(c.upper())

        if r.effective_start is None:
            undated += 1

        end = _dt(r.effective_end)
        if end and end <= horizon:
            days = (end - now).days
            expiring.append({
                "rule_id": r.id, "program": r.program, "ch99": r.ch99,
                "label": r.label, "effective_end": end.isoformat(),
                "days_remaining": days, "expired": days < 0,
                "source_ref": r.source_ref,
            })

    programs_meta = STATE.store.programs()
    program_rows = []
    for pid in STATE.store.program_order():
        row = by_program.get(pid, {
            "program": pid, "total": 0, "actions": Counter(),
            "countries": set(), "headings": 0,
        })
        meta = programs_meta.get(pid, {})
        program_rows.append({
            "program": pid,
            "label": meta.get("label", pid),
            "authority": meta.get("authority", ""),
            "stack_slot": meta.get("stack_slot"),
            "status": meta.get("status", "ACTIVE"),
            "rule_count": row["total"],
            "headings": row["headings"],
            "country_count": len(row["countries"]),
            "actions": dict(row["actions"]),
        })

    ranked = sorted(
        countries.items(),
        key=lambda kv: (_MAJOR.index(kv[0]) if kv[0] in _MAJOR else 99, -kv[1], kv[0]),
    )

    snaps = STATE.store.list_snapshots()

    return {
        "jurisdiction": "US",
        "rulepack": {
            "version": pack.version, "hash": pack.content_hash,
            "rule_count": len(pack.rules),
        },
        "reference_epoch": STATE.store.reference_epoch(),
        "table_counts": STATE.store.counts(),
        "programs": program_rows,
        "action_mix": dict(actions),
        "confidence_mix": dict(confidence),
        "basis_mix": dict(bases),
        "slot_mix": dict(sorted(slots.items())),
        "countries": {
            "distinct": len(countries),
            "top": [{"coo": c, "rules": n} for c, n in ranked[:24]],
        },
        "expiring": {
            "within_days": expiring_within_days,
            "expired": sorted([e for e in expiring if e["expired"]],
                              key=lambda e: e["days_remaining"]),
            "soon": sorted([e for e in expiring if not e["expired"]],
                           key=lambda e: e["days_remaining"]),
        },
        "attention": {
            "draft_rules": confidence.get("DRAFT", 0),
            "ai_unreviewed": sum(
                1 for r in pack.rules
                if r.confidence == "AI_EXTRACTED" and not r.reviewed_by),
            "no_effective_start": undated,
            "expired_still_present": sum(1 for e in expiring if e["expired"]),
        },
        "snapshots": snaps,
    }
