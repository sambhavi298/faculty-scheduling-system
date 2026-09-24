export class AvailabilityOverlapError extends Error {
  constructor(
    message = 'One of the submitted availability windows overlaps another window on the same day (faculty_availability_no_overlap, migrations/sql/0007).'
  ) {
    super(message);
    this.name = 'AvailabilityOverlapError';
    Object.setPrototypeOf(this, AvailabilityOverlapError.prototype);
  }
}
