FROM node:22@sha256:c601a46abb4d2ab80a9dc3da208d50d1122642d53f17a101926ace71e5a9bf1c  # node:22
# Drop privileges before exec (Trivy DS-0002 / OWASP container hardening). The
# `node` user ships in the official node image; npx caches into its $HOME.
USER node
CMD ["npx", "--yes", "@peekdev/mcp@latest"]
