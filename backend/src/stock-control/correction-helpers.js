// Approver comments / correction requests — the shared write + read helpers.
//
// Why this file exists: two different callers produce and consume these rows.
// The admin can attach a comment either through the dedicated endpoint
// (routes/stock-control/correction-requests.js) or, far more naturally, while
// REJECTING a submission (routes/stock-control/approvals.js). Both must write
// the identical row shape, and the submission listings must project the same
// open comment, or the staff app would show the instruction only on one path.
//
// The submission "type" strings are load-bearing: the reject handler stamps
// them and the listing projection filters on them. They live here so the two
// can never drift apart.
const { db } = require('../db');

const SUBMISSION_TYPE = Object.freeze({
  ADJUSTMENT: 'stock_adjustment',
  TRANSFER: 'stock_transfer',
});

function rowFromDb(r) {
  if (!r) return null;
  return {
    id: r.id,
    submission_id: r.submission_id,
    submission_type: r.submission_type,
    comment: r.comment,
    requested_by: r.requested_by,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Record a correction request. Mirrors the npm-free backend's
 * createCorrectionRequest exactly, including which inputs are refused, so the
 * two backends reject the same requests with the same 400.
 * Returns { correctionRequest } or { error }.
 */
function createCorrectionRequest({ submission_id, submission_type, comment, requested_by }) {
  if (submission_id == null || submission_id === '') return { error: 'submission_id is required' };
  const text = comment == null ? '' : String(comment).trim();
  if (!text) return { error: 'comment is required' };
  const info = db
    .prepare(
      'INSERT INTO correction_requests (submission_id, submission_type, comment, requested_by, status) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      Number(submission_id),
      String(submission_type || '').trim(),
      text,
      requested_by == null ? null : String(requested_by || '').trim(),
      'open'
    );
  return { correctionRequest: rowFromDb(db.prepare('SELECT * FROM correction_requests WHERE id = ?').get(info.lastInsertRowid)) };
}

/**
 * SQL fragment projecting the newest OPEN correction comment for a submission
 * onto a listing row. Callers LEFT JOIN it with `alias` = the submission table
 * alias (e.g. 'a' for stock_adjustments) and the matching type string, then
 * select `...correction_comment, correction_status`. Both columns are always
 * present (null when there is no open comment) so every row keeps one shape.
 */
function openCorrectionJoin(alias, submissionType) {
  return {
    sql: `LEFT JOIN correction_requests cr ON cr.id = (
            SELECT c2.id FROM correction_requests c2
            WHERE c2.submission_type = '${submissionType}' AND c2.submission_id = ${alias}.id AND c2.status = 'open'
            ORDER BY c2.id DESC LIMIT 1
          )`,
    comment: 'cr.comment AS correction_comment',
    status: 'cr.status AS correction_status',
  };
}

module.exports = { SUBMISSION_TYPE, createCorrectionRequest, openCorrectionJoin, rowFromDb };
