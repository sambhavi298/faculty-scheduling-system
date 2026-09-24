import bcrypt from 'bcrypt';
import crypto from 'crypto';
import {
  AdminRepository,
  DepartmentRow,
  BatchRow,
  AdminFacultyRow,
  AdminStudentRow,
  AuditLogRow,
  FacultyStatsRow,
  WorkloadReportRow,
} from '../repositories/admin.repository';
import { ValidationError } from '../errors/validation.error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const VALID_APPOINTMENT_STATUSES = new Set([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
  'MISSED',
  'EXPIRED',
]);

export interface DashboardResponse {
  counts: {
    total_students: number;
    total_faculty: number;
    total_departments: number;
    pending_appointments: number;
    approved_appointments: number;
    completed_appointments: number;
  };
  facultyStats: FacultyStatsRow[];
}

export interface CreatedAccount<T> {
  account: T;
  /**
   * Returned ONCE, at creation time only — never stored in plaintext
   * anywhere, never retrievable again after this response. This is the
   * genuinely simplest design that satisfies "an admin can create faculty/
   * student accounts" without inventing an email-delivery system (Level 2
   * explicitly scoped notifications as in-app only, no email sending
   * infrastructure exists in this codebase) or a self-registration flow
   * (out of scope — nothing in Level 1-5 describes one). The admin is
   * expected to relay this to the new user through some out-of-band channel
   * they already have (in person, an existing institutional email system,
   * etc.) — the same real-world pattern as any "temporary password, change
   * it on first login" flow, minus the forced-change-on-first-login
   * enforcement, which would be a genuine follow-up if this went further
   * than a course project.
   */
  temporaryPassword: string;
}

function generateTemporaryPassword(): string {
  // 12 random bytes -> 16 base64url characters: enough entropy that a
  // temporary password isn't meaningfully guessable, short enough to relay
  // to someone over the phone or in person.
  return crypto.randomBytes(12).toString('base64url');
}

