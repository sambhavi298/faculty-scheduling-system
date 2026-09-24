import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AuthRepository } from '../../src/repositories/auth.repository';

/**
 * Integration tests — exercise AuthRepository against a REAL PostgreSQL
 * instance, not a mock, same convention as
 * tests/integration/faculty.repository.integration.test.ts.
 *
 * Seed data (migrations/sql/seed_test_data.sql): students alice@example.edu
 * (100) / bob@example.edu (101), faculty prof.rao@example.edu (200) /
 * prof.iyer@example.edu (201), admin admin@example.edu (900) — every seeded
 * user's password is 'Password123!', hashed with pgcrypto's bcrypt-compatible
 * crypt()/gen_salt('bf') (migrations/sql/0009).
 */
describe('AuthRepository (integration — real PostgreSQL)', () => {
  let pool: Pool;
  let repo: AuthRepository;

  beforeAll(() => {
    pool = createPool();
    repo = new AuthRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('findByEmail', () => {
    it('returns the real seeded row for a student', async () => {
      const row = await repo.findByEmail('alice@example.edu');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('100');
      expect(row!.role).toBe('STUDENT');
      expect(row!.full_name).toBe('Alice Student');
    });

    it('returns the real seeded row for a faculty member', async () => {
      const row = await repo.findByEmail('prof.rao@example.edu');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('200');
      expect(row!.role).toBe('FACULTY');
    });

    it('returns the real seeded row for the admin', async () => {
      const row = await repo.findByEmail('admin@example.edu');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('900');
      expect(row!.role).toBe('ADMIN');
    });

    it('is case-insensitive, matching the users_email_lower_uq index', async () => {
      const row = await repo.findByEmail('PROF.RAO@EXAMPLE.EDU');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('200');
    });

    it('returns a real pgcrypto-generated bcrypt hash, not the legacy placeholder', async () => {
      const row = await repo.findByEmail('alice@example.edu');
      expect(row!.password_hash).toMatch(/^\$2[aby]\$/);
    });

    it('returns null for an email that does not exist', async () => {
      expect(await repo.findByEmail('nobody@example.edu')).toBeNull();
    });
  });
});
