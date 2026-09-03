"""A small provenance-aware graph for entities, relations, and conflicts.

Knowledge is stored as entities and relations, each with provenance,
confidence, and evidence links. Functional relations (e.g. "fastest_on")
are automatically checked for contradictions: if two different subjects
claim the same functional slot, the contradiction itself becomes a
research target.
"""
from __future__ import annotations

from .models import new_id, now

# Predicates where (predicate, object) should map to a single subject.
FUNCTIONAL_PREDICATES = {"fastest_on", "slowest_on"}


class KnowledgeGraph:
    def __init__(self) -> None:
        self.entities: dict[str, dict] = {}     # id -> {id, name, kind}
        self.relations: dict[str, dict] = {}    # id -> {id, subj, pred, obj, confidence, evidence_ids, created_at}
        self.contradictions: list[dict] = []

    # entities
    def entity(self, name: str, kind: str) -> str:
        for entity in self.entities.values():
            if entity["name"] == name and entity["kind"] == kind:
                return entity["id"]

        entity_id = new_id("ent")
        self.entities[entity_id] = {
            "id": entity_id,
            "name": name,
            "kind": kind,
        }
        return entity_id

    def entity_name(self, eid: str) -> str:
        return self.entities.get(eid, {}).get("name", eid)

    # relations
    def add_relation(self, subj: str, pred: str, obj: str, confidence: float,
                     evidence_ids: list | None = None) -> dict:
        """Add or merge a relation. Returns the relation dict.

        Merging: identical (subj, pred, obj) accumulates evidence and keeps the
        max confidence. Conflict: a functional predicate already bound to a
        different subject raises a contradiction record instead of silently
        overwriting knowledge.
        """
        evidence_ids = evidence_ids or []
        for relation in self.relations.values():
            same_slot = (
                relation["subj"] == subj
                and relation["pred"] == pred
                and relation["obj"] == obj
            )
            if same_slot:
                # dict preserves insertion order, so this removes duplicates
                # without shuffling the evidence trail readers already saw.
                combined = relation["evidence_ids"] + evidence_ids
                relation["evidence_ids"] = list(dict.fromkeys(combined))
                relation["confidence"] = max(relation["confidence"], confidence)
                return relation

        if pred in FUNCTIONAL_PREDICATES:
            for relation in self.relations.values():
                is_conflict = (
                    relation["pred"] == pred
                    and relation["obj"] == obj
                    and relation["subj"] != subj
                )
                if is_conflict:
                    self.contradictions.append({
                        "id": new_id("contra"),
                        "description": (
                            f"'{self.entity_name(relation['subj'])}' and "
                            f"'{self.entity_name(subj)}' "
                            f"both claimed as {pred} '{self.entity_name(obj)}'"
                        ),
                        "relation_ids": [relation["id"]],
                        "created_at": now(),
                    })

        relation_id = new_id("rel")
        relation = {
            "id": relation_id,
            "subj": subj,
            "pred": pred,
            "obj": obj,
            "confidence": round(confidence, 3),
            "evidence_ids": evidence_ids,
            "created_at": now(),
        }
        self.relations[relation_id] = relation
        return relation

    def relations_readable(self) -> list[str]:
        lines = []
        ordered = sorted(self.relations.values(), key=lambda item: item["created_at"])
        for relation in ordered:
            lines.append(
                f"{self.entity_name(relation['subj'])} —{relation['pred']}→ "
                f"{self.entity_name(relation['obj'])} "
                f"(confidence {relation['confidence']:.2f}, "
                f"evidence: {len(relation['evidence_ids'])})"
            )
        return lines

    # serialization
    def to_dict(self) -> dict:
        return {"entities": self.entities, "relations": self.relations,
                "contradictions": self.contradictions}

    @classmethod
    def from_dict(cls, data: dict) -> "KnowledgeGraph":
        graph = cls()
        graph.entities = data.get("entities", {})
        graph.relations = data.get("relations", {})
        graph.contradictions = data.get("contradictions", [])
        return graph
