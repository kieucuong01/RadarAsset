const schema = process.env.DATAVEST_PRISMA_SCHEMA;
const migrations = process.env.DATAVEST_PRISMA_MIGRATIONS;
const url = process.env.DATABASE_URL;

if (!schema || !migrations || !url) {
  throw new Error("Production Prisma paths and DATABASE_URL are required.");
}

export default {
  schema,
  migrations: { path: migrations },
  datasource: { url },
};
