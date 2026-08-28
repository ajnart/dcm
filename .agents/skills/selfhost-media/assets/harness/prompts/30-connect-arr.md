# 30 - Connect the Arr pipeline

## Actions

Do not rebuild the pipeline manually. `scripts/session.sh bootstrap "$RUN_ID"`
live-tests candidate public indexers until one works, configures both download
clients and Full Sync applications, triggers `ApplicationIndexerSync`, and
waits for the chosen indexer downstream.

Run `scripts/session.sh verify "$RUN_ID"`. In agent-browser, spot-check the
Prowlarr indexer/application lists and Sonarr/Radarr download-client/indexer
lists. Record the chosen public indexer; availability is environmental, so do
not hard-code a provider that failed its live test.

## Stop gate

All verifier lines pass and the UI lists agree with them.
