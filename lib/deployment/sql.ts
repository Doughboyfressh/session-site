/** Translate the application's bounded SQLite SQL vocabulary to PostgreSQL. */
export function postgresSQL(input: string) {
  let sql = input.trim().replace(/;$/, '');
  const ignore = /^INSERT OR IGNORE\b/i.test(sql);
  sql = sql.replace(/^INSERT OR IGNORE\b/i, 'INSERT');
  sql = sql.replace(/MAX\(seen,\s*\?\)/gi, 'GREATEST(seen,?)');
  sql = sql.replace(/DO UPDATE SET count=count\+1/gi, 'DO UPDATE SET count=rate_limits.count+1');
  sql = sql.replace(/\bIS\s+NOT\s+(\?\d*)/gi, 'IS DISTINCT FROM $1');
  sql = sql.replace(/\bIS\s+(\?\d*)/gi, 'IS NOT DISTINCT FROM $1');
  sql = sql.replace(/(\?\d*)\s+IS\s+(NOT\s+)?NULL\b/gi,
    (_, value, not) => `CAST(${value} AS TEXT) IS ${not || ''}NULL`);
  sql = sql.replace(/json_extract\(([^,]+),\s*'\$\.([^']+)'\)/gi, (_, value, field) => {
    const expression = `session_json_extract(${value},'${field}')`;
    return ['bpm', 'size', 'sampleRate', 'depth', 'seconds'].includes(field)
      ? `CAST(${expression} AS NUMERIC)` : expression;
  });
  sql = sql.replace(/json_array_length\(([^,]+),\s*'\$\.([^']+)'\)/gi,
    "session_json_array_length($1,'$2')");
  sql = sql.replace(/json_each\(/gi, 'session_json_each(');
  sql = sql.replace(/json_group_array\(([^)]+)\)/gi, "COALESCE(json_agg($1),'[]'::json)");
  sql = sql.replace(/json_object\(/gi, 'json_build_object(');
  // Match literals first: placeholders and identifiers inside them stay intact.
  let parameter = 0;
  sql = sql.replace(/'(?:''|[^'])*'|\?(\d+)?|\b[a-zA-Z_][a-zA-Z_0-9]*\b/g,
    (token, explicit) => {
      if (token.startsWith("'")) return token;
      if (token.startsWith('?')) {
        const index = explicit ? Number(explicit) : parameter + 1;
        parameter = Math.max(parameter, index);
        return '$' + index;
      }
      return token === 'user' || /[a-z][A-Z]/.test(token) ? `"${token}"` : token;
    });
  if (ignore) {
    const returning = /\s+RETURNING\b/i.exec(sql);
    const at = returning?.index ?? sql.length;
    sql = sql.slice(0, at) + ' ON CONFLICT DO NOTHING' + sql.slice(at);
  }
  return sql;
}
