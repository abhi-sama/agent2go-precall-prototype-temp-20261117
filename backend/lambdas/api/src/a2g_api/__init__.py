"""BE account API Lambda.

The only entry point from the FE account: AppSync resolvers invoke this function
cross-account. It verifies the caller, binds the caller's identity to the Postgres
session so row-level security filters every query, and computes metrics
deterministically.
"""
