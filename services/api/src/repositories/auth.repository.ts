import { Queryable } from '../db/queryable';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  role: 'STUDENT' | 'FACULTY' | 'ADMIN';
}

/**
 * The ONLY class permitted to execute `users` authentication SQL. A single
 * read method — login is the only write-adjacent action this module
 * performs (issuing a JWT), and issuing a JWT needs no database write at
 * all (Level 2's chosen design is a self-issued, stateless JWT, not a
 * server-side session table).
 */
export class AuthRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Case-insensitive lookup, matching the `users_email_lower_uq` unique
   * index (migrations/sql/0001) that is the actual uniqueness guarantee —
   * this query's `LOWER(email) = LOWER($1)` is deliberately the same
   * predicate shape as that index so Postgres can use it directly instead
   * of a sequential scan.
   */
  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    return result.rows[0] ?? null;
  }
}
