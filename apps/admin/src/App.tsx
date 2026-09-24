import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '@faculty-scheduling/ui';
import { AdminSessionProvider } from './session/AdminSessionContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AdminLayout } from './layout/AdminLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Faculty } from './pages/Faculty';
import { Students } from './pages/Students';
import { Departments } from './pages/Departments';
import { Appointments } from './pages/Appointments';
import { AuditLogs } from './pages/AuditLogs';
import { Reports } from './pages/Reports';
import { SystemStatus } from './pages/SystemStatus';

export function App(): React.ReactElement {
  return (
    <ToastProvider>
      <AdminSessionProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="faculty" element={<Faculty />} />
            <Route path="students" element={<Students />} />
            <Route path="departments" element={<Departments />} />
            <Route path="appointments" element={<Appointments />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="reports" element={<Reports />} />
            <Route path="system-status" element={<SystemStatus />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminSessionProvider>
    </ToastProvider>
  );
}
