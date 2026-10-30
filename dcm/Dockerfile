FROM node:23-alpine

WORKDIR /app

COPY out /app/

RUN npm install -g serve

ENV DISABLE_TELEMETRY=true

EXPOSE 7576

CMD ["serve", "/app", "-p", "7576"]