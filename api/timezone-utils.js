/**
 * Timezone utilities for Danish (Copenhagen) timezone handling
 * Fixes discrepancy where orders created 00:00-02:00 Danish time fall into previous day in UTC
 */

/**
 * Adjust local Danish date to UTC for querying
 * Converts Danish local date to UTC timestamp accounting for timezone offset
 *
 * Example: 2024-10-01 (Danish date) → 2024-09-30T22:00:00Z (UTC, accounting for CEST +0200)
 *
 * @param {string|Date} localDateInput - Date string (YYYY-MM-DD or ISO) or Date object
 * @param {boolean} endOfDay - If true, returns end of day (next day 22:00:00Z), else start of day (22:00:00Z)
 * @returns {Date} Date object in UTC adjusted for Danish timezone
 */
function adjustLocalDateToUTC(localDateInput, endOfDay = false) {
  try {
    let year, month, day;

    // Handle different input types
    if (localDateInput instanceof Date) {
      // Date object - extract date parts in local time
      year = localDateInput.getFullYear();
      month = localDateInput.getMonth() + 1;
      day = localDateInput.getDate();
    } else if (typeof localDateInput === 'string') {
      // String - could be YYYY-MM-DD or ISO timestamp
      if (localDateInput.includes('T')) {
        // ISO timestamp - parse and extract date parts
        const dateObj = new Date(localDateInput);
        year = dateObj.getFullYear();
        month = dateObj.getMonth() + 1;
        day = dateObj.getDate();
      } else {
        // YYYY-MM-DD format
        [year, month, day] = localDateInput.split('-').map(Number);
      }
    } else {
      throw new Error('Invalid date input type');
    }

    // Determine if this date is in summer time (CEST +0200) or winter time (CET +0100)
    // Use a simple heuristic: last Sunday of March to last Sunday of October = summer time
    const isDaylightSaving = isDST(year, month, day);
    const offsetHours = isDaylightSaving ? 2 : 1;

    // Danish midnight minus offset = UTC time
    // Example: Oct 1 00:00 CEST (+2) = Sep 30 22:00 UTC
    const utcDate = new Date(Date.UTC(year, month - 1, day, -offsetHours, 0, 0));

    if (endOfDay) {
      // Add 24 hours to get the start of next day
      utcDate.setUTCDate(utcDate.getUTCDate() + 1);
    }

    return utcDate;
  } catch (error) {
    console.error('Error adjusting local date to UTC:', error, localDateInput);
    // Fallback: return input as-is if it's already a Date, or parse it
    if (localDateInput instanceof Date) {
      return localDateInput;
    }
    try {
      return new Date(localDateInput);
    } catch {
      // Last resort: current date
      return new Date();
    }
  }
}

/**
 * Check if a given date is in daylight saving time (summer time) in Denmark
 * Denmark uses CEST (UTC+2) from last Sunday of March to last Sunday of October
 * Otherwise uses CET (UTC+1)
 *
 * @param {number} year - Year (e.g., 2024)
 * @param {number} month - Month (1-12)
 * @param {number} day - Day of month (1-31)
 * @returns {boolean} True if date is in daylight saving time
 */
function isDST(year, month, day) {
  // DST starts last Sunday of March at 02:00 CET
  // DST ends last Sunday of October at 03:00 CEST

  // Before March or after October: definitely winter time
  if (month < 3 || month > 10) return false;

  // April to September: definitely summer time
  if (month > 3 && month < 10) return true;

  // March: check if we're past the last Sunday
  if (month === 3) {
    const lastSunday = getLastSundayOfMonth(year, 3);
    return day >= lastSunday;
  }

  // October: check if we're before the last Sunday
  if (month === 10) {
    const lastSunday = getLastSundayOfMonth(year, 10);
    return day < lastSunday;
  }

  return false;
}

/**
 * Get the day of the last Sunday in a given month
 *
 * @param {number} year - Year (e.g., 2024)
 * @param {number} month - Month (1-12)
 * @returns {number} Day of month (1-31)
 */
function getLastSundayOfMonth(year, month) {
  // Start from last day of month and work backwards
  const lastDay = new Date(year, month, 0).getDate();

  for (let day = lastDay; day >= 1; day--) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() === 0) { // Sunday
      return day;
    }
  }

  return lastDay; // Fallback (should never happen)
}

module.exports = {
  adjustLocalDateToUTC,
  isDST,
  getLastSundayOfMonth
};
