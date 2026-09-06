#!/usr/bin/env bun

import assert from "node:assert/strict";

import {
  validateSeerrCredentialIndex,
  validateSeerrServiceDetails,
  validateSeerrSettings,
  verifySeerr,
} from "./verify-core.ts";

const RADARR_KEY = "fixture-radarr-key";
const SONARR_KEY = "fixture-sonarr-key";
const SEERR_KEY = "fixture-seerr-key";
const JELLYFIN_EXTERNAL_URL = "http://127.0.0.1:15004";
const RADARR_EXTERNAL_URL = "http://127.0.0.1:15002";
const SONARR_EXTERNAL_URL = "http://127.0.0.1:15003";

function fixtureSettings() {
  return {
    public: {
      initialized: true,
    },
    jellyfin: {
      ip: "jellyfin",
      port: 8096,
      useSsl: false,
      externalHostname: JELLYFIN_EXTERNAL_URL,
      serverId: "fixture-server",
      libraries: [
        { enabled: true, name: "Movies" },
        { enabled: true, name: "Shows" },
      ],
    },
    radarr: [
      {
        id: 0,
        hostname: "radarr",
        port: 7878,
        useSsl: false,
        isDefault: true,
        is4k: false,
        activeDirectory: "/data/media/movies",
        activeProfileId: 1,
        activeProfileName: "Any",
        preventSearch: false,
        syncEnabled: true,
        externalUrl: RADARR_EXTERNAL_URL,
        apiKey: RADARR_KEY,
      },
    ],
    sonarr: [
      {
        id: 1,
        hostname: "sonarr",
        port: 8989,
        useSsl: false,
        isDefault: true,
        is4k: false,
        activeDirectory: "/data/media/tv",
        activeAnimeDirectory: "/data/media/tv",
        activeProfileId: 1,
        activeProfileName: "Any",
        activeAnimeProfileId: 1,
        activeAnimeProfileName: "Any",
        preventSearch: false,
        syncEnabled: true,
        monitorNewItems: "all",
        enableSeasonFolders: true,
        externalUrl: SONARR_EXTERNAL_URL,
        apiKey: SONARR_KEY,
      },
    ],
  };
}

function validate(settings) {
  return validateSeerrSettings(settings, {
    jellyfinExternalHostname: JELLYFIN_EXTERNAL_URL,
    radarrApiKey: RADARR_KEY,
    radarrExternalUrl: RADARR_EXTERNAL_URL,
    sonarrApiKey: SONARR_KEY,
    sonarrExternalUrl: SONARR_EXTERNAL_URL,
  });
}

function fixtureCredentialIndex() {
  return {
    jellyfinUsers: [{ id: "fixture-user" }],
    radarr: [{ id: 0 }],
    sonarr: [{ id: 1 }],
  };
}

function fixtureServiceDetails() {
  return {
    radarr: {
      profiles: [{ id: 1 }],
      rootFolders: [{ id: 1 }],
      tags: [],
    },
    sonarr: {
      profiles: [{ id: 1 }],
      rootFolders: [{ id: 1 }],
      tags: [],
    },
  };
}

function assertRejected(mutator) {
  const settings = fixtureSettings();
  mutator(settings);
  assert.throws(() => validate(settings));
}

