import { AdminService } from '../../src/services/admin.service';
import { AdminRepository } from '../../src/repositories/admin.repository';
import { ValidationError } from '../../src/errors/validation.error';

function fakeRepo() {
  return {
    listDepartments: jest.fn(),
    createDepartment: jest.fn(),
    updateDepartment: jest.fn(),
    listBatches: jest.fn(),
    createBatch: jest.fn(),
    updateBatch: jest.fn(),
    listFaculty: jest.fn(),
    createFaculty: jest.fn(),
    updateFaculty: jest.fn(),
    listStudents: jest.fn(),
    createStudent: jest.fn(),
    updateStudent: jest.fn(),
    listAppointments: jest.fn(),
    listAuditLog: jest.fn(),
    getCounts: jest.fn(),
    refreshFacultyStats: jest.fn(),
    listFacultyStats: jest.fn(),
    getWorkloadReport: jest.fn(),
  } as unknown as jest.Mocked<AdminRepository>;
}

describe('AdminService (unit — mocked AdminRepository, real bcrypt)', () => {
  function fakeService() {
    const repo = fakeRepo();
    const service = new AdminService(repo as unknown as AdminRepository);
    return { repo, service };
  }

  describe('Departments', () => {
    // createDepartment/createBatch/listBatches/listAppointments/listAuditLog
    // are NOT declared `async` in admin.service.ts (they validate
    // synchronously, then return the repository's own Promise) — a failed
    // validation therefore throws synchronously, at the call-site
    // expression itself, rather than as a rejected Promise. The HTTP
    // Controller still catches this fine (a synchronous throw inside a
    // `try { await service.foo() }` block is caught exactly like a
    // rejection), but the test must assert it with a plain
    // `expect(() => ...).toThrow()`, not `.rejects.toThrow()` (which
    // requires the call to actually return a Promise, which a synchronous
    // throw never does).
    it('createDepartment rejects a missing name', () => {
      const { service } = fakeService();
      expect(() => service.createDepartment({ name: '', code: 'CSE' })).toThrow(ValidationError);
    });

    it('createDepartment rejects a missing code', () => {
      const { service } = fakeService();
      expect(() => service.createDepartment({ name: 'CS', code: '' })).toThrow(ValidationError);
    });

    it('createDepartment trims and delegates to the repository', async () => {
      const { repo, service } = fakeService();
      repo.createDepartment.mockResolvedValueOnce({ id: 1, name: 'CS', code: 'CSE' });

      await service.createDepartment({ name: '  CS  ', code: '  CSE  ' });

      expect(repo.createDepartment).toHaveBeenCalledWith('CS', 'CSE');
    });

    it('updateDepartment rejects a non-positive-integer id', async () => {
      const { service } = fakeService();
      await expect(service.updateDepartment('abc', {})).rejects.toThrow(ValidationError);
      await expect(service.updateDepartment(-1, {})).rejects.toThrow(ValidationError);
    });

    it('updateDepartment throws ValidationError when the repository finds nothing to update', async () => {
      const { repo, service } = fakeService();
      repo.updateDepartment.mockResolvedValueOnce(null);

      await expect(service.updateDepartment(999, { name: 'X' })).rejects.toThrow(ValidationError);
    });

    it('rejects a non-string optional field (optionalString\'s type-guard branch)', async () => {
      const { service } = fakeService();
      await expect(service.updateDepartment(1, { name: 42 as any })).rejects.toThrow(ValidationError);
    });
  });

  describe('Batches', () => {
    it('createBatch requires departmentId, name, academicYear', () => {
      const { service } = fakeService();
      expect(() => service.createBatch({ departmentId: 0, name: 'B1', academicYear: '2026-2027' })).toThrow(ValidationError);
      expect(() => service.createBatch({ departmentId: 1, name: '', academicYear: '2026-2027' })).toThrow(ValidationError);
      expect(() => service.createBatch({ departmentId: 1, name: 'B1', academicYear: '' })).toThrow(ValidationError);
    });

    it('listBatches passes through a valid departmentId', async () => {
      const { repo, service } = fakeService();
      repo.listBatches.mockResolvedValueOnce([]);

      await service.listBatches(1);
      expect(repo.listBatches).toHaveBeenCalledWith(1);
    });

    it('listBatches passes undefined through when no departmentId filter is given', async () => {
      const { repo, service } = fakeService();
      repo.listBatches.mockResolvedValueOnce([]);

      await service.listBatches();
      expect(repo.listBatches).toHaveBeenCalledWith(undefined);
    });

    it('listBatches rejects a non-integer departmentId', () => {
      const { service } = fakeService();
      expect(() => service.listBatches('abc')).toThrow(ValidationError);
    });

    it('updateBatch rejects a non-positive-integer id', async () => {
      const { service } = fakeService();
      await expect(service.updateBatch('abc', {})).rejects.toThrow(ValidationError);
    });

    it('updateBatch throws ValidationError when the repository finds nothing to update', async () => {
      const { repo, service } = fakeService();
      repo.updateBatch.mockResolvedValueOnce(null);

      await expect(service.updateBatch(999, { name: 'X' })).rejects.toThrow(ValidationError);
    });

    it('updateBatch returns the updated row on success', async () => {
      const { repo, service } = fakeService();
      const row = { id: 1, department_id: 1, name: 'Renamed', academic_year: '2026-2027' };
      repo.updateBatch.mockResolvedValueOnce(row);

      expect(await service.updateBatch(1, { name: 'Renamed' })).toEqual(row);
    });
  });

  describe('Faculty', () => {
    it('listFaculty delegates directly to the repository', async () => {
      const { repo, service } = fakeService();
      const rows = [{ id: '200', email: 'prof.rao@example.edu', full_name: 'Prof. Rao', phone: null, department_id: 1, staff_code: 'CSE-F01', office_location: null }];
      repo.listFaculty.mockResolvedValueOnce(rows);

      expect(await service.listFaculty()).toEqual(rows);
    });

    it('createFaculty validates email format', async () => {
      const { service } = fakeService();
      await expect(
        service.createFaculty({ email: 'not-an-email', fullName: 'X', departmentId: 1, staffCode: 'F1' })
      ).rejects.toThrow(ValidationError);
    });

    it('createFaculty requires departmentId to be a positive integer', async () => {
      const { service } = fakeService();
      await expect(
        service.createFaculty({ email: 'x@example.edu', fullName: 'X', departmentId: 0, staffCode: 'F1' })
      ).rejects.toThrow(ValidationError);
    });

    it('createFaculty generates a real bcrypt-hashed temporary password and returns it exactly once', async () => {
      const { repo, service } = fakeService();
      repo.createFaculty.mockImplementationOnce(async (input: any) => ({
        id: '210', email: input.email, full_name: input.fullName, phone: input.phone,
        department_id: input.departmentId, staff_code: input.staffCode, office_location: input.officeLocation,
      }));

      const result = await service.createFaculty({
        email: 'new.faculty@example.edu', fullName: 'New Faculty', departmentId: 1, staffCode: 'CSE-F10',
      });

      expect(result.temporaryPassword).toHaveLength(16);
      expect(result.account.email).toBe('new.faculty@example.edu');

      const [callArgs] = repo.createFaculty.mock.calls;
      expect(callArgs[0].passwordHash).not.toBe(result.temporaryPassword);
      expect(callArgs[0].passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('createFaculty defaults phone/officeLocation to null when omitted', async () => {
      const { repo, service } = fakeService();
      repo.createFaculty.mockResolvedValueOnce({ id: '210', email: 'x@example.edu', full_name: 'X', phone: null, department_id: 1, staff_code: 'F1', office_location: null });

      await service.createFaculty({ email: 'x@example.edu', fullName: 'X', departmentId: 1, staffCode: 'F1' });

      const callArgs = repo.createFaculty.mock.calls[0][0];
      expect(callArgs.phone).toBeNull();
      expect(callArgs.officeLocation).toBeNull();
    });

    it('updateFaculty rejects an empty id', async () => {
      const { service } = fakeService();
      await expect(service.updateFaculty('', {})).rejects.toThrow(ValidationError);
    });

    it('updateFaculty throws ValidationError when the repository finds nothing to update', async () => {
      const { repo, service } = fakeService();
      repo.updateFaculty.mockResolvedValueOnce(null);

      await expect(service.updateFaculty('999', {})).rejects.toThrow(ValidationError);
    });

    it('updateFaculty returns the updated row on success, with a valid departmentId passed through', async () => {
      const { repo, service } = fakeService();
      const row = { id: '200', email: 'prof.rao@example.edu', full_name: 'Updated Name', phone: null, department_id: 2, staff_code: 'CSE-F01', office_location: null };
      repo.updateFaculty.mockResolvedValueOnce(row);

      const result = await service.updateFaculty('200', { fullName: 'Updated Name', departmentId: 2 });

      expect(result).toEqual(row);
      expect(repo.updateFaculty).toHaveBeenCalledWith('200', { fullName: 'Updated Name', phone: null, departmentId: 2, officeLocation: null });
    });

    it('updateFaculty rejects a non-positive-integer departmentId when provided', async () => {
      const { service } = fakeService();
      await expect(service.updateFaculty('200', { departmentId: 0 })).rejects.toThrow(ValidationError);
    });
  });

  describe('Students', () => {
    it('listStudents delegates directly to the repository with no filter', async () => {
      const { repo, service } = fakeService();
      repo.listStudents.mockResolvedValueOnce([]);

      await service.listStudents();
      expect(repo.listStudents).toHaveBeenCalledWith(undefined);
    });

    it('listStudents passes through a valid batchId', async () => {
      const { repo, service } = fakeService();
      repo.listStudents.mockResolvedValueOnce([]);

      await service.listStudents(1);
      expect(repo.listStudents).toHaveBeenCalledWith(1);
    });

    it('listStudents rejects a non-integer batchId', () => {
      const { service } = fakeService();
      expect(() => service.listStudents('abc')).toThrow(ValidationError);
    });

    it('createStudent validates email, fullName, batchId, rollNumber', async () => {
      const { service } = fakeService();
      await expect(
        service.createStudent({ email: 'bad', fullName: 'X', batchId: 1, rollNumber: 'R1' })
      ).rejects.toThrow(ValidationError);
      await expect(
        service.createStudent({ email: 'x@example.edu', fullName: '', batchId: 1, rollNumber: 'R1' })
      ).rejects.toThrow(ValidationError);
      await expect(
        service.createStudent({ email: 'x@example.edu', fullName: 'X', batchId: 0, rollNumber: 'R1' })
      ).rejects.toThrow(ValidationError);
      await expect(
        service.createStudent({ email: 'x@example.edu', fullName: 'X', batchId: 1, rollNumber: '' })
      ).rejects.toThrow(ValidationError);
    });

    it('createStudent generates a real bcrypt-hashed temporary password', async () => {
      const { repo, service } = fakeService();
      repo.createStudent.mockImplementationOnce(async (input: any) => ({
        id: '110', email: input.email, full_name: input.fullName, phone: input.phone, batch_id: input.batchId, roll_number: input.rollNumber,
      }));

      const result = await service.createStudent({ email: 'new.student@example.edu', fullName: 'New Student', batchId: 1, rollNumber: 'R999' });

      expect(result.temporaryPassword).toHaveLength(16);
      const passwordHash = repo.createStudent.mock.calls[0][0].passwordHash;
      expect(passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('updateStudent throws ValidationError when the repository finds nothing to update', async () => {
      const { repo, service } = fakeService();
      repo.updateStudent.mockResolvedValueOnce(null);

      await expect(service.updateStudent('999', {})).rejects.toThrow(ValidationError);
    });

    it('updateStudent returns the updated row on success, with a valid batchId passed through', async () => {
      const { repo, service } = fakeService();
      const row = { id: '100', email: 'alice@example.edu', full_name: 'Updated Name', phone: null, batch_id: 2, roll_number: 'CSE2026-001' };
      repo.updateStudent.mockResolvedValueOnce(row);

      const result = await service.updateStudent('100', { fullName: 'Updated Name', batchId: 2 });

      expect(result).toEqual(row);
      expect(repo.updateStudent).toHaveBeenCalledWith('100', { fullName: 'Updated Name', phone: null, batchId: 2 });
    });

    it('updateStudent rejects a non-positive-integer batchId when provided', async () => {
      const { service } = fakeService();
      await expect(service.updateStudent('100', { batchId: 0 })).rejects.toThrow(ValidationError);
    });
  });

  describe('listAppointments (read-only)', () => {
    it('rejects an invalid status', () => {
      const { service } = fakeService();
      expect(() => service.listAppointments({ status: 'BOGUS' })).toThrow(ValidationError);
    });

    it('accepts every valid appointment status', async () => {
      for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'MISSED', 'EXPIRED']) {
        const { repo, service } = fakeService();
        repo.listAppointments.mockResolvedValueOnce([]);
        await service.listAppointments({ status });
        expect(repo.listAppointments).toHaveBeenCalled();
      }
    });

    it('applies default pagination (page 1, pageSize 25) when not given', async () => {
      const { repo, service } = fakeService();
      repo.listAppointments.mockResolvedValueOnce([]);

      await service.listAppointments({});

      expect(repo.listAppointments).toHaveBeenCalledWith(
        { status: undefined, facultyId: undefined, studentId: undefined },
        25,
        0
      );
    });

    it('computes offset from a custom page/pageSize', async () => {
      const { repo, service } = fakeService();
      repo.listAppointments.mockResolvedValueOnce([]);

      await service.listAppointments({ page: '3', pageSize: '10' });

      expect(repo.listAppointments).toHaveBeenCalledWith(expect.anything(), 10, 20);
    });

    it('rejects a non-positive page', () => {
      const { service } = fakeService();
      expect(() => service.listAppointments({ page: '0' })).toThrow(ValidationError);
    });

    it('rejects a pageSize above the maximum (100)', () => {
      const { service } = fakeService();
      expect(() => service.listAppointments({ pageSize: '101' })).toThrow(ValidationError);
    });
  });

  describe('listAuditLog (read-only)', () => {
    it('applies default pagination', async () => {
      const { repo, service } = fakeService();
      repo.listAuditLog.mockResolvedValueOnce([]);

      await service.listAuditLog({});

      expect(repo.listAuditLog).toHaveBeenCalledWith({ entityType: undefined, entityId: undefined }, 25, 0);
    });
  });

  describe('Dashboard & reporting', () => {
    it('getDashboard refreshes the materialized view before reading counts and stats', async () => {
      const { repo, service } = fakeService();
      const callOrder: string[] = [];
      repo.refreshFacultyStats.mockImplementationOnce(async () => {
        callOrder.push('refresh');
      });
      repo.getCounts.mockImplementationOnce(async () => {
        callOrder.push('counts');
        return {
          total_students: 0, total_faculty: 0, total_departments: 0,
          pending_appointments: 0, approved_appointments: 0, completed_appointments: 0,
        };
      });
      repo.listFacultyStats.mockImplementationOnce(async () => {
        callOrder.push('stats');
        return [];
      });

      const result = await service.getDashboard();

      expect(callOrder[0]).toBe('refresh');
      expect(callOrder).toContain('counts');
      expect(callOrder).toContain('stats');
      expect(result.counts.total_students).toBe(0);
      expect(result.facultyStats).toEqual([]);
    });

    it('getWorkloadReport delegates directly to the repository', async () => {
      const { repo, service } = fakeService();
      const rows = [{ faculty_id: '200', full_name: 'Prof. Rao', week_start: '2026-08-24', appointments_that_week: 3, workload_rank: 1, running_total_this_semester: 3 }];
      repo.getWorkloadReport.mockResolvedValueOnce(rows);

      expect(await service.getWorkloadReport()).toEqual(rows);
    });
  });
});
