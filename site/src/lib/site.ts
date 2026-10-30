import { VERSION } from "./version";

export { VERSION };

export const INSTALL = "curl -fsSL https://self-host.fyi/install | bash";

export const AGENT_INSTALL = "Use https://self-host.fyi/llms.txt to help me set up my own home server. Ask what I want to run, explain the plan, and wait for my approval before installing.";

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
  { label: "Homebrew", code: "brew install ajnart/tap/self-host" },
  {
    label: "Docker",
    code: `docker run --rm -it --network host \\
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v "$HOME/.self-host:$HOME/.self-host" \\
  -e USER -e HOME -e SELF_HOST_HOME="$HOME/.self-host" \\
  ghcr.io/ajnart/self-host:latest   # Linux; macOS: see the docs`,
  },
  {
    label: "deb / rpm / apk",
    code: `BASE=https://github.com/ajnart/self-host/releases/download/v${VERSION}
curl -fsSLO $BASE/self-host_${VERSION}_linux_amd64.deb && sudo apt install ./self-host_${VERSION}_linux_amd64.deb
# Fedora: .rpm with dnf install; Alpine: .apk with apk add --allow-untrusted`,
  },
  {
    label: "Arch / Omarchy",
    code: `curl -fsSLO https://github.com/ajnart/self-host/releases/download/v${VERSION}/PKGBUILD
makepkg -si   # not on the AUR yet: registration is closed`,
  },
  {
    label: "from source",
    code: `go install github.com/ajnart/self-host/cmd/self-host@latest
# or: git clone https://github.com/ajnart/self-host && cd self-host && go build -o ~/.local/bin/self-host ./cmd/self-host`,
  },
];

export const AGENT_PROMPT = AGENT_INSTALL;

export const LINKS = {
  github: "https://github.com/ajnart/self-host",
  releases: "https://github.com/ajnart/self-host/releases",
  issues: "https://github.com/ajnart/self-host/issues",
  discord: "https://discord.gg/aCsmEV5RgA",
  sponsor: "https://github.com/sponsors/ajnart",
  kofi: "https://ko-fi.com/ajnart",
  awesome: "https://github.com/awesome-selfhosted/awesome-selfhosted",
  dcm: "/compose",
};
