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

  describe('findByIdentifier', () => {
    it('returns the real seeded row for a student, by email', async () => {
      const row = await repo.findByIdentifier('alice@example.edu');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('100');
      expect(row!.role).toBe('STUDENT');
      expect(row!.full_name).toBe('Alice Student');
    });

    it('returns the real seeded row for a student, by registration (roll) number', async () => {
      const row = await repo.findByIdentifier('CSE2026-001');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('100');
      expect(row!.role).toBe('STUDENT');
    });

    it('returns the real seeded row for a faculty member, by email', async () => {
      const row = await repo.findByIdentifier('prof.rao@example.edu');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('200');
      expect(row!.role).toBe('FACULTY');
    });

    it('returns the real seeded row for a faculty member, by staff code', async () => {
      const row = await repo.findByIdentifier('CSE-F01');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('200');
      expect(row!.role).toBe('FACULTY');
    });

    it('returns the real seeded row for the admin, by email', async () => {
      const row = await repo.findByIdentifier('admin@example.edu');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('900');
      expect(row!.role).toBe('ADMIN');
    });

    it('is case-insensitive on email, matching the users_email_lower_uq index', async () => {
      const row = await repo.findByIdentifier('PROF.RAO@EXAMPLE.EDU');
      expect(row).not.toBeNull();
      expect(row!.id).toBe('200');
    });

    it('is case-SENSITIVE on roll_number/staff_code, matching their plain (non-LOWER) unique constraints', async () => {
      expect(await repo.findByIdentifier('cse2026-001')).toBeNull();
      expect(await repo.findByIdentifier('cse-f01')).toBeNull();
    });

    it('returns a real pgcrypto-generated bcrypt hash, not the legacy placeholder', async () => {
      const row = await repo.findByIdentifier('alice@example.edu');
      expect(row!.password_hash).toMatch(/^\$2[aby]\$/);
    });

    it('returns null for an identifier that matches nothing', async () => {
      expect(await repo.findByIdentifier('nobody@example.edu')).toBeNull();
    });
  });
});
