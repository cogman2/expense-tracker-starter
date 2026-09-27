// The core package: contracts shared by the client and the server. Everything
// here must stay runtime-agnostic — no Express, no React, no Prisma, no DOM —
// because both workspaces import it as source (see package.json exports).
export * from "./users";
