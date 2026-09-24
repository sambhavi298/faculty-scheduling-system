import { apiClient } from './client';
import type {
  AdminAppointmentRow,
  AdminFacultyRow,
  AdminStudentRow,
  AuditLogRow,
  BatchRow,
  CreatedAccount,
  DashboardResponse,
  DepartmentRow,
  WorkloadReportRow,
} from '../types';

/**
 * Corresponds 1:1 to services/api/src/routes/admin.routes.ts — every route
 * there is ADMIN-only. Appointment and audit-log endpoints are deliberately
 * GET-only here too: there is no admin-specific appointment write path
 * anywhere in the backend (Level 3 Security Architecture — admin actions on
 * appointments must go through the same guarded transactional functions any
 * other actor uses), and audit_log is append-only by database grant.
 */

export interface CreateDepartmentBody {
  name: string;
  code: string;
}

export interface UpdateDepartmentBody {
  name?: string;
  code?: string;
}

export interface CreateBatchBody {
  departmentId: number;
  name: string;
  academicYear: string;
}

export interface UpdateBatchBody {
  name?: string;
  academicYear?: string;
}

export interface CreateFacultyBody {
  email: string;
  fullName: string;
  phone?: string;
  departmentId: number;
  staffCode: string;
  officeLocation?: string;
}

export interface UpdateFacultyBody {
  fullName?: string;
  phone?: string;
  departmentId?: number;
  officeLocation?: string;
}

export interface CreateStudentBody {
  email: string;
  fullName: string;
  phone?: string;
  batchId: number;
  rollNumber: string;
}

export interface UpdateStudentBody {
  fullName?: string;
  phone?: string;
  batchId?: number;
}

export interface AdminAppointmentListParams {
  [key: string]: string | number | undefined;
  status?: string;
  facultyId?: string;
  studentId?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminAuditLogListParams {
  [key: string]: string | number | undefined;
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const adminApi = {
  // ---- Departments ----
  listDepartments: (): Promise<DepartmentRow[]> => apiClient.get('/api/admin/departments'),
  createDepartment: (body: CreateDepartmentBody): Promise<DepartmentRow> => apiClient.post('/api/admin/departments', body),
  updateDepartment: (id: number, body: UpdateDepartmentBody): Promise<DepartmentRow> =>
    apiClient.patch(`/api/admin/departments/${id}`, body),

  // ---- Batches ----
  listBatches: (departmentId?: number): Promise<BatchRow[]> =>
    apiClient.get(`/api/admin/batches${toQuery({ departmentId })}`),
  createBatch: (body: CreateBatchBody): Promise<BatchRow> => apiClient.post('/api/admin/batches', body),
  updateBatch: (id: number, body: UpdateBatchBody): Promise<BatchRow> => apiClient.patch(`/api/admin/batches/${id}`, body),

  // ---- Faculty ----
  listFaculty: (): Promise<AdminFacultyRow[]> => apiClient.get('/api/admin/faculty'),
  createFaculty: (body: CreateFacultyBody): Promise<CreatedAccount<AdminFacultyRow>> => apiClient.post('/api/admin/faculty', body),
  updateFaculty: (id: string, body: UpdateFacultyBody): Promise<AdminFacultyRow> =>
    apiClient.patch(`/api/admin/faculty/${encodeURIComponent(id)}`, body),

  // ---- Students ----
  listStudents: (batchId?: number): Promise<AdminStudentRow[]> =>
    apiClient.get(`/api/admin/students${toQuery({ batchId })}`),
  createStudent: (body: CreateStudentBody): Promise<CreatedAccount<AdminStudentRow>> => apiClient.post('/api/admin/students', body),
  updateStudent: (id: string, body: UpdateStudentBody): Promise<AdminStudentRow> =>
    apiClient.patch(`/api/admin/students/${encodeURIComponent(id)}`, body),

  // ---- Appointments (read-only) ----
  listAppointments: (params: AdminAppointmentListParams = {}): Promise<AdminAppointmentRow[]> =>
    apiClient.get(`/api/admin/appointments${toQuery(params)}`),

  // ---- Audit log (read-only) ----
  listAuditLog: (params: AdminAuditLogListParams = {}): Promise<AuditLogRow[]> =>
    apiClient.get(`/api/admin/audit-log${toQuery(params)}`),

  // ---- Dashboard & reporting ----
  getDashboard: (): Promise<DashboardResponse> => apiClient.get('/api/admin/dashboard'),
  getWorkloadReport: (): Promise<WorkloadReportRow[]> => apiClient.get('/api/admin/reports/appointments-summary'),
};
