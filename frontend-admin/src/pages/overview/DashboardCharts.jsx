import { Box, Chip, Grid, Paper, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart,
  Pie, PieChart,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { brand, colors } from '../../theme';
import FormulaBanner from '../../components/FormulaBanner';
import { SectionLabel, NoData } from './DashboardSection';

// The dashboard's four chart rows, extracted from DashboardPage. Each section
// receives already-derived chart data + the role flags, and owns only its own
// range selectors (passed in so the page keeps the state).

// Series colours come from the Sylver palette (see theme.js) so the charts, the
// cards and the buttons can never drift apart. Green-brown-amber first: those
// are the three the brand actually uses, then info/error for semantic series.
const CHART_COLORS = [brand.greenDark, brand.brown, colors.warning, colors.info, colors.error, brand.green];
const FAST_COLOR = brand.greenDark;
const SLOW_COLOR = colors.warning;
// Pending / approved / rejected — amber, green, red, exactly as the status
// chips read everywhere else in the console.
const ORDER_STATUS_COLORS = [colors.warning, brand.greenDark, colors.error];

// ─── Stock value + stock per location (live point-in-time) ───
export function InventoryAnalyticsSection({ isExecutive, productValueData, locationStockData }) {
  return (
    // Wrapper (was a bare fragment) so the visual-regression baseline can snap
    // the whole section by testid instead of guessing a parent from the heading
    // text — a div in this flow position changes no layout.
    <Box data-testid="inventory-analytics">
      <SectionLabel>Inventory Analytics</SectionLabel>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Top Products by Stock Value</Typography>
            {!isExecutive ? (
              <NoData msg="🔒 Executive Access Required (Owner / Super Admin Only)" />
            ) : productValueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={productValueData} margin={{ bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `P${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip formatter={(val) => [`P${val.toLocaleString()}`, 'Stock Value']} />
                  <Bar dataKey="value" name="Stock Value" fill={colors.brandPrimary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No inventory data available" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Available Stock per Location</Typography>
            {locationStockData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={locationStockData} margin={{ bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="location" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip formatter={(val) => [val.toLocaleString(), 'Units']} />
                  <Bar dataKey="stock" name="Total Stock" fill={colors.brandSecondary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No location stock data" />}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

// ─── Fast-moving + slow-moving ───
export function VelocitySection({ rangeValue, onRangeChange, fastMovingData, slowMovingData }) {
  return (
    <>
      <SectionLabel rangeValue={rangeValue} onRangeChange={onRangeChange}>
        Product Sales Velocity
      </SectionLabel>
      {/* Same FSN ranking logic as Optimization → FSN, summarized for the
          dashboard's top-5 / bottom-5 charts. */}
      <FormulaBanner
        dense
        title="Velocity ranking (FSN basis)"
        items={[
          'units sold = Σ qty per product inside the range   ·   rank DESC → top 5 = Fast   ·   rank ASC → bottom 5 = Slow',
          'Full F/S/N classification (frequency & recency) lives on the Optimization page.',
        ]}
      />
      <Grid container spacing={3} sx={{ mt: 0.25 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TrendingUpIcon sx={{ color: FAST_COLOR }} />
              <Typography variant="h6" fontWeight={700}>Fast-Moving Products</Typography>
              <Chip label="Top 5" size="small" sx={{ backgroundColor: colors.brandAccent, fontWeight: 600 }} />
            </Box>
            {fastMovingData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={fastMovingData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <RechartsTooltip formatter={(val) => [val, 'Units Sold']} />
                  <Bar dataKey="qty" name="Units Sold" fill={FAST_COLOR} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No sales data yet" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TrendingDownIcon sx={{ color: SLOW_COLOR }} />
              <Typography variant="h6" fontWeight={700}>Slow-Moving Products</Typography>
              <Chip label="Bottom 5" size="small" sx={{ backgroundColor: '#fff8e1', fontWeight: 600 }} />
            </Box>
            {slowMovingData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={slowMovingData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <RechartsTooltip formatter={(val) => [val, 'Units Sold']} />
                  <Bar dataKey="qty" name="Units Sold" fill={SLOW_COLOR} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No sales data yet" />}
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}

// ─── Monthly sales + order status ───
export function SalesOrdersSection({
  rangeValue,
  onRangeChange,
  isExecutive,
  isStaffRole,
  monthlySalesChartData,
  orderStatusPieData,
}) {
  return (
    <>
      <SectionLabel rangeValue={rangeValue} onRangeChange={onRangeChange}>
        Sales & Orders Analytics
      </SectionLabel>
      {/* Monthly chart = the same Σ grouped by YYYY-MM the Reports page's
          daily table totals; the pie is a straight status count. */}
      <FormulaBanner
        dense
        title="Chart math"
        items={[
          'Monthly Sales = Σ total_amount grouped by month (YYYY-MM)   ·   Order Status = COUNT(inquiries) per status',
          'Both inherit the section Days / Weeks / Months / Quarterly / Annually filter.',
        ]}
      />
      <Grid container spacing={3} sx={{ mt: 0.25 }}>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Monthly Sales Value</Typography>
            {!isExecutive ? (
              <NoData msg="🔒 Executive Access Required (Owner / Super Admin Only)" />
            ) : monthlySalesChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthlySalesChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `P${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip formatter={(val) => [`P${val.toLocaleString()}`, 'Sales']} />
                  <Line type="monotone" dataKey="value" name="Sales Value" stroke={colors.brandPrimary} strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <NoData msg="No sales data available" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Order Status Summary</Typography>
            {isStaffRole ? (
              <NoData msg="🔒 Admin / Executive Access Required" />
            ) : orderStatusPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={orderStatusPieData}
                    cx="50%" cy="50%" outerRadius={90} innerRadius={45}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {orderStatusPieData.map((entry, i) => (
                      <Cell key={i} fill={ORDER_STATUS_COLORS[i % ORDER_STATUS_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(val, name) => [val, name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary" variant="body2">No order inquiries yet</Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}

// ─── Movement distribution + monthly trends ───
export function MovementSection({ rangeValue, onRangeChange, movementChartData }) {
  return (
    <>
      <SectionLabel rangeValue={rangeValue} onRangeChange={onRangeChange}>
        Stock Movement Analytics
      </SectionLabel>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Stock Movement Distribution</Typography>
            {movementChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Stock In', value: movementChartData.reduce((s, m) => s + m['stock-in'], 0) },
                      { name: 'Stock Out', value: movementChartData.reduce((s, m) => s + m['stock-out'], 0) },
                      { name: 'Transfer', value: movementChartData.reduce((s, m) => s + m.transfer, 0) },
                      { name: 'Adjustment', value: movementChartData.reduce((s, m) => s + m.adjustment, 0) },
                    ].filter(d => d.value > 0)}
                    cx="50%" cy="50%" outerRadius={90} innerRadius={40}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {CHART_COLORS.map((color, i) => <Cell key={i} fill={color} />)}
                  </Pie>
                  <RechartsTooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <NoData msg="No movement data yet — record stock-in/out to see distribution" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Monthly Movement Trends</Typography>
            {movementChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={movementChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip />
                  <Legend />
                  <Bar dataKey="stock-in" name="Stock In" fill={colors.brandPrimary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="stock-out" name="Stock Out" fill={colors.error} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="transfer" name="Transfer" fill={colors.info} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No movement data yet — record stock movements to see trends" />}
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}
