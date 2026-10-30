FROM busybox:1.37.0

COPY dist /www
COPY --chmod=644 httpd.conf /etc/httpd.conf

RUN test -f /www/templates/index.html

EXPOSE 7576

USER 65534:65534

CMD ["httpd", "-f", "-v", "-p", "7576", "-h", "/www", "-c", "/etc/httpd.conf"]
