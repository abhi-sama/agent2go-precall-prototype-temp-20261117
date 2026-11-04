"""Executive aggregate-only theme analysis with small-group disclosure, shared by the API Lambda and the agent."""

from .analysis import (
    DEFINITION_VERSION,
    FACETS,
    InvalidFacet,
    InvalidFacetValue,
    InvalidWindow,
    NoExecutiveScope,
    aggregate_citation,
    check_facet,
    executive_themes,
    executive_topic_matrix,
    regions_in_scope,
    thresholds,
    windows,
)
from .disclosure import MIN_CELL, count, disclosure_text, is_small, suppress_flags

__all__ = [
    "DEFINITION_VERSION",
    "FACETS",
    "MIN_CELL",
    "InvalidFacet",
    "InvalidFacetValue",
    "InvalidWindow",
    "NoExecutiveScope",
    "aggregate_citation",
    "check_facet",
    "count",
    "disclosure_text",
    "executive_themes",
    "executive_topic_matrix",
    "is_small",
    "regions_in_scope",
    "suppress_flags",
    "thresholds",
    "windows",
]
