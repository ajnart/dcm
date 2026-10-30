FROM busybox:1.37.0

COPY dist /www
COPY --chmod=644 httpd.conf /etc/httpd.conf

RUN cd /www \
 && find . -name '*.html' ! -name index.html ! -name 404.html | while read -r page; do \
      dir="${page%.html}"; \
      mkdir -p "$dir" && mv "$page" "$dir/index.html"; \
    done \
 && test -f templates/index.html

EXPOSE 7576

USER 65534:65534

CMD ["httpd", "-f", "-v", "-p", "7576", "-h", "/www", "-c", "/etc/httpd.conf"]
