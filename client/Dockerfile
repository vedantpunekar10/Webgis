# Multi-stage: a build stage (unused here since this client has no build
# step, but kept to demonstrate the pattern) copying only the final static
# files onto a minimal nginx base.
FROM node:20 AS build
WORKDIR /src
COPY index.html .
# (a real client with a bundler would run its build here; this one is
# already plain static HTML/JS, so the "build output" is just the file itself)

FROM nginx:1.27-alpine AS final
COPY --from=build /src/index.html /usr/share/nginx/html/index.html
EXPOSE 80
