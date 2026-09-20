// Strict ISO calendar date (YYYY-MM-DD): correct shape AND a real calendar
// date (2026-02-31 is rejected). Used for best-before fields on counts.
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
      }

      if (value !== undefined && value !== null && value !== '') {
        // Number.isFinite (not isNaN) so 1e999/Infinity is rejected too —
        // binding Infinity into SQLite throws, and a NaN total would corrupt
        // sales records. Matches the npm-free fallback's Number.isFinite checks.
        if (rules.type === 'number' && !Number.isFinite(Number(value))) {
          errors.push(`${field} must be a number`);
        }

        if (rules.min !== undefined) {
          const belowMin = rules.type === 'number' ? Number(value) < rules.min : String(value).length < rules.min;

          if (belowMin) {
            errors.push(
              rules.type === 'number'
                ? `${field} must be at least ${rules.min}`
                : `${field} must be at least ${rules.min} characters`
            );
          }
        }

        if (rules.maxLength && String(value).length > rules.maxLength) {
          errors.push(`${field} must be at most ${rules.maxLength} characters`);
        }

        // Optional strict date-format rule (ISO YYYY-MM-DD). Also rejects
        // impossible calendar dates like 2026-02-31, not just malformed ones.
        if (rules.date && !isIsoDate(String(value))) {
          errors.push(`${field} must be a valid date (YYYY-MM-DD)`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    next();
  };
}

module.exports = { validate, isIsoDate };