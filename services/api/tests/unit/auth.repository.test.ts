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
  describe('findByEmail', () => {
    it('queries with a case-insensitive LOWER(email) = LOWER($1) predicate and the raw email as the sole parameter', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [userRow()], rowCount: 1 });
      const repo = new AuthRepository(db);

      await repo.findByEmail('Prof.Rao@Example.EDU');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/FROM users/);
      expect(sql).toMatch(/LOWER\(email\)\s*=\s*LOWER\(\$1\)/);
      expect(params).toEqual(['Prof.Rao@Example.EDU']);
    });

    it('returns the row when the email exists', async () => {
      const db = fakeDb();
      const row = userRow();
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new AuthRepository(db);

      expect(await repo.findByEmail('prof.rao@example.edu')).toEqual(row);
    });

    it('returns null when no user has that email', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AuthRepository(db);

      expect(await repo.findByEmail('nobody@example.edu')).toBeNull();
    });
  });
});
