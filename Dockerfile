# Repackages the release archives; it never builds Go. Build it with
# scripts/publish-docker.sh, which supplies dist/ from the published release.
FROM alpine:3.22 AS unpack
ARG VERSION
ARG TARGETARCH
WORKDIR /dist
COPY dist/checksums.txt dist/self-host_${VERSION}_linux_${TARGETARCH}.tar.gz ./
RUN grep " self-host_${VERSION}_linux_${TARGETARCH}.tar.gz\$" checksums.txt | sha256sum -c - \
 && tar -xzf self-host_${VERSION}_linux_${TARGETARCH}.tar.gz self-host LICENSE

FROM alpine:3.22
ARG VERSION
LABEL org.opencontainers.image.title="self-host" \
      org.opencontainers.image.description="Install and operate self-hosted apps with Docker Compose from one Go binary" \
      org.opencontainers.image.source="https://github.com/ajnart/self-host" \
      org.opencontainers.image.url="https://self-host.fyi" \
      org.opencontainers.image.documentation="https://self-host.fyi/docs" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}"
RUN apk add --no-cache ca-certificates docker-cli docker-cli-compose
COPY --from=unpack /dist/self-host /usr/local/bin/self-host
COPY --from=unpack /dist/LICENSE /usr/share/licenses/self-host/LICENSE
ENV SELF_HOST_NO_UPDATE_CHECK=1 SELF_HOST_IMAGE=1
ENTRYPOINT ["self-host"]
