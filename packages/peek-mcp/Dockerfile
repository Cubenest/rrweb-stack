FROM node:22
# Drop privileges before exec (Trivy DS-0002 / OWASP container hardening). The
# `node` user ships in the official node image; npx caches into its $HOME.
USER node
CMD ["npx", "--yes", "@peekdev/mcp@latest"]
