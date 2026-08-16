/**
 * The minimal surface AppointmentRepository depends on — deliberately not the
 * full `pg.Pool` type. This is the seam Dependency Inversion (Level 5, Section 9)
 * needs: unit tests inject a fake object satisfying this interface; integration
 * tests inject a real pg.Pool (which already structurally satisfies it).
 */
export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}
