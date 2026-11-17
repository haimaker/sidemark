/** The Date column (§6.4). */

const DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2}))?$/

/**
 * Parse a Date cell. Accepts what writers emit (`YYYY-MM-DDThh:mmZ`) plus
 * seconds, fractional seconds, numeric offsets and a bare date (read as
 * midnight UTC). Returns `null` for anything else, including impossible
 * calendar dates.
 *
 * §6.4 gives the grammar: no time without a zone, no lower-case `t`/`z`, no
 * offset without a colon. Fractional seconds are truncated to milliseconds
 * (a JavaScript `Date` holds no more).
 */
export function parseDate(raw: string): Date | null {
  const match = DATE.exec(raw)
  if (!match) return null
  const [, y, mo, d, h, mi, s, frac, zone] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = h === undefined ? 0 : Number(h)
  const minute = mi === undefined ? 0 : Number(mi)
  const second = s === undefined ? 0 : Number(s)
  const millis = frac === undefined ? 0 : Math.floor(Number(`0.${frac}`) * 1000)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  let time = Date.UTC(year, month - 1, day, hour, minute, second, millis)
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1
    const offsetHours = Number(zone.slice(1, 3))
    const offsetMinutes = Number(zone.slice(4, 6))
    if (offsetHours > 23 || offsetMinutes > 59) return null
    time -= sign * (offsetHours * 60 + offsetMinutes) * 60_000
  }
  return new Date(time)
}

const WRITER_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/

/** Format an instant the way writers must (§6.4): UTC, `YYYY-MM-DDThh:mmZ`. */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 16) + 'Z'
}

/** Whether `value` is already in the writer format. */
export function isWriterDate(value: string): boolean {
  return WRITER_FORMAT.test(value) && parseDate(value) !== null
}
