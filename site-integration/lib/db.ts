import "server-only";

declare global {
  // eslint-disable-next-line no-var
  var _mysqlPool: import("mysql2/promise").Pool | undefined;
}

export async function getPool(): Promise<import("mysql2/promise").Pool> {
  if (!global._mysqlPool) {
    const mysql = await import("mysql2/promise");
    global._mysqlPool = mysql.createPool({
      host: process.env.DB_HOST ?? "localhost",
      socketPath: process.env.DB_SOCKET || undefined,
      user: process.env.DB_USER ?? "lyricsuser",
      password: process.env.DB_PASSWORD ?? "",
      database: process.env.DB_NAME ?? "lyricalsource",
      waitForConnections: true,
      connectionLimit: 6,
      maxIdle: 2,
      idleTimeout: 60000,
      queueLimit: 64,
      connectTimeout: 5000,
      enableKeepAlive: true,
      charset: "utf8mb4",
    });
  }
  return global._mysqlPool;
}
