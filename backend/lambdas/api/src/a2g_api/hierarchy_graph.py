"""Pure validation of the territory hierarchy graph. No I/O: callers pass in plain rows.

The hierarchy is a graph, not a tree: one territory may have several parents (glossary).
Access inherits downward along *effective* parent -> child links (``app.current_scope_territories``),
so everything here validates what that function would actually walk.

Findings (``code``):

* ``CYCLE`` (error): territories that are, directly or not, their own ancestor.
* ``ORPHAN_TERRITORY`` (error): a territory known to the system (geography, roster, call feed,
  assignments, source feed) that has no effective link to any other territory.
* ``MISSING_LINK`` (error / warning): the source feed and the versioned relationships disagree,
  or a source row names a child without a parent.
* ``OVERLAP`` (warning): a territory with several effective parents (legal, but access flows
  down from each), or a link duplicated in the versioned relationships.
* ``UNCOVERED_TERRITORY`` (warning): a leaf territory nobody holds, directly or by inheritance.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field

ERROR = "ERROR"
WARNING = "WARNING"


@dataclass(frozen=True)
class Edge:
    child: str
    parent: str
    #: "scope_relationship", "source_feed" or "both"
    source: str
    effective_from: str | None = None


@dataclass(frozen=True)
class Holder:
    user_id: str
    display_name: str
    assignment_type: str
    territory_id: str


@dataclass
class Finding:
    code: str
    severity: str
    territory_ids: list[str]
    message: str


@dataclass
class Analysis:
    nodes: dict[str, dict] = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)


def merge_edges(scope: set[tuple[str, str]], source: set[tuple[str, str]], from_by_pair: dict[tuple[str, str], str]) -> list[Edge]:
    """Combine versioned relationships and source-feed links into one edge list."""
    edges = []
    for pair in sorted(scope | source):
        origin = "both" if pair in scope and pair in source else ("scope_relationship" if pair in scope else "source_feed")
        edges.append(Edge(child=pair[0], parent=pair[1], source=origin, effective_from=from_by_pair.get(pair)))
    return edges


def find_cycles(edges: list[Edge]) -> list[list[str]]:
    """Every strongly connected set of territories that forms a cycle, as one closed path each.

    Iterative Tarjan: a hierarchy of any depth must not hit the recursion limit.
    """
    graph: dict[str, list[str]] = defaultdict(list)
    self_loops = set()
    for edge in edges:
        graph[edge.child].append(edge.parent)
        graph.setdefault(edge.parent, [])
        if edge.child == edge.parent:
            self_loops.add(edge.child)
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    components: list[list[str]] = []
    counter = 0
    for root in sorted(graph):
        if root in index:
            continue
        work = [(root, iter(sorted(graph[root])))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            node, children = work[-1]
            advanced = False
            for nxt in children:
                if nxt not in index:
                    index[nxt] = low[nxt] = counter
                    counter += 1
                    stack.append(nxt)
                    on_stack.add(nxt)
                    work.append((nxt, iter(sorted(graph[nxt]))))
                    advanced = True
                    break
                if nxt in on_stack:
                    low[node] = min(low[node], index[nxt])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[node])
            if low[node] == index[node]:
                component = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.append(member)
                    if member == node:
                        break
                if len(component) > 1 or component[0] in self_loops:
                    components.append(component)
    return [_closed_path(sorted(component), graph) for component in sorted(components, key=lambda c: sorted(c))]


def _closed_path(members: list[str], graph: dict[str, list[str]]) -> list[str]:
    """A concrete cycle through the smallest member, following child -> parent links."""
    inside = set(members)
    start = members[0]
    parent_of: dict[str, str | None] = {start: None}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        for nxt in sorted(graph[node]):
            if nxt not in inside:
                continue
            if nxt == start:
                path = [node]
                while parent_of[path[-1]] is not None:
                    path.append(parent_of[path[-1]])  # type: ignore[arg-type]
                path.reverse()
                return [*path, start]
            if nxt not in parent_of:
                parent_of[nxt] = node
                queue.append(nxt)
    return [*members, start]


def analyze(
    edges: list[Edge],
    universe: set[str],
    names: dict[str, str],
    holders: list[Holder],
    source_pairs: set[tuple[str, str]],
    scope_pairs: set[tuple[str, str]],
    parentless_source_children: set[str],
    duplicate_scope_pairs: set[tuple[str, str]],
) -> Analysis:
    parents: dict[str, list[str]] = defaultdict(list)
    children: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        if edge.child == edge.parent:
            continue
        parents[edge.child].append(edge.parent)
        children[edge.parent].append(edge.child)
    linked = {edge.child for edge in edges} | {edge.parent for edge in edges}
    all_ids = sorted(universe | linked)

    result = Analysis()
    for cycle in find_cycles(edges):
        result.findings.append(Finding("CYCLE", ERROR, sorted(set(cycle)), "Cycle: " + " → ".join(cycle)))

    for territory in all_ids:
        if territory not in linked:
            held = sum(1 for holder in holders if holder.territory_id == territory)
            extra = f" It is assigned to {held} user{'s' if held != 1 else ''}; they inherit nothing from it." if held else ""
            result.findings.append(Finding("ORPHAN_TERRITORY", ERROR, [territory], f"{territory} is in use but has no parent or child link in the hierarchy.{extra}"))

    for child, parent in sorted(source_pairs - scope_pairs):
        result.findings.append(Finding("MISSING_LINK", ERROR, [child, parent], f"Source link {child} → {parent} has no effective versioned relationship, so access does not inherit across it."))
    for child, parent in sorted(scope_pairs - source_pairs):
        result.findings.append(Finding("MISSING_LINK", WARNING, [child, parent], f"Versioned relationship {child} → {parent} has no row in the source hierarchy feed."))
    for child in sorted(parentless_source_children):
        result.findings.append(Finding("MISSING_LINK", ERROR, [child], f"The source hierarchy row for {child} names no parent."))

    for child, plist in sorted(parents.items()):
        unique = sorted(set(plist))
        if len(unique) > 1:
            result.findings.append(Finding("OVERLAP", WARNING, [child, *unique], f"{child} has {len(unique)} parents ({', '.join(unique)}); access flows down from each."))
    for child, parent in sorted(duplicate_scope_pairs):
        result.findings.append(Finding("OVERLAP", WARNING, [child, parent], f"{child} → {parent} is recorded more than once with overlapping effective dates."))

    # Descendants reachable from each held territory, tolerant of cycles (the visited set).
    direct: dict[str, list[Holder]] = defaultdict(list)
    for holder in holders:
        direct[holder.territory_id].append(holder)
    inherited: dict[str, list[tuple[Holder, str]]] = defaultdict(list)
    for origin, held in direct.items():
        seen = {origin}
        queue = deque(children.get(origin, []))
        while queue:
            node = queue.popleft()
            if node in seen:
                continue
            seen.add(node)
            for holder in held:
                inherited[node].append((holder, origin))
            queue.extend(children.get(node, []))

    roots = sorted(t for t in linked if t not in parents and children.get(t))
    depth: dict[str, int] = {}
    queue = deque((root, 0) for root in roots)
    while queue:
        node, d = queue.popleft()
        if node in depth:
            continue
        depth[node] = d
        queue.extend((child, d + 1) for child in sorted(set(children.get(node, []))))

    for territory in all_ids:
        is_leaf = not children.get(territory)
        if is_leaf and territory in linked and not direct.get(territory) and not inherited.get(territory):
            result.findings.append(Finding("UNCOVERED_TERRITORY", WARNING, [territory], f"{territory} is not held by any user, directly or by inheritance."))

    codes_by_territory: dict[str, set[str]] = defaultdict(set)
    for finding in result.findings:
        for territory in finding.territory_ids:
            codes_by_territory[territory].add(finding.code)

    for territory in all_ids:
        kids = sorted(set(children.get(territory, [])))
        result.nodes[territory] = {
            "territoryId": territory,
            "name": names.get(territory, territory),
            "kind": "REGION" if kids else "TERRITORY",
            "parentIds": sorted(set(parents.get(territory, []))),
            "childIds": kids,
            "depth": depth.get(territory),
            "directHolders": [_holder(h, h.territory_id) for h in sorted(direct.get(territory, []), key=_holder_key)],
            "inheritedHolders": [_holder(h, via) for h, via in sorted(inherited.get(territory, []), key=lambda p: (_holder_key(p[0]), p[1]))],
            "findingCodes": sorted(codes_by_territory.get(territory, set())),
        }
    severity_order = {ERROR: 0, WARNING: 1}
    result.findings.sort(key=lambda f: (severity_order[f.severity], f.code, f.territory_ids))
    return result


def _holder_key(holder: Holder) -> tuple[str, str]:
    return (holder.user_id, holder.assignment_type)


def _holder(holder: Holder, via: str) -> dict:
    return {
        "userId": holder.user_id,
        "displayName": holder.display_name,
        "assignmentType": holder.assignment_type,
        "viaTerritoryId": via,
    }


def windows_overlap(a_from, a_to, b_from, b_to) -> bool:
    """Half-open [from, to) windows; ``None`` as an end means open-ended."""
    return (a_to is None or b_from < a_to) and (b_to is None or a_from < b_to)
