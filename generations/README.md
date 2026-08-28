# Prompt evolution

Each full-stack generation runs the same prompt against at least two fresh
isolated Luna MAX candidates. A later module-only generation may reuse at least
two surviving isolated runs to test augmentability without redeploying the
unchanged stack; its report must identify the base generation and count only
the additional actions. The supervisor verifies both and promotes only paths
that remain correct after a reload.

Fitness is ordered by:

1. complete acceptance matrix (a missing row disqualifies the candidate);
2. fewer meaningful actions;
3. fewer retries/recoveries;
4. less secret handling and less UI fragility;
5. clearer reusable evidence.

Generation reports record both failures and the promoted path. Prompt modules
are independently replaceable so one service can evolve without rewriting the
controller.
