import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { GLUETUN_AUTH_SOURCE, gluetunControlConfiguration } from "./control.ts";

export const GLUETUN_IMAGE = "qmcgaw/gluetun:v3.41.3";
const README = "https://github.com/passteque/gluetun/blob/v3.41.3/README.md";
const DOCKERFILE = "https://github.com/passteque/gluetun/blob/v3.41.3/Dockerfile";
const SECRETS = "https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/docker-secrets.md";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "gluetun",
  sourceFiles: ["derived-recipe.ts", "control.ts", "setup.ts", "runtime-resources.json", "manifest.json"],
  inputDefinitions: {
    provider: { description: "Explicit VPN provider: protonvpn or purevpn; bring that provider's OpenVPN credentials", maxLength: 9 },
    protocol: { description: "Explicit VPN protocol: openvpn; WireGuard is not covered by this profile", maxLength: 7 },
    "server-country": { description: "One provider-supported country name; provider availability is checked by the pinned upstream", maxLength: 80 },
  },
  derive(_state, inputs) {
    if (!["protonvpn", "purevpn"].includes(inputs.provider!)) {
      throw new Error("Gluetun requires an explicit reviewed OpenVPN provider: protonvpn or purevpn");
    }
    if (inputs.protocol !== "openvpn") throw new Error("Gluetun's shared profile supports OpenVPN only");
    const country = inputs["server-country"];
    if (typeof country !== "string" || country.length > 80 || !/^[A-Za-z]+(?:[ -][A-Za-z]+)*$/.test(country)) {
      throw new Error("Gluetun requires one explicit provider-supported country name");
    }
    const control = gluetunControlConfiguration();
    const recipe = {
      schemaVersion: 2, kind: "multi-service-compose", appId: "gluetun", source: README,
      services: [{ id: "gluetun", purpose: "Private authenticated VPN control; downloader namespace attachment remains separately owned.",
        imageTag: GLUETUN_IMAGE, imageSource: "https://github.com/passteque/gluetun/releases/tag/v3.41.3",
        user: "image-default", imageUserEvidence: { officialUrl: DOCKERFILE, reason: "official-image-runtime-contract" },
        runtimeResources: { profile: "tun-net-admin", officialUrl: README },
        restart: "unless-stopped", readOnly: false,
        environment: [{ name: "VPN_SERVICE_PROVIDER", value: inputs.provider },
          { name: "VPN_TYPE", value: "openvpn" }, { name: "SERVER_COUNTRIES", value: country },
          { name: "FIREWALL_ENABLED_DISABLING_IT_SHOOTS_YOU_IN_YOUR_FOOT", value: "on" },
          { name: "LOG_LEVEL", value: "warn" }, { name: "HTTP_CONTROL_SERVER_LOG", value: "off" },
          { name: "HTTP_CONTROL_SERVER_ADDRESS", value: ":8000" }],
        hostEnvironment: [],
        fileEnvironment: [{ name: "OPENVPN_USER_SECRETFILE", fileId: "provider-user" },
          { name: "OPENVPN_PASSWORD_SECRETFILE", fileId: "provider-password" },
          { name: "HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH", fileId: "control-auth",
            format: "private-config-path", officialUrl: GLUETUN_AUTH_SOURCE }],
        privateConfigFiles: ["control-auth"],
        mounts: [{ kind: "bind", name: "config", target: "/gluetun" }],
        dependsOn: [], publishTargetPort: 8000 }],
      privateFiles: [...control.privateFiles,
        { id: "provider-user", source: "owner", maxBytes: 4096 },
        { id: "provider-password", source: "owner", maxBytes: 4096 }],
      privateConfigs: control.privateConfigs,
      onboarding: { kind: "generated-api-token", officialUrl: GLUETUN_AUTH_SOURCE, fileId: "control-api-key" },
      defaults: { hostIp: "127.0.0.1", publishedPort: 8000, dataDirectoryName: "gluetun" },
      storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
      acceptance: [{ id: "control-authentication", method: "api", description: "Reject anonymous status reads and verify the saved private read-only key with running VPN status." },
        { id: "downloader-namespace", method: "api", description: "Pending separate approval: attach the selected downloader to this exact VPN namespace and verify its egress." },
        { id: "tunnel-break", method: "api", description: "Pending separate approval: prove downloader IP and DNS fail closed through a deliberate tunnel break and restoration." },
        { id: "restart-persistence", method: "persisted", description: "Pending scoped restart: verify unchanged provider inputs, saved control key and actual VPN state." }],
    };
    return { recipe, configuration: { provider: inputs.provider, protocol: "openvpn", serverCountry: country,
      providerSecretSource: SECRETS, downloaderNamespaceVerified: false, tunnelBreakVerified: false }, peerAppIds: [] };
  },
};

export default adapter;
