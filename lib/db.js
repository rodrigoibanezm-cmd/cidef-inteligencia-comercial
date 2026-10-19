import pg from "pg";

const { Pool } = pg;
let pool;

function getPool() {
  if (!process.env.AZURE_DATABASE_URL) {
    throw new Error("AZURE_DATABASE_URL is required");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.AZURE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export function db() {
  const client = getPool();
  const sql = (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) {
      text += `$${i + 1}${strings[i + 1]}`;
    }
    return client.query(text, values).then((result) => result.rows);
  };
  sql.query = (text, values = []) =>
    client.query(text, values).then((result) => result.rows);
  return sql;
}

export async function withDbTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
