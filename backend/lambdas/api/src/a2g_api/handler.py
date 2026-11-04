"""Lambda entry point for AppSync field resolvers.

Event shape (built by ``frontend/amplify/data/beInvoke.js``)::

    {"fieldName": "landingKpis", "arguments": {...}, "identity": {...},
     "request": {"headers": {...}}}

Refusals (unauthenticated, forbidden, no scope, bad request) are returned as an error
envelope, ``{"__a2gError": {"type": ..., "message": ...}}``, which the resolver turns
into a typed GraphQL error. Raising instead would surface as ``Lambda:Unhandled`` in
AWS and ``LambdaExecutionException`` in floci, losing the type the frontend needs.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from functools import partial
from typing import Any

from a2g_logging import configure, correlation, get_logger

from . import activity, briefs, chat, director, director_insights, eval_panel, eval_store, executive, executive_themes, flags, hierarchy, leadership, post_call, resolvers
from .db import scoped_cursor
from .errors import ApiError, BadRequest, Unavailable
from .embeddings import provider_from_config
from .agent_client import runtime_for
from .identity import JwksCache, resolve_identity
from .settings import Settings
from .saved_views import SavedViews

configure(service="a2g-be-api")
log = get_logger(__name__)

_settings: Settings | None = None
_jwks: JwksCache | None = None
_cold = True


def _config() -> tuple[Settings, JwksCache]:
    global _settings, _jwks
    if _settings is None or _jwks is None:
        _settings = Settings.from_env()
        _jwks = JwksCache(_settings.jwks_url)
    return _settings, _jwks


_store: flags.FlagStore | None = None


def _flag_store(settings: Settings) -> flags.FlagStore:
    global _store
    if _store is None:
        if not (settings.flags_table and settings.flags_role_arn):
            raise Unavailable("flags_unconfigured")
        _store = flags.DynamoFlagStore(settings.flags_table, settings.flags_role_arn)
    return _store


_brief_store_cache: briefs.DynamoBriefStore | None = None


def _brief_store(settings: Settings) -> briefs.DynamoBriefStore:
    global _brief_store_cache
    if _brief_store_cache is None:
        if not (settings.briefs_table and settings.briefs_role_arn):
            raise Unavailable("briefs_unconfigured")
        _brief_store_cache = briefs.DynamoBriefStore(settings.briefs_table, settings.briefs_role_arn)
    return _brief_store_cache


_eval_store_cache: eval_store.DynamoEvalStore | None = None


def _eval_store(settings: Settings) -> eval_store.DynamoEvalStore:
    global _eval_store_cache
    if _eval_store_cache is None:
        if not (settings.eval_table and settings.eval_role_arn):
            raise Unavailable("eval_unconfigured")
        _eval_store_cache = eval_store.DynamoEvalStore(settings.eval_table, settings.eval_role_arn)
    return _eval_store_cache


_summary_store_cache: briefs.DynamoBriefStore | None = None


def _summary_store(settings: Settings) -> briefs.DynamoBriefStore:
    """Leadership summaries share the briefs table and its narrow role, under the ``SUMMARY#`` sort-key prefix."""
    global _summary_store_cache
    if _summary_store_cache is None:
        if not (settings.briefs_table and settings.briefs_role_arn):
            raise Unavailable("summaries_unconfigured")
        _summary_store_cache = briefs.DynamoBriefStore(settings.briefs_table, settings.briefs_role_arn, prefix=leadership.SUMMARY_PREFIX)
    return _summary_store_cache


