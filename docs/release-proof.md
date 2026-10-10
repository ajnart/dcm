# Release proof

**Current private release: [0.1.2](https://github.com/ajnart/selfhost-skills/releases/tag/new-cli-v0.1.2).** Authenticated installation, real self-update, CLI checks, and checksum-corruption refusal passed on Linux amd64. GitHub release downloads matched the tagged workflow artifacts; all four archive checksums were verified for each release.

| Version | Source commit | Successful release workflow |
| --- | --- | --- |
| [0.1.0](https://github.com/ajnart/selfhost-skills/releases/tag/new-cli-v0.1.0) | `dcf8728e78dbfaf482bff37db6d753ff32d4f1af` | [37618897107](https://github.com/ajnart/selfhost-skills/actions/runs/37618897107) |
| [0.1.1](https://github.com/ajnart/selfhost-skills/releases/tag/new-cli-v0.1.1) | `b54733427f9c9ed44628073356a957a43bc4e8bb` | [37659252222](https://github.com/ajnart/selfhost-skills/actions/runs/37659252222) |
| [0.1.2](https://github.com/ajnart/selfhost-skills/releases/tag/new-cli-v0.1.2) | `d908cb6727ed6956cfbc7c6d5bf52ce1b8e3adbd` | [37663197041](https://github.com/ajnart/selfhost-skills/actions/runs/37663197041) |

[Source/native CI run 37662562771](https://github.com/ajnart/selfhost-skills/actions/runs/37662562771) passed all five jobs at `d908cb6727ed6956cfbc7c6d5bf52ce1b8e3adbd`: source tests plus native CLI/local checksum installer/corruption smoke on Linux amd64/arm64 and macOS amd64/arm64.

Host proof passed actual private **0.1.0 → 0.1.1 → 0.1.2** updates. Version, help, app listing, and the version-matched skill passed. Corrupted-checksum installation and update were refused without replacing the existing binary. Pass markers identify `update-second` / 0.1.1 / run `37659252222` / source `b54733427f9c9ed44628073356a957a43bc4e8bb`, and `update-current` / 0.1.2 / run `37663197041` / source `d908cb6727ed6956cfbc7c6d5bf52ce1b8e3adbd`.

Pinned README bootstrap through the authenticated GitHub content API also passed in fresh owned host destinations for 0.1.1 and 0.1.2. Each used its exact tagged installer and `SELF_HOST_VERSION`; version, help, JSON app listing, version-matched skill, and installed-byte comparison with the published archive passed.

| Pinned version | Installer SHA256 | Installed binary SHA256 |
| --- | --- | --- |
| 0.1.1 | `978e0bce826411cee98def387327a29972384b339f95fcbf90ef1924ae3f273d` | `1512985a9d9403602df3c7c27729c7aaefaca1b2e75df5e36b54e529928fa9fe` |
| 0.1.2 | `9f266e4cda3007f594d4fa818e73cbf67fe76e46b76a82e08b9066b4ae7d483e` | `9fb8532fd49bd778b3176676956326094d20eece918034d50ad863eb3c9a496c` |

A fresh minimal **Alpine Linux amd64 container** passed authenticated installation of the actual 0.1.0 binary followed by actual private self-update to 0.1.2. It used the **fixed 0.1.2 bootstrap installer** to select 0.1.0. The pinned base was `docker.io/library/alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8`, with shell/curl/tar prerequisites, no host/project/data/socket mounts, and no Go, Bun, or Node. Both installed binary hashes matched the corresponding GitHub archives; cleanup passed.

| Clean-container binary | SHA256 |
| --- | --- |
| 0.1.0 | `2e988c19330085e5d40765db05bd9092d8c9dca59eaaf01018c2ba830e21994a` |
| 0.1.2 | `9fb8532fd49bd778b3176676956326094d20eece918034d50ad863eb3c9a496c` |

The original tagged bootstrap failed Alpine metadata validation because its release parser was incompatible with BusyBox awk. [Issue #109](https://github.com/ajnart/selfhost-skills/issues/109) was fixed with a focused public metadata fixture and the successful real Alpine rerun. Existing release tags were preserved; this result does **not** validate the old installer on BusyBox.

This clean-container result proves Linux amd64 distribution behavior, not a VM or application deployment. Private published-asset installation/update on Linux arm64 or either macOS architecture remains unverified despite successful native CI. WSL remains unverified; native Windows is unsupported. These records do not establish application Docker acceptance or a full-catalog result.

Asset SHA256 values follow; [release-proof.json](release-proof.json) contains the machine-readable identities and pass records.

| Release | Asset | SHA256 |
| --- | --- | --- |
| 0.1.0 | `checksums.txt` | `4269bfd0e84352e934abb3a0636bce4494e1a4ef8e58e8abb60e453f89419f1a` |
| 0.1.0 | `self-host_0.1.0_darwin_amd64.tar.gz` | `4fa1b15c776b0788093608d0d4e0416d18e2f96a8147d260c44c5dbf0d1941d6` |
| 0.1.0 | `self-host_0.1.0_darwin_arm64.tar.gz` | `790dd500cfd6fb878746da455591f3f919f0c125fe51df43aa2a226068df8c99` |
| 0.1.0 | `self-host_0.1.0_linux_amd64.tar.gz` | `7cc55c07627ded50dfcc0d76f6eed6376d72a4b03308e5c1246fc96a2433910f` |
| 0.1.0 | `self-host_0.1.0_linux_arm64.tar.gz` | `65e7dbab0d475f4ea591c3e7b32607d7a08a4a1aa2d9e4a7342450620b807565` |
| 0.1.1 | `checksums.txt` | `8a4afa05dfafcbce17c2d1597258b32ffd82a3ac2a6b38165872d4a7aa1f9fc5` |
| 0.1.1 | `self-host_0.1.1_darwin_amd64.tar.gz` | `02f736ced5614dc0244ac7b8d55d4ac8a905234b6b355fa507fa83396951126e` |
| 0.1.1 | `self-host_0.1.1_darwin_arm64.tar.gz` | `12b7cfb5b861ca04c033afda2a3cfbc273fd10d1043e5d605c2b898c74d77f33` |
| 0.1.1 | `self-host_0.1.1_linux_amd64.tar.gz` | `3db94159c2960e70e29105d418c3165bf3eadda2bbc64b9c21c5bc986f94425d` |
| 0.1.1 | `self-host_0.1.1_linux_arm64.tar.gz` | `412570080e18a8c691bc69984274cb867b629e511595cf0c6e3ba42d95f8a05e` |
| 0.1.2 | `checksums.txt` | `bd9b3d8b8d3d3495fd0427bda89237bfafe532e9b7e9419f7acd5d491e851861` |
| 0.1.2 | `self-host_0.1.2_darwin_amd64.tar.gz` | `2f345790c5584bd869dd2017f8d6d196c1297cdeffaee340d08c005a6dbc9d73` |
| 0.1.2 | `self-host_0.1.2_darwin_arm64.tar.gz` | `2bcd012b6b4c2d51c2b3a9c147e9c9be0e83c1daf32ccb66e6b83ad74595623b` |
| 0.1.2 | `self-host_0.1.2_linux_amd64.tar.gz` | `f73d5ea76ffb38dc202816c3c4078f915fac9c8b4d19ae830938ad9f12cfb7e5` |
| 0.1.2 | `self-host_0.1.2_linux_arm64.tar.gz` | `e4451f0d54dcbe4f318fdef3a6657267d94d7e11e9d51571e9c5e154f9dc8a3f` |
