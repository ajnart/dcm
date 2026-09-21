# Media harness profile handoff

The media harness and `selfhost-homarr` remain separate owners. The harness captures and stores the Homarr API key; this skill owns the reusable MCP profile, capability policy, bridge, and client fragment. Do not import skill code into the media runtime or copy profile logic into its bundle.

After the media run has captured `homarr-api-key.env`, the setup orchestrator may create a separate capability profile. These commands do not call an integration, mutate a service, or install client configuration.

1. Initialize the owner profile:

   ```bash
   bun "$HOMARR_SKILL_ROOT/scripts/profile.ts" init media-actions --base-url "$HOMARR_ORIGIN" --project-root "$PROJECT_ROOT"
   ```

2. Save a reviewed secret-free policy before generating a fragment. Use the exact live integration IDs returned by read-only `integration_all`; placeholders below must be replaced. The status routes are bounded GET examples for a safe live capability proof:

   ```json
   {
     "schemaVersion": 1,
     "mode": "integration-request",
     "rules": [
       {"integrationId":"<seerr-id>","service":"seerr","methods":["GET"],"paths":["/api/v1/status"]},
       {"integrationId":"<sonarr-id>","service":"sonarr","methods":["GET"],"paths":["/api/v3/system/status"]},
       {"integrationId":"<radarr-id>","service":"radarr","methods":["GET"],"paths":["/api/v3/system/status"]}
     ]
   }
   ```

   ```bash
   bun "$HOMARR_SKILL_ROOT/scripts/profile.ts" set-integration-policy "$PROFILE_PATH" < "$POLICY_FILE"
   ```

3. Transfer the already captured key directly from the mode-0600 media file to owner stdin. The command validates the exact one-line `HOMARR_API_KEY` envelope and never prints the key:

   ```bash
   bun "$HOMARR_SKILL_ROOT/scripts/profile.ts" import-media-key "$PROFILE_PATH" < "$SESSION_ROOT/homarr-api-key.env"
   ```

4. Validate the profile and generate a secret-free fragment:

   ```bash
   bun "$HOMARR_SKILL_ROOT/scripts/profile.ts" doctor "$PROFILE_PATH"
   bun "$HOMARR_SKILL_ROOT/scripts/generate-client-config.ts" codex "$PROFILE_PATH"
   ```

The generated server name ends in `-integration-request`. Stop there unless the user separately supplies the exact client-installation approval. A live proof may call only one configured GET status route and report its status without response bodies. It does not prove broader routes, write methods, or service mutation.
