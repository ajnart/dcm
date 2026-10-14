import { VERSION } from "./version";

export { VERSION };

export const INSTALL = "curl -fsSL https://self-host.fyi/install | bash";

export const AGENT_INSTALL = "Read https://self-host.fyi/llms.txt, install the self-host CLI, then run `self-host skill` to learn how to use it.";

export const INSTALL_METHODS = [
  { label: "curl", code: INSTALL },
  { label: "paste in your agent", code: AGENT_INSTALL, lang: "text" },
  { label: "wget", code: "wget -qO- https://self-host.fyi/install | bash" },
  {
    label: "read it first",
    code: `curl -fsSL https://self-host.fyi/install -o install.sh
curl -fsSL https://self-host.fyi/install.sh.sha256   # compare: shasum -a 256 install.sh
less install.sh && bash install.sh`,
  },
  {
    label: "release archive",
    code: `VERSION=${VERSION} OS=linux ARCH=amd64   # or darwin, arm64
BASE=https://github.com/ajnart/self-host/releases/download/v$VERSION
curl -fsSLO $BASE/self-host_\${VERSION}_\${OS}_\${ARCH}.tar.gz -O $BASE/checksums.txt
sha256sum -c --ignore-missing checksums.txt   # macOS: shasum -a 256 -c --ignore-missing checksums.txt
tar -xzf self-host_\${VERSION}_\${OS}_\${ARCH}.tar.gz self-host && mkdir -p ~/.local/bin && mv self-host ~/.local/bin/`,
  },
  {
    label: "from source",
    code: `git clone https://github.com/ajnart/self-host && cd self-host
go build -o ~/.local/bin/self-host ./cmd/self-host`,
  },
];

export const AGENT_PROMPT = "Install the self-host skill from github.com/ajnart/self-host and help me run my own movie server.";

export const LINKS = {
  github: "https://github.com/ajnart/self-host",
  releases: "https://github.com/ajnart/self-host/releases",
  issues: "https://github.com/ajnart/self-host/issues",
  discord: "https://discord.gg/aCsmEV5RgA",
  sponsor: "https://github.com/sponsors/ajnart",
  kofi: "https://ko-fi.com/ajnart",
  dcm: "https://compose.ajnart.dev/?ref=selfhost",
};
