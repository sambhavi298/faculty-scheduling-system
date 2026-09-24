import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Check, X } from 'lucide-react';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Table,
  adminApi,
  useToast,
  type AdminFacultyRow,
  type DepartmentRow,
} from '@faculty-scheduling/ui';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: AdminFacultyRow[]; departments: DepartmentRow[] };

interface CreateForm {
  email: string;
  fullName: string;
  phone: string;
  departmentId: string;
  staffCode: string;
  officeLocation: string;
}

const EMPTY_FORM: CreateForm = { email: '', fullName: '', phone: '', departmentId: '', staffCode: '', officeLocation: '' };

interface EditForm {
  fullName: string;
  phone: string;
  departmentId: string;
  officeLocation: string;
}

export function Faculty(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const { show } = useToast();

  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newAccountPassword, setNewAccountPassword] = useState<{ email: string; password: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  function load(): void {
    setState({ status: 'loading' });
    Promise.all([adminApi.listFaculty(), adminApi.listDepartments()])
      .then(([rows, departments]) => setState({ status: 'ready', rows, departments }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setCreateError(null);
    if (!form.email.trim() || !form.fullName.trim() || !form.departmentId || !form.staffCode.trim()) {
      setCreateError('Email, full name, department, and staff code are all required.');
      return;
    }
    setCreating(true);
    try {
      const result = await adminApi.createFaculty({
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || undefined,
        departmentId: Number(form.departmentId),
        staffCode: form.staffCode.trim(),
        officeLocation: form.officeLocation.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      setNewAccountPassword({ email: result.account.email, password: result.temporaryPassword });
      show('Faculty account created.', 'success');
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create faculty account.';
      setCreateError(message);
      show(message, 'error');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(row: AdminFacultyRow): void {
    setEditingId(row.id);
    setEditForm({
      fullName: row.full_name,
      phone: row.phone ?? '',
      departmentId: String(row.department_id),
      officeLocation: row.office_location ?? '',
    });
  }

  async function saveEdit(id: string): Promise<void> {
    if (!editForm) return;
    setSavingEdit(true);
    try {
      await adminApi.updateFaculty(id, {
        fullName: editForm.fullName.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        departmentId: editForm.departmentId ? Number(editForm.departmentId) : undefined,
        officeLocation: editForm.officeLocation.trim() || undefined,
      });
      show('Faculty record updated.', 'success');
      setEditingId(null);
      setEditForm(null);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Could not update faculty record.', 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  const rows = state.status === 'ready' ? state.rows : [];
  const departments = state.status === 'ready' ? state.departments : [];
  const departmentName = (id: number): string => departments.find((d) => d.id === id)?.name ?? `#${id}`;

  return (
    <div>
      <PageHeader title="Faculty Management" subtitle="Create, view, and update faculty profiles." />

      {state.status === 'loading' && <LoadingState label="Loading faculty…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <>
          {newAccountPassword && (
            <Card style={{ marginBottom: '1.25rem', borderColor: 'var(--accent-success)' }}>
              <div className="row gap-sm" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong>Account created for {newAccountPassword.email}</strong>
                  <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Temporary password (shown once — relay it to the faculty member yourself):{' '}
                    <code className="mono">{newAccountPassword.password}</code>
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setNewAccountPassword(null)}>
                  <X size={14} />
                </Button>
              </div>
            </Card>
          )}

          <Card style={{ marginBottom: '1.25rem' }}>
            <h2 className="section-title">New faculty account</h2>
            <form onSubmit={handleCreate} className="row gap-sm" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Email" htmlFor="f-email" error={createError ?? undefined}>
                <Input id="f-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="faculty@srmist.edu.in" />
              </Field>
              <Field label="Full name" htmlFor="f-name">
                <Input id="f-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Dr. K. Rao" />
              </Field>
              <Field label="Phone (optional)" htmlFor="f-phone">
                <Input id="f-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Department" htmlFor="f-dept">
                <Select id="f-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">Select…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Staff code" htmlFor="f-code">
                <Input id="f-code" value={form.staffCode} onChange={(e) => setForm({ ...form, staffCode: e.target.value })} placeholder="CSE-014" />
              </Field>
              <Field label="Office (optional)" htmlFor="f-office">
                <Input id="f-office" value={form.officeLocation} onChange={(e) => setForm({ ...form, officeLocation: e.target.value })} placeholder="Block A, Room 214" />
              </Field>
              <Button type="submit" loading={creating}>
                <Plus size={14} /> Create account
              </Button>
            </form>
          </Card>

          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Staff code</th>
                <th>Office</th>
                <th>Phone</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                editingId === row.id && editForm ? (
                  <tr key={row.id}>
                    <td>
                      <Input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
                    </td>
                    <td className="text-muted">{row.email}</td>
                    <td>
                      <Select value={editForm.departmentId} onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="mono text-muted">{row.staff_code}</td>
                    <td>
                      <Input value={editForm.officeLocation} onChange={(e) => setEditForm({ ...editForm, officeLocation: e.target.value })} />
                    </td>
                    <td>
                      <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                    </td>
                    <td>
                      <div className="row gap-sm">
                        <Button size="sm" variant="primary" loading={savingEdit} onClick={() => saveEdit(row.id)}>
                          <Check size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id}>
                    <td>{row.full_name}</td>
                    <td>{row.email}</td>
                    <td>{departmentName(row.department_id)}</td>
                    <td className="mono">{row.staff_code}</td>
                    <td>{row.office_location ?? '—'}</td>
                    <td>{row.phone ?? '—'}</td>
                    <td>
                      <Button size="sm" variant="secondary" onClick={() => startEdit(row)}>
                        <Pencil size={13} /> Edit
                      </Button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
