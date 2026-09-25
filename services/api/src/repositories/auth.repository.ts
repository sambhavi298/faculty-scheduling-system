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
   * A single login field accepts a STUDENT's registration (roll) number, a
   * FACULTY member's staff code, or an email — this is what lets every app
   * keep ONE login form while the Student and Faculty portals label the
   * field "Registration Number" / "Staff Code" (there is no such column for
   * ADMIN, which still signs in by email; see the three apps' Login.tsx).
   *
   * `roll_number`/`staff_code` are matched case-sensitively, deliberately —
   * they carry a plain (non-`LOWER()`) UNIQUE constraint each
   * (`students_roll_number_uq`, `faculty_staff_code_uq`, migrations/sql/0001),
   * so a case-insensitive match here could in principle straddle two
   * distinct rows differing only in case. Email keeps its existing
   * case-insensitive match, which mirrors the real uniqueness guarantee for
   * that column (`users_email_lower_uq`).
   */
  async findByIdentifier(identifier: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      `SELECT u.* FROM users u
       LEFT JOIN students s ON s.id = u.id
       LEFT JOIN faculty f ON f.id = u.id
       WHERE LOWER(u.email) = LOWER($1) OR s.roll_number = $1 OR f.staff_code = $1
       LIMIT 1`,
      [identifier]
    );
    return result.rows[0] ?? null;
  }
}