async function runChecks() {
  const settingsIds = validate(fixtureSettings());
  assert.deepEqual(settingsIds, { radarr: 0, sonarr: 1 });
  const serviceIds = validateSeerrCredentialIndex(
    fixtureCredentialIndex(),
    settingsIds,
  );
  assert.deepEqual(serviceIds, settingsIds);
  validateSeerrServiceDetails(fixtureServiceDetails());

  const rejectionMutators = [
    (settings) => { settings.public.initialized = false; },
    (settings) => { settings.jellyfin.ip = "localhost"; },
    (settings) => { settings.jellyfin.port = 8097; },
    (settings) => { settings.jellyfin.useSsl = true; },
    (settings) => { settings.jellyfin.externalHostname = "http://wrong"; },
    (settings) => { settings.jellyfin.serverId = ""; },
    (settings) => { settings.jellyfin.libraries[1].enabled = false; },
    (settings) => {
      settings.jellyfin.libraries.push({ enabled: true, name: "Music" });
    },
    (settings) => { settings.radarr.push({ ...settings.radarr[0] }); },
    (settings) => { settings.radarr[0].id = -1; },
    (settings) => { settings.radarr[0].hostname = "localhost"; },
    (settings) => { settings.radarr[0].port = 7879; },
    (settings) => { settings.radarr[0].useSsl = true; },
    (settings) => { settings.radarr[0].isDefault = false; },
    (settings) => { settings.radarr[0].is4k = true; },
    (settings) => { settings.radarr[0].activeDirectory = "/wrong"; },
    (settings) => { settings.radarr[0].activeProfileId = 0; },
    (settings) => { settings.radarr[0].activeProfileName = "Wrong"; },
    (settings) => { settings.radarr[0].preventSearch = true; },
    (settings) => { settings.radarr[0].syncEnabled = false; },
    (settings) => { settings.radarr[0].externalUrl = "http://wrong"; },
    (settings) => { settings.radarr[0].apiKey = "********"; },
    (settings) => { settings.radarr[0].apiKey = "wrong-key"; },
    (settings) => { settings.sonarr = []; },
    (settings) => { settings.sonarr[0].id = 1.5; },
    (settings) => { settings.sonarr[0].hostname = "localhost"; },
    (settings) => { settings.sonarr[0].port = 8990; },
    (settings) => { settings.sonarr[0].useSsl = true; },
    (settings) => { settings.sonarr[0].isDefault = false; },
    (settings) => { settings.sonarr[0].is4k = true; },
    (settings) => { settings.sonarr[0].activeDirectory = "/wrong"; },
    (settings) => { settings.sonarr[0].activeAnimeDirectory = "/wrong"; },
    (settings) => { settings.sonarr[0].activeProfileId = 0; },
    (settings) => { settings.sonarr[0].activeAnimeProfileName = "Wrong"; },
    (settings) => { settings.sonarr[0].preventSearch = true; },
    (settings) => { settings.sonarr[0].syncEnabled = false; },
    (settings) => { settings.sonarr[0].monitorNewItems = true; },
    (settings) => { settings.sonarr[0].enableSeasonFolders = false; },
    (settings) => { settings.sonarr[0].externalUrl = "http://wrong"; },
    (settings) => { settings.sonarr[0].apiKey = "************"; },
    (settings) => { settings.sonarr[0].apiKey = "wrong-key"; },
  ];
  for (const mutator of rejectionMutators) {
    assertRejected(mutator);
  }

  const emptyUsers = fixtureCredentialIndex();
  emptyUsers.jellyfinUsers = [];
  assert.throws(() => validateSeerrCredentialIndex(emptyUsers, settingsIds));

  const unsafeUser = fixtureCredentialIndex();
  unsafeUser.jellyfinUsers = [null];
  assert.throws(() => validateSeerrCredentialIndex(unsafeUser, settingsIds));

  const wrongRadarrId = fixtureCredentialIndex();
  wrongRadarrId.radarr[0].id = 2;
  assert.throws(() => validateSeerrCredentialIndex(wrongRadarrId, settingsIds));

  const wrongSonarrId = fixtureCredentialIndex();
  wrongSonarrId.sonarr[0].id = -1;
  assert.throws(() => validateSeerrCredentialIndex(wrongSonarrId, settingsIds));

  const emptyProfiles = fixtureServiceDetails();
  emptyProfiles.radarr.profiles = [];
  assert.throws(() => validateSeerrServiceDetails(emptyProfiles));

  const emptyRoots = fixtureServiceDetails();
  emptyRoots.sonarr.rootFolders = [];
  assert.throws(() => validateSeerrServiceDetails(emptyRoots));

  const invalidTags = fixtureServiceDetails();
  invalidTags.radarr.tags = {};
  assert.throws(() => validateSeerrServiceDetails(invalidTags));

  const calls = [];
  const responses = fixtureSettings();
  const credentialIndex = fixtureCredentialIndex();
  const serviceDetails = fixtureServiceDetails();
  const responseByUrl = new Map([
    ["http://127.0.0.1:15005/api/v1/settings/public", responses.public],
    ["http://127.0.0.1:15005/api/v1/settings/jellyfin", responses.jellyfin],
    ["http://127.0.0.1:15005/api/v1/settings/radarr", responses.radarr],
    ["http://127.0.0.1:15005/api/v1/settings/sonarr", responses.sonarr],
    [
      "http://127.0.0.1:15005/api/v1/settings/jellyfin/users",
      credentialIndex.jellyfinUsers,
    ],
    ["http://127.0.0.1:15005/api/v1/service/radarr", credentialIndex.radarr],
    ["http://127.0.0.1:15005/api/v1/service/sonarr", credentialIndex.sonarr],
    ["http://127.0.0.1:15005/api/v1/service/radarr/0", serviceDetails.radarr],
    ["http://127.0.0.1:15005/api/v1/service/sonarr/1", serviceDetails.sonarr],
  ]);
  await verifySeerr(
    {
      manifest: {
        JELLYFIN_PORT: "15004",
        RADARR_PORT: "15002",
        SEERR_PORT: "15005",
        SONARR_PORT: "15003",
      },
      secrets: {
        RADARR_API_KEY: RADARR_KEY,
        SEERR_API_KEY: SEERR_KEY,
        SONARR_API_KEY: SONARR_KEY,
      },
    },
    async (url, options, requestOptions) => {
      calls.push({ options, requestOptions, url });
      assert.equal(responseByUrl.has(url), true);
      return structuredClone(responseByUrl.get(url));
    },
  );
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "http://127.0.0.1:15005/api/v1/settings/public",
      "http://127.0.0.1:15005/api/v1/settings/jellyfin",
      "http://127.0.0.1:15005/api/v1/settings/radarr",
      "http://127.0.0.1:15005/api/v1/settings/sonarr",
      "http://127.0.0.1:15005/api/v1/settings/jellyfin/users",
      "http://127.0.0.1:15005/api/v1/service/radarr",
      "http://127.0.0.1:15005/api/v1/service/sonarr",
      "http://127.0.0.1:15005/api/v1/service/radarr/0",
      "http://127.0.0.1:15005/api/v1/service/sonarr/1",
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.deepEqual(call.options.headers, {
      "Content-Type": "application/json",
      "X-Api-Key": SEERR_KEY,
    });
    assert.match(call.requestOptions.label, /^Seerr /);
  }

  process.stdout.write("PASS Seerr verifier checks\n");
}

runChecks().catch(() => {
  process.stdout.write("FAIL Seerr verifier checks\n");
  process.exitCode = 1;
});
