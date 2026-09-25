import { AuthRepository, UserRow } from '../../src/repositories/auth.repository';
import { Queryable } from '../../src/db/queryable';

function fakeDb(): jest.Mocked<Queryable> {
  return { query: jest.fn() };
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '200',
    email: 'prof.rao@example.edu',
    password_hash: '$2b$04$abcdefghijklmnopqrstuv',
    full_name: 'Prof. Rao',
    phone: null,
    role: 'FACULTY',
    ...overrides,
  };
}

describe('AuthRepository (unit — mocked Queryable boundary)', () => {
  describe('findByIdentifier', () => {
    it('queries with a case-insensitive LOWER(email) predicate plus roll_number/staff_code alternatives, all bound to the same single parameter', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [userRow()], rowCount: 1 });
      const repo = new AuthRepository(db);

      await repo.findByIdentifier('Prof.Rao@Example.EDU');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/FROM users/);
      expect(sql).toMatch(/LEFT JOIN students/);
      expect(sql).toMatch(/LEFT JOIN faculty/);
      expect(sql).toMatch(/LOWER\(u\.email\)\s*=\s*LOWER\(\$1\)/);
      expect(sql).toMatch(/s\.roll_number\s*=\s*\$1/);
      expect(sql).toMatch(/f\.staff_code\s*=\s*\$1/);
      expect(params).toEqual(['Prof.Rao@Example.EDU']);
    });

    it('returns the row when the value matches by email', async () => {
      const db = fakeDb();
      const row = userRow();
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new AuthRepository(db);

      expect(await repo.findByIdentifier('prof.rao@example.edu')).toEqual(row);
    });

    it('returns the row when the value matches by roll_number or staff_code (same query, mocked at the Queryable boundary)', async () => {
      const db = fakeDb();
      const row = userRow({ role: 'STUDENT' });
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new AuthRepository(db);

      expect(await repo.findByIdentifier('CSE2026-001')).toEqual(row);
    });

    it('returns null when nothing matches', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AuthRepository(db);

      expect(await repo.findByIdentifier('nobody@example.edu')).toBeNull();
    });
  });
});