function validatePagination(page: unknown, pageSize: unknown): { limit: number; offset: number } {
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedPageSize = pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(pageSize);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    throw new ValidationError('page must be a positive integer');
  }
  if (!Number.isInteger(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > MAX_PAGE_SIZE) {
    throw new ValidationError(`pageSize must be a positive integer no greater than ${MAX_PAGE_SIZE}`);
  }
  return { limit: parsedPageSize, offset: (parsedPage - 1) * parsedPageSize };
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${label} is required`);
  }
  return value.trim();
}

function requireEmail(value: unknown): string {
  const email = requireNonEmptyString(value, 'email');
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError('email must be a valid email address');
  }
  return email;
}

function requirePositiveInt(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`${label} must be a positive integer`);
  }
  return n;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError('expected a string value');
  return value;
}

/**
 * Orchestrates the Admin & Reporting module (Level 5's "Administration
 * Module"/"Reporting Module" — path/shape not concretely defined at Level 5,
 * unlike the Appointment/Availability modules; this Service is where that
 * design decision is finally made, consistent with docs/GITHUB_ISSUES.md's
 * "propose them alongside the backend work"). Validates every write before
 * it reaches SQL, generates and hashes a temporary password for every new
 * account (bcrypt — the same library and cost as real login verification in
 * AuthService, never the seed data's lower test-only cost factor), and
 * enforces the Level 3 Security Architecture rule that admin actions are
 * read-only with respect to appointments — this class exposes no method
 * that can create, approve, reject, or otherwise mutate an appointment;
 * only AppointmentService can.
 */
export class AdminService {
  constructor(private readonly repo: AdminRepository) {}

  // ---- Departments ----

  listDepartments(): Promise<DepartmentRow[]> {
    return this.repo.listDepartments();
  }

  createDepartment(input: { name: unknown; code: unknown }): Promise<DepartmentRow> {
    const name = requireNonEmptyString(input.name, 'name');
    const code = requireNonEmptyString(input.code, 'code');
    return this.repo.createDepartment(name, code);
  }

  async updateDepartment(id: unknown, input: { name?: unknown; code?: unknown }): Promise<DepartmentRow> {
    const departmentId = requirePositiveInt(id, 'department id');
    const updated = await this.repo.updateDepartment(departmentId, optionalString(input.name), optionalString(input.code));
    if (!updated) {
      throw new ValidationError('No department exists with that id.');
    }
    return updated;
  }

  // ---- Batches ----

  listBatches(departmentId?: unknown): Promise<BatchRow[]> {
    return this.repo.listBatches(departmentId === undefined ? undefined : requirePositiveInt(departmentId, 'departmentId'));
  }

  createBatch(input: { departmentId: unknown; name: unknown; academicYear: unknown }): Promise<BatchRow> {
    const departmentId = requirePositiveInt(input.departmentId, 'departmentId');
    const name = requireNonEmptyString(input.name, 'name');
    const academicYear = requireNonEmptyString(input.academicYear, 'academicYear');
    return this.repo.createBatch(departmentId, name, academicYear);
  }

  async updateBatch(id: unknown, input: { name?: unknown; academicYear?: unknown }): Promise<BatchRow> {
    const batchId = requirePositiveInt(id, 'batch id');
    const updated = await this.repo.updateBatch(batchId, optionalString(input.name), optionalString(input.academicYear));
    if (!updated) {
      throw new ValidationError('No batch exists with that id.');
    }
    return updated;
  }

  // ---- Faculty ----

  listFaculty(): Promise<AdminFacultyRow[]> {
    return this.repo.listFaculty();
  }

  async createFaculty(input: {
    email: unknown;
    fullName: unknown;
    phone?: unknown;
    departmentId: unknown;
    staffCode: unknown;
    officeLocation?: unknown;
  }): Promise<CreatedAccount<AdminFacultyRow>> {
    const email = requireEmail(input.email);
    const fullName = requireNonEmptyString(input.fullName, 'fullName');
    const departmentId = requirePositiveInt(input.departmentId, 'departmentId');
    const staffCode = requireNonEmptyString(input.staffCode, 'staffCode');
    const phone = optionalString(input.phone) ?? null;
    const officeLocation = optionalString(input.officeLocation) ?? null;

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const account = await this.repo.createFaculty({ email, passwordHash, fullName, phone, departmentId, staffCode, officeLocation });
    return { account, temporaryPassword };
  }

  async updateFaculty(
    id: unknown,
    input: { fullName?: unknown; phone?: unknown; departmentId?: unknown; officeLocation?: unknown }
  ): Promise<AdminFacultyRow> {
    const facultyId = requireNonEmptyString(id, 'faculty id');
    const updated = await this.repo.updateFaculty(facultyId, {
      fullName: optionalString(input.fullName),
      phone: optionalString(input.phone) ?? null,
      departmentId: input.departmentId === undefined ? undefined : requirePositiveInt(input.departmentId, 'departmentId'),
      officeLocation: optionalString(input.officeLocation) ?? null,
    });
    if (!updated) {
      throw new ValidationError('No faculty member exists with that id.');
    }
    return updated;
  }

  // ---- Students ----

  listStudents(batchId?: unknown): Promise<AdminStudentRow[]> {
    return this.repo.listStudents(batchId === undefined ? undefined : requirePositiveInt(batchId, 'batchId'));
  }

  async createStudent(input: {
    email: unknown;
    fullName: unknown;
    phone?: unknown;
    batchId: unknown;
    rollNumber: unknown;
  }): Promise<CreatedAccount<AdminStudentRow>> {
    const email = requireEmail(input.email);
    const fullName = requireNonEmptyString(input.fullName, 'fullName');
    const batchId = requirePositiveInt(input.batchId, 'batchId');
    const rollNumber = requireNonEmptyString(input.rollNumber, 'rollNumber');
    const phone = optionalString(input.phone) ?? null;

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const account = await this.repo.createStudent({ email, passwordHash, fullName, phone, batchId, rollNumber });
    return { account, temporaryPassword };
  }

  async updateStudent(id: unknown, input: { fullName?: unknown; phone?: unknown; batchId?: unknown }): Promise<AdminStudentRow> {
    const studentId = requireNonEmptyString(id, 'student id');
    const updated = await this.repo.updateStudent(studentId, {
      fullName: optionalString(input.fullName),
      phone: optionalString(input.phone) ?? null,
      batchId: input.batchId === undefined ? undefined : requirePositiveInt(input.batchId, 'batchId'),
    });
    if (!updated) {
      throw new ValidationError('No student exists with that id.');
    }
    return updated;
  }

  // ---- Appointments (read-only) ----

  listAppointments(query: { status?: unknown; facultyId?: unknown; studentId?: unknown; page?: unknown; pageSize?: unknown }) {
    if (query.status !== undefined && !VALID_APPOINTMENT_STATUSES.has(query.status as string)) {
      throw new ValidationError(`status must be one of: ${Array.from(VALID_APPOINTMENT_STATUSES).join(', ')}`);
    }
    const { limit, offset } = validatePagination(query.page, query.pageSize);
    return this.repo.listAppointments(
      {
        status: query.status as string | undefined,
        facultyId: optionalString(query.facultyId),
        studentId: optionalString(query.studentId),
      },
      limit,
      offset
    );
  }

  // ---- Audit log (read-only) ----

  listAuditLog(query: { entityType?: unknown; entityId?: unknown; page?: unknown; pageSize?: unknown }): Promise<AuditLogRow[]> {
    const { limit, offset } = validatePagination(query.page, query.pageSize);
    return this.repo.listAuditLog(
      { entityType: optionalString(query.entityType), entityId: optionalString(query.entityId) },
      limit,
      offset
    );
  }

  // ---- Dashboard & reporting ----

  async getDashboard(): Promise<DashboardResponse> {
    await this.repo.refreshFacultyStats();
    const [counts, facultyStats] = await Promise.all([this.repo.getCounts(), this.repo.listFacultyStats()]);
    return { counts, facultyStats };
  }

  getWorkloadReport(): Promise<WorkloadReportRow[]> {
    return this.repo.getWorkloadReport();
  }
}
