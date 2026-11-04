from a2g_api.embeddings import BedrockTitanEmbeddingProvider, LocalOpenSourceEmbeddingProvider, provider_from_config


def test_embedding_provider_is_selected_by_configuration_without_changing_callers():
    local = provider_from_config("local")
    assert isinstance(local, LocalOpenSourceEmbeddingProvider)
    assert len(local.embed("evidence access")) == 1536
    assert isinstance(provider_from_config("titan", endpoint_url="http://floci:4566"), BedrockTitanEmbeddingProvider)
