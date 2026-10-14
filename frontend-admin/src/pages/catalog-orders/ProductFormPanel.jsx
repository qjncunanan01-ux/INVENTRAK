import { Box, Button, Grid, Paper, TextField, Typography } from '@mui/material';
import { API_BASE_URL } from '../../api';
import { colors } from '../../theme';
import CreatableSelect from './CreatableSelect';
import { sanitizePrice } from './products-csv';

// The create/edit form. Extracted from ProductsPage and kept presentational:
// all state and the save handler live in the page, this only renders + raises
// changes. The empty form literal is owned by the page so create/cancel/clear
// all reset to the same shape.
export default function ProductFormPanel({
  form,
  setForm,
  saving,
  editingProductId,
  categoryOptions,
  brandOptions,
  unitOptions,
  onSave,
  onCancel,
  formRef,
}) {
  return (
    <Paper ref={formRef} sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
      <Typography variant="h6" mb={2}>Product catalog controls</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Add, edit, and manage product details for inventory tracking.
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}><TextField fullWidth variant="outlined" label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Grid>
        <Grid item xs={12} md={4}>
          <CreatableSelect label="Category" value={form.category} onChange={val => setForm(prev => ({ ...prev, category: val }))} options={categoryOptions} />
        </Grid>
        <Grid item xs={12} md={4}>
          <CreatableSelect label="Brand" value={form.brand} onChange={val => setForm(prev => ({ ...prev, brand: val }))} options={brandOptions} />
        </Grid>
        <Grid item xs={12} sm={6} md={4}><TextField fullWidth variant="outlined" label="Size (e.g. 1.5 KG, 2 L)" value={form.size} onChange={e => setForm(prev => ({ ...prev, size: e.target.value }))} /></Grid>
        <Grid item xs={12} sm={6} md={2}>
          <CreatableSelect label="Unit" value={form.unit} onChange={val => setForm(prev => ({ ...prev, unit: val }))} options={unitOptions} placeholder="pcs" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}><TextField fullWidth variant="outlined" label="Price" type="text" inputMode="decimal" inputProps={{ inputMode: 'decimal' }} value={form.price} onChange={e => setForm({ ...form, price: sanitizePrice(e.target.value) })} /></Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TextField
            fullWidth
            variant="outlined"
            label="Cost of goods"
            type="text"
            inputProps={{ inputMode: 'decimal' }}
            value={form.cost}
            onChange={e => setForm({ ...form, cost: sanitizePrice(e.target.value) })}
            helperText="Blank = not costed"
          />
        </Grid>
        <Grid item xs={12} md={9}><TextField fullWidth variant="outlined" label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} multiline minRows={2} /></Grid>
        <Grid item xs={12} md={6}>
          <TextField fullWidth variant="outlined" label="Image URL or /images/... path" value={form.image} onChange={e => setForm({ ...form, image: e.target.value })} placeholder="/images/da-vinci-sauces--butterscotch.jpg" />
        </Grid>
        {form.image ? (
          <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
            <img src={form.image.startsWith('http') ? form.image : API_BASE_URL + form.image} alt="preview" style={{ height: 56, borderRadius: 8, objectFit: 'cover' }} />
          </Grid>
        ) : null}
        <Grid item xs={12} sm={6} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
          <Button variant="contained" fullWidth onClick={onSave} disabled={saving || !form.name || !form.category}>
            {editingProductId ? 'Save product' : 'Create product'}
          </Button>
        </Grid>
        {editingProductId ? (
          <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
            <Button variant="outlined" fullWidth onClick={onCancel}>
              Cancel edit
            </Button>
          </Grid>
        ) : null}
      </Grid>
    </Paper>
  );
}