def _resolvers(settings: Settings, correlation_id: str) -> dict[str, Callable[..., Any]]:
    # Do not require the FE operational table for unrelated resolver unit tests or
    # legacy deployments; only the saved-view fields construct its client.
    def list_views(cur, identity, user_id, args):
        return resolvers.saved_views(cur, identity, user_id, args, store=SavedViews(settings))

    def save_view(cur, identity, user_id, args):
        return resolvers.save_view(cur, identity, user_id, args, store=SavedViews(settings))
    embeddings = provider_from_config(settings.embedding_provider, endpoint_url=settings.embedding_endpoint, region_name=settings.saved_views_region)

    return {
        "startChatRun": partial(
            chat.start_chat_run, worker_function=settings.chat_worker_function, correlation_id=correlation_id
        ),
        "chatEvents": chat.chat_events,
        "chatCitation": chat.chat_citation,
        "me": resolvers.me,
        "landingKpis": partial(resolvers.landing_kpis, default_range_days=settings.default_range_days),
        "geoActivity": partial(resolvers.geo_activity, default_range_days=settings.default_range_days),
        "activityTrends": activity.activity_trends,
        "activityEvidence": activity.activity_evidence,
        "directorOverview": director.director_overview,
        "territoryComparison": director.territory_comparison,
        "executiveOverview": executive.executive_overview,
        "executiveDrilldown": executive.executive_drilldown,
        "executiveThemes": executive_themes.executive_themes,
        "executiveTopicMatrix": executive_themes.executive_topic_matrix,
        "leadershipSummary": lambda *a: leadership.get_leadership_summary(*a, store=_summary_store(settings)),
        "myLeadershipSummaries": lambda *a: leadership.my_leadership_summaries(*a, store=_summary_store(settings)),
        "generateLeadershipSummary": lambda cur, identity, user_id, args: leadership.generate_leadership_summary(
            cur, identity, user_id, args, store=_summary_store(settings), runtime=runtime_for(settings), correlation_id=correlation_id
        ),
        "exportLeadershipSummary": lambda *a: leadership.export_leadership_summary(*a, store=_summary_store(settings)),
        "topicHeatmap": director_insights.topic_heatmap,
        "questionAnalytics": director_insights.question_analytics,
        "emergingTopics": director_insights.emerging_topics,
        "directorDrilldown": director_insights.director_drilldown,
        "directorExceptions": director_insights.director_exceptions,
        "territorySummaryEvidence": director_insights.territory_summary_evidence,
        # Resolved lazily: an unconfigured flag store must not break the other fields.
        "flagIssue": lambda *a: flags.flag_issue(*a, store=_flag_store(settings)),
        "myFlags": lambda *a: flags.my_flags(*a, store=_flag_store(settings)),
        "adminAccessOverview": resolvers.admin_access_overview,
        "accessAudit": resolvers.access_audit,
        "approveIdentityMapping": resolvers.approve_identity_mapping,
        "setRolePermissions": resolvers.set_role_permissions,
        "createScopeAssignment": resolvers.create_scope_assignment,
        "searchHcps": resolvers.search_hcps,
        "hcpProfile": resolvers.hcp_profile,
        "hcpTimeline": resolvers.hcp_timeline,
        "insightDiscovery": partial(resolvers.insight_discovery, default_range_days=settings.default_range_days),
        "semanticInsightSearch": partial(resolvers.semantic_insight_search, provider=embeddings),
        "savedViews": list_views,
        "saveView": save_view,
        "adminHierarchy": hierarchy.admin_hierarchy,
        "adminAccessTimeline": hierarchy.admin_access_timeline,
        "requestScopeChange": hierarchy.request_scope_change,
        "decideScopeChange": hierarchy.decide_scope_change,
        "adminVisibility": hierarchy.admin_visibility,
        "setCatalogVisibility": hierarchy.set_catalog_visibility,
        "setResponseAccess": hierarchy.set_response_access,
        "catalogQuestions": hierarchy.catalog_questions,
        "questionResponses": hierarchy.question_responses,
        "adminDataQuality": resolvers.admin_data_quality,
        "authorizationVerificationGrid": resolvers.authorization_verification_grid,
        "adminMetadataReconciliation": resolvers.admin_metadata_reconciliation,
        "adminDefinitions": resolvers.admin_definitions,
        "governanceRequestQueue": resolvers.governance_request_queue,
        "adminIssueAssistant": resolvers.admin_issue_assistant,
        "createDefinition": resolvers.create_definition,
        "approveDefinition": resolvers.approve_definition,
        "createGovernanceRequest": resolvers.create_governance_request,
        "decideGovernanceRequest": resolvers.decide_governance_request,
        "createPostCallDraft": post_call.create_post_call_draft,
        "confirmPostCallDraft": post_call.confirm_post_call_draft,
        "postCallDrafts": post_call.post_call_drafts,
        "confirmFollowUpTasks": post_call.confirm_follow_up_tasks,
        "myFollowUpTasks": post_call.my_follow_up_tasks,
        "createTopicAlertRule": post_call.create_topic_alert_rule,
        "topicAlertRules": post_call.topic_alert_rules,
        "topicAlerts": post_call.topic_alerts,
        # Briefs resolve their store lazily too: an unconfigured FE table must not break other fields.
        "generateBrief": lambda cur, identity, user_id, args: briefs.generate_brief(
            cur, identity, user_id, args, store=_brief_store(settings), runtime=runtime_for(settings), correlation_id=correlation_id
        ),
        "preCallBrief": lambda *a: briefs.get_brief(*a, store=_brief_store(settings)),
        "myBriefs": lambda *a: briefs.my_briefs(*a, store=_brief_store(settings)),
        "saveBriefEdits": lambda *a: briefs.save_brief_edits(*a, store=_brief_store(settings)),
        "exportBrief": lambda *a: briefs.export_brief(*a, store=_brief_store(settings)),
        # The evaluation panel. Resolved lazily too, so an unconfigured eval table breaks only these fields.
        "evalSuites": eval_panel.eval_suites,
        "startEvalRun": lambda *a: eval_panel.start_eval_run(
            *a, store=_eval_store(settings), worker_function=settings.eval_worker_function, correlation_id=correlation_id
        ),
        "evalRuns": lambda *a: eval_panel.eval_runs(*a, store=_eval_store(settings)),
        "evalRun": lambda *a: eval_panel.eval_run(*a, store=_eval_store(settings)),
        "evalRunDiff": lambda *a: eval_panel.eval_run_diff(*a, store=_eval_store(settings)),
        "evalRatings": lambda *a: eval_panel.eval_ratings(*a, store=_eval_store(settings)),
        "rateAnswer": lambda *a: eval_panel.rate_answer(*a, store=_eval_store(settings)),
    }


