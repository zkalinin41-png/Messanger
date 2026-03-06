import pg from 'pg'

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? undefined : { rejectUnauthorized: false },
})

function convertPlaceholders(sql: string): string {
    let idx = 0
    return sql.replace(/\?/g, () => `$${++idx}`)
}

export async function dbExec(sql: string): Promise<void> {
    await pool.query(sql)
}

export async function dbGet(sql: string, ...params: any[]): Promise<any> {
    const result = await pool.query(convertPlaceholders(sql), params)
    return result.rows[0] || null
}

export async function dbAll(sql: string, ...params: any[]): Promise<any[]> {
    const result = await pool.query(convertPlaceholders(sql), params)
    return result.rows
}

export async function dbRun(sql: string, ...params: any[]): Promise<{ lastInsertRowid: any; changes: number }> {
    // Auto-add RETURNING id for INSERT statements
    let pgSql = convertPlaceholders(sql)
    if (/^\s*INSERT/i.test(pgSql) && !/RETURNING/i.test(pgSql)) {
        pgSql += ' RETURNING id'
    }
    const result = await pool.query(pgSql, params)
    return {
        lastInsertRowid: result.rows[0]?.id ?? null,
        changes: result.rowCount ?? 0,
    }
}

export async function dbColumnExists(table: string, column: string): Promise<boolean> {
    const result = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column]
    )
    return result.rows.length > 0
}

export { pool }
