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

The current sequence is:

1. Generation 1 established the manual baseline and failure vocabulary.
2. Generation 2 promoted deterministic core configuration.
3. Generation 3 added read-only Homarr API and MCP verification.
4. Generation 4 packaged the survivor as composable skills and verified the
   private installer plus the live dashboard UI.
5. Generation 5 repeated the full stack in two fresh isolated runs, promoted
   the browser-audited survivor, and hardened finalizer reconciliation and
   authentication-safe evidence capture.
