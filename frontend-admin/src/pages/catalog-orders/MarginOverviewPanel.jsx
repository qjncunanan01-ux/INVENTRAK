import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { colors } from '../../theme';
import FormulaBanner from '../../components/FormulaBanner';
import WhyCell from '../../components/WhyCell';
import { describeReprice } from '../../cost-sheet';

// "Margin overview" + the reprice confirmation. Extracted from ProductsPage:
// the panel reads the computed coverage/insights and raises reprice intent;
// the page owns the plan state and the write. The dialog lists every suggested
// price BEFORE anything is written, because a bulk reprice is indistinguishable
// from a mistake once applied.
export default function MarginOverviewPanel({
  coverage,
  insights,
  costHistory,
  repriceBusy,
  onReprice,
  repriceOpen,
  onRepriceOpenChange,
  repricePlan,
  onApplyReprice,
}) {
  return (
    <>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Margin overview</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          What the costs entered so far are actually worth. Margins are gross
          (price − cost) ÷ price over the <em>costed</em> products only —
          an uncosted product has no margin, not a 0% one, so it is left out of
          the maths rather than dragging it down.
        </Typography>

        {/* The rule, printed next to its own numbers. Without this the panel
            asks "where did 30% come from?" and the answer is a screenshot of
            source code. */}
        <FormulaBanner
          dense
          title="Margin & repricing math"
          items={[
            'grossMargin% = (price - cost) / price * 100',
            'blendedMargin = (Σ price - Σ cost) / Σ price      // value-weighted, not an average of percentages',
            `targetPrice   = ceil(cost / (1 - ${insights.target}/100))    // rounded UP, or the row never clears the threshold`,
            'costPerBasis  = (cost / packSize) * basis        // basis = 100 ml | 100 g | 1 piece',
          ]}
          note={`Target is ${insights.target}% from the server (COSTING_TARGET_MARGIN), not hardcoded. An uncosted product contributes nothing to the maths — a null, not a 0%.`}
        />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">COST COVERAGE</Typography>
            <Typography variant="h5">{coverage.costed} / {coverage.total}</Typography>
            <Typography variant="caption" color="text.secondary">{coverage.pct}% of the catalog costed</Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">BLENDED MARGIN</Typography>
            <Typography variant="h5">
              {insights.blendedMargin === null ? '—' : `${Math.round(insights.blendedMargin)}%`}
            </Typography>
            {/* Value-weighted, not an average of per-product percentages — see
                buildCostInsights. "Catalogue-wide": the product record holds no
                quantity, so list price is the honest denominator, not turnover. */}
            <Typography variant="caption" color="text.secondary">weighted by list price</Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">TARGET</Typography>
            <Typography variant="h5">{insights.target}%</Typography>
            <Typography variant="caption" color="text.secondary">
              {insights.underPriced.length} product(s) below it
            </Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">COST ≥ PRICE</Typography>
            <Typography variant="h5" color={insights.lossMakers ? 'error.main' : 'inherit'}>{insights.lossMakers}</Typography>
            <Typography variant="caption" color="text.secondary">losing money at list price</Typography>
          </Grid>
        </Grid>

        {insights.underPriced.length > 0 ? (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" mb={1}>
              Priced below the {insights.target}% target — a suggestion, not an applied change
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={() => onReprice(insights.underPriced)}
                disabled={repriceBusy}
              >
                Reprice all {insights.underPriced.length} to {insights.target}%
              </Button>
              <Typography variant="caption" color="text.secondary">
                Confirmed before anything is written, and recorded in the audit trail.
              </Typography>
            </Box>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Products priced below the target margin">
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">Cost</TableCell>
                    <TableCell align="right">Margin</TableCell>
                    <TableCell align="right">Price for {insights.target}%</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {insights.underPriced.slice(0, 8).map(u => (
                    <TableRow key={u.id}>
                      <TableCell>{u.name}</TableCell>
                      <TableCell align="right">P{u.price}</TableCell>
                      <TableCell align="right">P{u.cost}</TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color={u.margin < 0 ? 'error.main' : 'warning.main'}>{u.margin}%</Typography>
                      </TableCell>
                      <TableCell align="right">
                        P{u.suggested}
                        <WhyCell
                          align="right"
                          lines={[
                            `cost ${u.cost}`,
                            `margin ${u.margin}% < ${insights.target}%`,
                            `cost / (1 - ${insights.target}/100)`,
                          ]}
                          result={`= ${u.suggested}  (rounded up)`}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => onReprice([u])} disabled={repriceBusy}>
                          Reprice
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {insights.underPriced.length > 8 && (
              <Typography variant="caption" color="text.secondary">
                …and {insights.underPriced.length - 8} more — use “Reprice all” to cover every one.
              </Typography>
            )}
          </Box>
        ) : coverage.costed > 0 ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            Every costed product clears the {insights.target}% target.
          </Alert>
        ) : null}

        {insights.categories.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" mb={1}>Margin by category</Typography>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Margin by category">
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Costed</TableCell>
                    <TableCell align="right">Margin</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {insights.categories.slice(0, 10).map(c => (
                    <TableRow key={c.category}>
                      <TableCell>{c.category}</TableCell>
                      <TableCell align="right">{c.costed}</TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color={c.margin === null ? 'text.secondary' : c.margin < 0 ? 'error.main' : c.margin < 20 ? 'warning.main' : 'success.main'}>
                          {c.margin === null ? '—' : `${Math.round(c.margin)}%`}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {costHistory.length > 0 && (
          <Box>
            <Typography variant="subtitle2" mb={1}>Recent cost changes</Typography>
            <Box component="ul" sx={{ mt: 0, mb: 0, pl: 2 }}>
              {costHistory.map((h, i) => (
                <li key={i}>
                  {/* audit() spreads the payload at the TOP level of the entry,
                      not under `details` — reading h.details here showed a
                      permanent "0 set, 0 cleared". */}
                  {Array.isArray(h.products) && h.products.length === 1
                    ? h.products[0]
                    : `${h.updated || 0} set, ${h.cleared || 0} cleared`}
                  {Array.isArray(h.products) && h.products.length > 1 && (
                    <Typography variant="caption" color="text.secondary">
                      {' '}— {h.products.slice(0, 3).join(', ')}{h.products.length > 3 ? ` +${h.products.length - 3} more` : ''}
                    </Typography>
                  )}
                  {' · '}{h.actor || 'someone'}{' · '}{new Date(h.t).toLocaleString()}
                </li>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">
              Read from the durable audit trail, so it survives a redeploy.
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Reprice confirmation. Every suggested price is listed before the write,
          because a bulk reprice is indistinguishable from a mistake once it is
          applied — and the audit entry that records it would look the same
          either way. */}
      <Dialog
        open={repriceOpen}
        onClose={() => !repriceBusy && onRepriceOpenChange(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="reprice-dialog-title"
      >
        <DialogTitle id="reprice-dialog-title">Raise prices to the {insights.target}% target?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            {describeReprice(repricePlan, insights.target)}
          </Typography>
          {repricePlan && repricePlan.prices.length > 0 && (
            <Box sx={{ maxHeight: 240, overflowY: 'auto', mt: 1 }}>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Pending reprices">
                  <TableHead>
                    <TableRow>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Now</TableCell>
                      <TableCell align="right">New price</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {repricePlan.prices.map(r => {
                      const row = insights.underPriced.find(u => u.id === r.id);
                      return (
                        <TableRow key={r.id}>
                          <TableCell>{r.name}</TableCell>
                          <TableCell align="right">{row ? `P${row.price}` : '—'}</TableCell>
                          <TableCell align="right">P{r.price}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
          {repricePlan && repricePlan.skipped.length > 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {repricePlan.skipped.length} row(s) left out: {repricePlan.skipped.slice(0, 5).map(s => `${s.name} (${s.reason})`).join(', ')}
              {repricePlan.skipped.length > 5 && ` …+${repricePlan.skipped.length - 5} more`}
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            This goes through the same audited bulk-price endpoint as the CSV import, and every changed product is
            named in the audit trail.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => onRepriceOpenChange(false)} disabled={repriceBusy}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={onApplyReprice} disabled={repriceBusy}>
            {repriceBusy ? 'Repricing…' : `Reprice ${repricePlan ? repricePlan.prices.length : 0} product${repricePlan && repricePlan.prices.length === 1 ? '' : 's'}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
