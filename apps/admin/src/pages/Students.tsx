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
  type AdminStudentRow,
  type BatchRow,
} from '@faculty-scheduling/ui';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: AdminStudentRow[]; batches: BatchRow[] };

interface CreateForm {
  email: string;
  fullName: string;
  phone: string;
  batchId: string;
  rollNumber: string;
}

const EMPTY_FORM: CreateForm = { email: '', fullName: '', phone: '', batchId: '', rollNumber: '' };

interface EditForm {
  fullName: string;
  phone: string;
  batchId: string;
}

export function Students(): React.ReactElement {
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
    Promise.all([adminApi.listStudents(), adminApi.listBatches()])
      .then(([rows, batches]) => setState({ status: 'ready', rows, batches }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setCreateError(null);
    if (!form.email.trim() || !form.fullName.trim() || !form.batchId || !form.rollNumber.trim()) {
      setCreateError('Email, full name, batch, and roll number are all required.');
      return;
    }
    setCreating(true);
    try {
      const result = await adminApi.createStudent({
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || undefined,
        batchId: Number(form.batchId),
        rollNumber: form.rollNumber.trim(),
      });
      setForm(EMPTY_FORM);
      setNewAccountPassword({ email: result.account.email, password: result.temporaryPassword });
      show('Student account created.', 'success');
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create student account.';
      setCreateError(message);
      show(message, 'error');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(row: AdminStudentRow): void {
    setEditingId(row.id);
    setEditForm({ fullName: row.full_name, phone: row.phone ?? '', batchId: String(row.batch_id) });
  }

  async function saveEdit(id: string): Promise<void> {
    if (!editForm) return;
    setSavingEdit(true);
    try {
      await adminApi.updateStudent(id, {
        fullName: editForm.fullName.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        batchId: editForm.batchId ? Number(editForm.batchId) : undefined,
      });
      show('Student record updated.', 'success');
      setEditingId(null);
      setEditForm(null);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Could not update student record.', 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  const rows = state.status === 'ready' ? state.rows : [];
  const batches = state.status === 'ready' ? state.batches : [];
  const batchLabel = (id: number): string => {
    const b = batches.find((x) => x.id === id);
    return b ? `${b.name} (${b.academic_year})` : `#${id}`;
  };

  return (
    <div>
      <PageHeader title="Student Management" subtitle="Create, view, and update student records and batch assignments." />

      {state.status === 'loading' && <LoadingState label="Loading students…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <>
          {newAccountPassword && (
            <Card style={{ marginBottom: '1.25rem', borderColor: 'var(--accent-success)' }}>
              <div className="row gap-sm" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong>Account created for {newAccountPassword.email}</strong>
                  <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Temporary password (shown once — relay it to the student yourself):{' '}
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
            <h2 className="section-title">New student account</h2>
            <form onSubmit={handleCreate} className="row gap-sm" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Email" htmlFor="s-email" error={createError ?? undefined}>
                <Input id="s-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="student@srmist.edu.in" />
              </Field>
              <Field label="Full name" htmlFor="s-name">
                <Input id="s-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Priya Sharma" />
              </Field>
              <Field label="Phone (optional)" htmlFor="s-phone">
                <Input id="s-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Batch" htmlFor="s-batch">
                <Select id="s-batch" value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value })}>
                  <option value="">Select…</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.academic_year})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Roll number" htmlFor="s-roll">
                <Input id="s-roll" value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} placeholder="RA2211003010123" />
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
                <th>Batch</th>
                <th>Roll number</th>
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
                      <Select value={editForm.batchId} onChange={(e) => setEditForm({ ...editForm, batchId: e.target.value })}>
                        {batches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.academic_year})
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="mono text-muted">{row.roll_number}</td>
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
                    <td>{batchLabel(row.batch_id)}</td>
                    <td className="mono">{row.roll_number}</td>
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
