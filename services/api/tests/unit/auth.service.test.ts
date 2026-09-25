import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthService } from '../../src/services/auth.service';
import { AuthRepository, UserRow } from '../../src/repositories/auth.repository';
import { ValidationError } from '../../src/errors/validation.error';
import { UnauthenticatedError } from '../../src/errors/unauthenticated.error';

const SECRET = 'unit-test-secret';
// Cost factor 4 purely to keep this unit test suite fast — see
// migrations/sql/seed_test_data.sql's identical rationale for its seeded
// rows. AuthService itself always hashes with bcrypt's own default cost;
// this only affects the fixture password below.
const REAL_PASSWORD = 'Password123!';
let REAL_HASH: string;

function fakeRepo(): jest.Mocked<Pick<AuthRepository, 'findByIdentifier'>> {
  return { findByIdentifier: jest.fn() };
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '200',
    email: 'prof.rao@example.edu',
    password_hash: REAL_HASH,
    full_name: 'Prof. Rao',
    phone: null,
    role: 'FACULTY',
    ...overrides,
  };
}

describe('AuthService (unit — mocked AuthRepository, real bcrypt/jwt)', () => {
  beforeAll(async () => {
    REAL_HASH = await bcrypt.hash(REAL_PASSWORD, 4);
  });

  function fakeService() {
    const repo = fakeRepo();
    const service = new AuthService(repo as unknown as AuthRepository, SECRET);
    return { repo, service };
  }

  describe('input validation (never reaches the repository)', () => {
    it('rejects a missing identifier', async () => {
      const { repo, service } = fakeService();
      await expect(service.login(undefined, REAL_PASSWORD)).rejects.toThrow(ValidationError);
      expect(repo.findByIdentifier).not.toHaveBeenCalled();
    });

    it('rejects an empty/whitespace-only identifier', async () => {
      const { repo, service } = fakeService();
      await expect(service.login('   ', REAL_PASSWORD)).rejects.toThrow(ValidationError);
      expect(repo.findByIdentifier).not.toHaveBeenCalled();
    });

    it('rejects a non-string identifier', async () => {
      const { service } = fakeService();
      await expect(service.login(12345, REAL_PASSWORD)).rejects.toThrow(ValidationError);
    });

    it('rejects a missing password', async () => {
      const { repo, service } = fakeService();
      await expect(service.login('prof.rao@example.edu', undefined)).rejects.toThrow(ValidationError);
      expect(repo.findByIdentifier).not.toHaveBeenCalled();
    });

    it('rejects an empty password', async () => {
      const { repo, service } = fakeService();
      await expect(service.login('prof.rao@example.edu', '')).rejects.toThrow(ValidationError);
      expect(repo.findByIdentifier).not.toHaveBeenCalled();
    });
  });

  describe('authentication failures — same error for both, to avoid identifier enumeration', () => {
    it('throws UnauthenticatedError when no user matches that identifier', async () => {
      const { repo, service } = fakeService();
      repo.findByIdentifier.mockResolvedValueOnce(null);

      await expect(service.login('nobody@example.edu', REAL_PASSWORD)).rejects.toThrow(UnauthenticatedError);
    });

    it('throws UnauthenticatedError when the password does not match the stored hash', async () => {
      const { repo, service } = fakeService();
      repo.findByIdentifier.mockResolvedValueOnce(userRow());

      await expect(service.login('prof.rao@example.edu', 'wrong-password')).rejects.toThrow(UnauthenticatedError);
    });

    it('produces the identical error message for "no such user" and "wrong password"', async () => {
      const { repo, service } = fakeService();

      repo.findByIdentifier.mockResolvedValueOnce(null);
      let noUserMessage = '';
      try {
        await service.login('nobody@example.edu', REAL_PASSWORD);
      } catch (err) {
        noUserMessage = (err as Error).message;
      }

      repo.findByIdentifier.mockResolvedValueOnce(userRow());
      let wrongPasswordMessage = '';
      try {
        await service.login('prof.rao@example.edu', 'wrong-password');
      } catch (err) {
        wrongPasswordMessage = (err as Error).message;
      }

      expect(noUserMessage).toBe(wrongPasswordMessage);
      expect(noUserMessage).not.toBe('');
    });
  });

  describe('successful login', () => {
    it('trims the identifier before looking it up', async () => {
      const { repo, service } = fakeService();
      repo.findByIdentifier.mockResolvedValueOnce(userRow());

      await service.login('  prof.rao@example.edu  ', REAL_PASSWORD);

      expect(repo.findByIdentifier).toHaveBeenCalledWith('prof.rao@example.edu');
    });

    it('returns a token signed with the configured secret, carrying {sub, role}', async () => {
      const { repo, service } = fakeService();
      repo.findByIdentifier.mockResolvedValueOnce(userRow({ id: '200', role: 'FACULTY' }));

      const result = await service.login('prof.rao@example.edu', REAL_PASSWORD);

      const decoded = jwt.verify(result.token, SECRET) as { sub: string; role: string };
      expect(decoded.sub).toBe('200');
      expect(decoded.role).toBe('FACULTY');
    });

    it('rejects a token verified against the wrong secret', async () => {
      const { repo, service } = fakeService();
      repo.findByIdentifier.mockResolvedValueOnce(userRow());

      const result = await service.login('prof.rao@example.edu', REAL_PASSWORD);

      expect(() => jwt.verify(result.token, 'a-different-secret')).toThrow();
    });

    it('returns user details (id, role, fullName, email) alongside the token, never the password hash', async () => {
      const { repo, service } = fakeService();
      repo.findByIdentifier.mockResolvedValueOnce(
        userRow({ id: '900', role: 'ADMIN', full_name: 'Admin User', email: 'admin@example.edu' })
      );

      const result = await service.login('admin@example.edu', REAL_PASSWORD);

      expect(result.user).toEqual({ id: '900', role: 'ADMIN', fullName: 'Admin User', email: 'admin@example.edu' });
      expect(JSON.stringify(result.user)).not.toMatch(/password/i);
    });

    it('works for every seeded role (STUDENT, FACULTY, ADMIN)', async () => {
      for (const role of ['STUDENT', 'FACULTY', 'ADMIN'] as const) {
        const { repo, service } = fakeService();
        repo.findByIdentifier.mockResolvedValueOnce(userRow({ role }));

        const result = await service.login('prof.rao@example.edu', REAL_PASSWORD);
        expect(result.user.role).toBe(role);
      }
    });
  });
});