def handler(event: Mapping[str, Any], context: Any = None) -> Any:
    global _cold
    headers = {str(k).lower(): v for k, v in (((event.get("request") or {}).get("headers")) or {}).items()}
    with correlation(headers.get("x-correlation-id")) as cid:
        started = time.perf_counter()
        field = str(event.get("fieldName") or "")
        cold, _cold = _cold, False
        persona = None
        try:
            settings, jwks = _config()
            resolver = _resolvers(settings, cid).get(field)
            if resolver is None:
                raise BadRequest("unknown_field")
            identity = resolve_identity(event, settings, jwks)
            persona = identity.persona
            with scoped_cursor(settings.db_dsn, identity, cid) as (cur, user_id):
                result = resolver(cur, identity, user_id, event.get("arguments") or {})
            log.info(
                "request served",
                field_name=field,
                persona=persona,
                user_id=user_id,
                token_source=identity.token_source,
                outcome="ok",
                cold_start=cold,
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            return result
        except ApiError as exc:
            log.warning(
                "request refused",
                field_name=field,
                persona=persona,
                error_code=exc.code,
                outcome=exc.reason or exc.code,
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            return {"__a2gError": {"type": type(exc).__name__, "message": exc.public_message}}
        except Exception:
            log.exception("request failed", field_name=field, persona=persona, outcome="error")
            raise Unavailable("unhandled") from None
