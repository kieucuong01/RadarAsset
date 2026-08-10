const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function parsePostgresDatabase(value, label) {
  let databaseUrl;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }

  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
    throw new Error(`${label} must use the PostgreSQL protocol.`);
  }
  if (!LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname.toLowerCase())) {
    throw new Error(`${label} must point to a local PostgreSQL host.`);
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  if (!databaseName || databaseName.includes("/")) {
    throw new Error(`${label} must include one database name.`);
  }

  return {
    databaseName,
    identity: [
      "postgresql:",
      databaseUrl.hostname.toLowerCase(),
      databaseUrl.port || "5432",
      databaseName,
    ].join("|"),
  };
}

export function validateIntegrationDatabases(developmentDatabaseUrl, testDatabaseUrl) {
  if (!developmentDatabaseUrl || !testDatabaseUrl) {
    throw new Error("DATABASE_URL and TEST_DATABASE_URL are required for integration tests.");
  }

  const development = parsePostgresDatabase(developmentDatabaseUrl, "DATABASE_URL");
  const test = parsePostgresDatabase(testDatabaseUrl, "TEST_DATABASE_URL");
  if (development.identity === test.identity || development.databaseName === test.databaseName) {
    throw new Error("TEST_DATABASE_URL must not identify the development database.");
  }
  if (test.databaseName !== `${development.databaseName}_test`) {
    throw new Error("The integration database must be the development database name plus _test.");
  }

  return { development, test };
}
