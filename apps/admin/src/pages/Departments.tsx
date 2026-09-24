import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
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
  type BatchRow,
  type DepartmentRow,
} from '@faculty-scheduling/ui';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; departments: DepartmentRow[]; batches: BatchRow[] };

/**
 * Departments AND batches live on one page — the admin nav (AdminLayout)
 * has no separate "Batches" item, and a batch only ever makes sense
 * scoped to a department (batches.department_id is NOT NULL), so managing
 * both together, department-first, matches the real data model rather
 * than inventing a standalone Batches screen.
 */
export function Departments(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const { show } = useToast();

  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptSubmitting, setDeptSubmitting] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);

  const [batchDept, setBatchDept] = useState('');
  const [batchName, setBatchName] = useState('');
  const [batchYear, setBatchYear] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  function load(): void {
    setState({ status: 'loading' });
    Promise.all([adminApi.listDepartments(), adminApi.listBatches()])
      .then(([departments, batches]) => setState({ status: 'ready', departments, batches }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, []);

  async function handleCreateDepartment(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setDeptError(null);
    if (!deptName.trim() || !deptCode.trim()) {
      setDeptError('Both name and code are required.');
      return;
    }
    setDeptSubmitting(true);
    try {
      await adminApi.createDepartment({ name: deptName.trim(), code: deptCode.trim() });
      setDeptName('');
      setDeptCode('');
      show('Department created.', 'success');
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create department.';
      setDeptError(message);
      show(message, 'error');
    } finally {
      setDeptSubmitting(false);
    }
  }

  async function handleCreateBatch(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBatchError(null);
    if (!batchDept || !batchName.trim() || !batchYear.trim()) {
      setBatchError('Department, name, and academic year are all required.');
      return;
    }
    setBatchSubmitting(true);
    try {
      await adminApi.createBatch({ departmentId: Number(batchDept), name: batchName.trim(), academicYear: batchYear.trim() });
      setBatchName('');
      setBatchYear('');
      show('Batch created.', 'success');
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create batch.';
      setBatchError(message);
      show(message, 'error');
    } finally {
      setBatchSubmitting(false);
    }
  }

  const departments = state.status === 'ready' ? state.departments : [];
  const batches = state.status === 'ready' ? state.batches : [];
  const departmentName = (id: number): string => departments.find((d) => d.id === id)?.name ?? `#${id}`;

  return (
    <div>
      <PageHeader title="Departments" subtitle="Manage the departments and batches that faculty and students belong to." />

      {state.status === 'loading' && <LoadingState label="Loading departments…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <>
          <Card style={{ marginBottom: '1.25rem' }}>
            <h2 className="section-title">New department</h2>
            <form onSubmit={handleCreateDepartment} className="row gap-sm" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Name" htmlFor="dept-name" error={deptError ?? undefined}>
                <Input id="dept-name" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Computer Science" />
              </Field>
              <Field label="Code" htmlFor="dept-code">
                <Input id="dept-code" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} placeholder="CSE" />
              </Field>
              <Button type="submit" loading={deptSubmitting}>
                <Plus size={14} /> Add department
              </Button>
            </form>
          </Card>

          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="mono">{d.code}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <h2 className="section-title" style={{ marginTop: '2rem' }}>
            Batches
          </h2>

          <Card style={{ marginBottom: '1.25rem' }}>
            <h2 className="section-title">New batch</h2>
            <form onSubmit={handleCreateBatch} className="row gap-sm" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Department" htmlFor="batch-dept" error={batchError ?? undefined}>
                <Select id="batch-dept" value={batchDept} onChange={(e) => setBatchDept(e.target.value)}>
                  <option value="">Select…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Batch name" htmlFor="batch-name">
                <Input id="batch-name" value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Batch 1" />
              </Field>
              <Field label="Academic year" htmlFor="batch-year">
                <Input id="batch-year" value={batchYear} onChange={(e) => setBatchYear(e.target.value)} placeholder="2026-2027" />
              </Field>
              <Button type="submit" loading={batchSubmitting}>
                <Plus size={14} /> Add batch
              </Button>
            </form>
          </Card>

          <Table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Department</th>
                <th>Academic year</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{departmentName(b.department_id)}</td>
                  <td>{b.academic_year}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
