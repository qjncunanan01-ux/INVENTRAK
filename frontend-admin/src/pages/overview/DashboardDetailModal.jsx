import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { colors } from '../../theme';
import { MONEY_MASK } from '../../components/Money';

// The "click a stat card" detail modal, extracted from DashboardPage. It is
// presentational: rows arrive pre-filtered, and the row shape is chosen by the
// panel key. `moneyVisible` masks peso figures for roles without revenue
// visibility.
export default function DashboardDetailModal({
  activeModal,
  onClose,
  filteredModalData,
  searchQuery,
  onSearchQuery,
  modalLoading,
  moneyVisible,
  onNavigate,
}) {
  return (
    <Dialog
      open={Boolean(activeModal)}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, p: 1 } }}
    >
      {activeModal && (
        <>
          <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {activeModal.icon}
              <Typography variant="h6" fontWeight={700}>{activeModal.label}</Typography>
              <Chip
                label={`${filteredModalData.length} items`}
                size="small"
                color={activeModal.key === 'lowStock' ? 'warning' : 'default'}
                sx={{ fontWeight: 600 }}
              />
            </Box>
            <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
          </DialogTitle>

          <DialogContent dividers>
            <Box sx={{ mb: 2 }}>
              <TextField                   placeholder="Search items…"
                size="small" fullWidth
                value={searchQuery}
                onChange={(e) => onSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                  ),
                }}
              />
            </Box>

            {modalLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>
            ) : filteredModalData.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 5 }}>
                <Typography color="text.secondary">No items found matching your request.</Typography>
              </Box>
            ) : (
              <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: colors.surfaceAlt }}>
                      <TableRow>
                        {activeModal.key === 'lowStock' && (
                          <>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell><strong>Category</strong></TableCell>
                            <TableCell><strong>Location</strong></TableCell>
                            <TableCell align="right"><strong>Qty in Location</strong></TableCell>
                            <TableCell align="center"><strong>Status</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'products' && (
                          <>
                            <TableCell><strong>Product Name</strong></TableCell>
                            <TableCell><strong>Category</strong></TableCell>
                            <TableCell><strong>Size</strong></TableCell>
                            <TableCell align="right"><strong>Price</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'inventory' && (
                          <>
                            <TableCell><strong>Product Name</strong></TableCell>
                            <TableCell><strong>Locations</strong></TableCell>
                            <TableCell align="right"><strong>Total Stock</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'locationStock' && (
                          <>
                            <TableCell><strong>Location</strong></TableCell>
                            <TableCell align="right"><strong>Total Stock</strong></TableCell>
                          </>
                        )}
                        {(activeModal.key === 'inquiries' || activeModal.key === 'orderStatus') && (
                          <>
                            <TableCell><strong>Inquiry ID</strong></TableCell>
                            <TableCell><strong>Customer</strong></TableCell>
                            <TableCell align="right"><strong>Estimated Total</strong></TableCell>
                            <TableCell align="center"><strong>Status</strong></TableCell>
                          </>
                        )}
                        {(activeModal.key === 'sales' || activeModal.key === 'monthlySales') && (
                          <>
                            <TableCell><strong>Sale ID</strong></TableCell>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell><strong>Customer</strong></TableCell>
                            <TableCell align="right"><strong>Qty</strong></TableCell>
                            <TableCell align="right"><strong>Total Amount</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'customers' && (
                          <>
                            <TableCell><strong>Customer</strong></TableCell>
                            <TableCell><strong>Email</strong></TableCell>
                            <TableCell align="right"><strong>Orders</strong></TableCell>
                            <TableCell align="center"><strong>Latest Status</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'customersRegistered' && (
                          <>
                            <TableCell><strong>Username</strong></TableCell>
                            <TableCell><strong>Email</strong></TableCell>
                            <TableCell align="center"><strong>Verified</strong></TableCell>
                            <TableCell><strong>Joined</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'movements' && (
                          <>
                            <TableCell><strong>ID</strong></TableCell>
                            <TableCell><strong>Type</strong></TableCell>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell align="right"><strong>Quantity</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                          </>
                        )}
                        {(activeModal.key === 'fastMoving' || activeModal.key === 'slowMoving') && (
                          <>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell align="right"><strong>Units Sold</strong></TableCell>
                            <TableCell align="right"><strong>Revenue</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'alerts' && (
                          <>
                            <TableCell><strong>Alert ID</strong></TableCell>
                            <TableCell><strong>Type</strong></TableCell>
                            <TableCell><strong>Description</strong></TableCell>
                            <TableCell><strong>Best Before</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                          </>
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredModalData.map((item, idx) => (
                        <TableRow key={item.id || idx} hover>
                          {activeModal.key === 'lowStock' && (
                            <>
                              <TableCell><strong>{item.product_name}</strong></TableCell>
                              <TableCell>{item.category}</TableCell>
                              <TableCell>{item.location}</TableCell>
                              <TableCell align="right">
                                <Typography color="warning.main" fontWeight={700}>{item.quantity}</Typography>
                              </TableCell>
                              <TableCell align="center"><Chip label="LOW STOCK" size="small" color="warning" /></TableCell>
                            </>
                          )}
                          {activeModal.key === 'products' && (
                            <>
                              <TableCell><strong>{item.name}</strong></TableCell>
                              <TableCell>{item.category || 'General'}</TableCell>
                              <TableCell>{item.size || '—'}</TableCell>
                              <TableCell align="right">P{item.price ? Number(item.price).toLocaleString() : 0}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'inventory' && (
                            <>
                              <TableCell><strong>{item.product?.name || item.name}</strong></TableCell>
                              <TableCell>
                                {item.locations
                                  ? Object.entries(item.locations).map(([l, q]) => `${l}: ${q}`).join(' · ')
                                  : 'N/A'}
                              </TableCell>
                              <TableCell align="right"><strong>{item.total ?? 0}</strong></TableCell>
                            </>
                          )}
                          {activeModal.key === 'locationStock' && (
                            <>
                              <TableCell><strong>{item.location}</strong></TableCell>
                              <TableCell align="right"><strong>{item.total_stock?.toLocaleString()}</strong></TableCell>
                            </>
                          )}
                          {(activeModal.key === 'inquiries' || activeModal.key === 'orderStatus') && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell><strong>{item.customer_name || 'Customer'}</strong></TableCell>
                              <TableCell align="right">P{item.total_estimated_cost ? Number(item.total_estimated_cost).toLocaleString() : 0}</TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={item.status || 'pending'}
                                  size="small"
                                  color={item.status === 'approved' || item.status === 'fulfilled' ? 'success' : item.status === 'rejected' || item.status === 'cancelled' ? 'error' : 'warning'}
                                />
                              </TableCell>
                            </>
                          )}
                          {(activeModal.key === 'sales' || activeModal.key === 'monthlySales') && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell><strong>{item.product_name || `Product #${item.product_id}`}</strong></TableCell>
                              <TableCell>{item.customer_name || '—'}</TableCell>
                              <TableCell align="right">{item.qty ?? item.quantity ?? '—'}</TableCell>
                              <TableCell align="right">
                                {!moneyVisible
                                  ? MONEY_MASK
                                  : item.total_amount != null
                                    ? `P${Number(item.total_amount).toLocaleString()}`
                                    : item.total_price != null
                                      ? `P${Number(item.total_price).toLocaleString()}`
                                      : '—'}
                              </TableCell>
                              <TableCell>{item.transaction_date ? new Date(item.transaction_date).toLocaleDateString() : (item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A')}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'customers' && (
                            <>
                              <TableCell><strong>{item.customer_name}</strong></TableCell>
                              <TableCell>{item.customer_email}</TableCell>
                              <TableCell align="right">{item.orders}</TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={item.latest_status || 'pending'}
                                  size="small"
                                  color={item.latest_status === 'approved' || item.latest_status === 'fulfilled' ? 'success' : item.latest_status === 'rejected' || item.latest_status === 'cancelled' ? 'error' : 'warning'}
                                />
                              </TableCell>
                            </>
                          )}
                          {activeModal.key === 'customersRegistered' && (
                            <>
                              <TableCell><strong>{item.username}</strong></TableCell>
                              <TableCell>{item.email || '—'}</TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={item.email_verified === false ? 'Unverified' : 'Verified'}
                                  size="small"
                                  color={item.email_verified === false ? 'warning' : 'success'}
                                />
                              </TableCell>
                              <TableCell>{item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'movements' && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell>
                                <Chip
                                  label={item.type || 'movement'} size="small"
                                  color={item.type === 'stock-in' ? 'success' : item.type === 'stock-out' ? 'error' : 'info'}
                                />
                              </TableCell>
                              <TableCell><strong>{item.product_name || `Product #${item.product_id}`}</strong></TableCell>
                              <TableCell align="right">{item.quantity}</TableCell>
                              <TableCell>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</TableCell>
                            </>
                          )}
                          {(activeModal.key === 'fastMoving' || activeModal.key === 'slowMoving') && (
                            <>
                              <TableCell><strong>{item.product_name}</strong></TableCell>
                              <TableCell align="right">{item.qty.toLocaleString()}</TableCell>
                              <TableCell align="right">P{Number(item.revenue).toLocaleString()}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'alerts' && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell>
                                <Chip
                                  label={item.type === 'expired' ? 'Expired' : item.type === 'expiring_soon' ? 'Expiring Soon' : item.type || 'Alert'}
                                  size="small"
                                  color={item.type === 'expired' ? 'error' : item.type === 'expiring_soon' ? 'warning' : 'error'}
                                />
                              </TableCell>
                              <TableCell>{item.message || item.description || 'Inventory threshold breach'}</TableCell>
                              <TableCell>{item.expiry_date || '—'}</TableCell>
                              <TableCell>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </DialogContent>

          <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
            <Button color="inherit" onClick={onClose}>Close</Button>
            <Button
              variant="contained" color="primary"
              endIcon={<OpenInNewIcon />}
              onClick={() => onNavigate(activeModal.navigateTo)}
            >
              Go to full page
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
