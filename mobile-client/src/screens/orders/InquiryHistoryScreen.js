import { useCallback, useMemo, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { apiPost, cancelOrderInquiry, listBackOrders, listOrderInquiries, useSessionUsername } from '../../api';
import Dialog from '../../Dialog';
import EmptyState from '../../EmptyState';
import { useThemeColors } from '../../theme-context';

const COMPANY_DEMO = process.env.EXPO_PUBLIC_SYLVER_POLICY_DEMO === 'true';

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  ...(COMPANY_DEMO ? [{ key: 'preparing', label: 'Preparing' }] : []),
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

// Mirrors the server rule (catalog-orders/inquiry-lifecycle): only a pending or
// approved inquiry can still be cancelled. The button is hidden elsewhere, and
// the server refuses it anyway — this is affordance, not the guard.
const CANCELLABLE = COMPANY_DEMO ? ['pending', 'approved', 'preparing'] : ['pending', 'approved'];

const FULFILLMENT_LABELS = { pickup: 'Pickup at store', courier: 'Courier delivery' };

function amountDueForOrder(order) {
  const total = Number(order.estimated_cost || 0) + Number(order.delivery_fee || 0);
  return Math.max(0, total - Number(order.amount_paid || 0));
}

export default function InquiryHistoryScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Order history is tied to a customer account: guests get a sign-in prompt
  // instead of an empty list.
  const isLoggedIn = !!useSessionUsername(null);
  const [inquiries, setInquiries] = useState([]);
  // Back-order status by inquiry id. One list request covers every order on
  // screen, and the server already scopes it to this customer's own orders —
  // so "is my order on back order, and why" is an answer the card can show
  // without a per-order request or any client-side filtering of other people's
  // data. A failure here must not hide the orders themselves.
  const [backOrders, setBackOrders] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  // Cancellation flow: the card asks once, through the shared cross-platform
  // Dialog (Alert.alert is a no-op on RN-web), then reloads the list.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [changeTarget, setChangeTarget] = useState(null);
  const [changeMessage, setChangeMessage] = useState('');
  const [returnTarget, setReturnTarget] = useState(null);
  const [returnReason, setReturnReason] = useState('damaged');
  const [returnMessage, setReturnMessage] = useState('');
  const [returnProofData, setReturnProofData] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState('');

  const fetchData = useCallback(async() => {
    try {
      const data = await listOrderInquiries();
      setInquiries(data.data || (Array.isArray(data) ? data : []));
    } catch (err) {
      // Silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Separate on purpose: back orders are extra context on top of the order
    // list, so their endpoint failing (or being older than this app) must not
    // blank the history.
    try {
      const rows = await listBackOrders();
      const byInquiry = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        byInquiry[row.inquiry_id] = row;
      }
      setBackOrders(byInquiry);
    } catch {
      setBackOrders({});
    }
  }, []);

  // Cancelling goes through the lifecycle endpoint, never through a status PUT
  // (a customer has no business writing arbitrary statuses). Defined AFTER
  // fetchData because it reloads the list afterwards.
  const doCancel = useCallback(async(cancellationReason) => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      await cancelOrderInquiry({ id: cancelTarget.id }, {
        ...(cancellationReason ? { cancellation_reason: cancellationReason } : {}),
      });
      setCancelTarget(null);
      setCancelNote('');
      await fetchData();
    } catch (err) {
      // Shown in the dialog body so the customer sees WHY it was refused (e.g.
      // the order was already fulfilled) instead of the dialog closing.
      setCancelNote(err && err.message ? err.message : 'Could not cancel this inquiry.');
    } finally {
      setCancelBusy(false);
    }
  }, [cancelTarget, fetchData]);

  const sendChangeRequest = async() => {
    if (!changeTarget || !changeMessage.trim()) return setRequestError('Describe what you need changed.');
    setRequestBusy(true);
    try {
      await apiPost(`/api/order-inquiries/${changeTarget.id}/change-request`, { message: changeMessage.trim() });
      setChangeTarget(null);
      setChangeMessage('');
      setRequestError('');
      await fetchData();
    } catch (err) {
      setRequestError(err.message || 'Could not send the change request.');
    } finally {
      setRequestBusy(false);
    }
  };

  const chooseReturnPhoto = async() => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1200 } }],
        {
          compress: 0.62,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );
      if (!compressed.base64 || compressed.base64.length > 870000) throw new Error('Choose a smaller photo (maximum 650 KB after compression).');
      setReturnProofData(`data:image/jpeg;base64,${compressed.base64}`);
      setRequestError('');
    } catch (err) {
      setRequestError(err.message || 'Could not read that photo.');
    }
  };

  const sendReturnRequest = async() => {
    if (!returnTarget || !returnProofData) return setRequestError('Attach a photo of the issue.');
    setRequestBusy(true);
    try {
      await apiPost(`/api/order-inquiries/${returnTarget.id}/return-requests`, { reason: returnReason, message: returnMessage.trim(), proof_data: returnProofData });
      setReturnTarget(null);
      setReturnMessage('');
      setReturnProofData('');
      setRequestError('');
      await fetchData();
    } catch (err) {
      setRequestError(err.message || 'Could not send the return request.');
    } finally {
      setRequestBusy(false);
    }
  };

  // Fetch while logged in — and REFETCH every time the tab gains focus, so a
  // freshly placed order (e.g. "View my orders" right after checkout) shows up
  // immediately instead of a stale list until pull-to-refresh. Also covers the
  // guest gate login path (the screen stays mounted across login).
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return undefined;
      let inFlight = false;
      const refresh = async() => {
        if (inFlight || AppState.currentState !== 'active') return;
        inFlight = true;
        try {
          await fetchData();
        } finally {
          inFlight = false;
        }
      };
      refresh();
      const timer = setInterval(refresh, 10000);
      const appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        clearInterval(timer);
        appStateSubscription.remove();
      };
    }, [isLoggedIn, fetchData]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const getStatusColor = (status) => {
    switch (status) {
    case 'approved': return colors.info;
    case 'fulfilled': return colors.success;
    case 'delivered': return colors.success;
    case 'rejected': return colors.error;
    case 'cancelled': return colors.textSecondary;
    default: return colors.warning;
    }
  };

  const getStatusLabel = (item) => {
    if (!COMPANY_DEMO) return item.status;
    return ({ pending: 'Review', approved: 'Confirmed', preparing: 'Preparing', fulfilled: item.fulfillment_method === 'courier' ? 'Dispatched' : 'Ready for pickup' })[item.status] || item.status;
  };

  const counts = useMemo(() => {
    const c = {
      all: inquiries.length,
      pending: 0,
      approved: 0,
      preparing: 0,
      fulfilled: 0,
      delivered: 0,
      rejected: 0,
      cancelled: 0,
    };
    inquiries.forEach((i) => { if (c[i.status] !== undefined) c[i.status] += 1; });
    return c;
  }, [inquiries]);

  // Rendered product lines for a card (also used by the search filter).
  // Handles the structured line items the app now sends ({ name, qty, price,
  // original_price }) AND legacy string entries ('Widget x2'), so older orders
  // still render correctly.
  const renderProducts = (raw) => {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
    if (!Array.isArray(parsed)) return parsed ? JSON.stringify(parsed) : '';
    return parsed
      .map((line) => {
        if (typeof line === 'string') return line;
        if (!line || typeof line !== 'object') return '';
        const qty = line.qty > 1 ? ` x${line.qty}` : '';
        const base = `${line.name || 'Item'}${qty}`;
        // Show the price the customer was charged, with a discount marker when
        // the line carried a deal (original price present + higher).
        const price = Number(line.unit_price ?? line.price);
        const original = Number(line.original_price);
        if (price > 0 && original > price) {
          return `${base} (P${price} deal, was P${original})`;
        }
        if (price > 0) return `${base} (P${price})`;
        return base;
      })
      .filter(Boolean)
      .join(', ');
  };

  // Live search (reviewer-style): filter by customer name, email, product,
  // payment method, or status — combined with the status tabs below.
  const shown = (tab === 'all' ? inquiries : inquiries.filter((i) => i.status === tab)).filter((i) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const productsText = renderProducts(i.products).toLowerCase();
    return (i.customer_name || '').toLowerCase().includes(q) ||
      (i.customer_email || '').toLowerCase().includes(q) ||
      (i.status || '').toLowerCase().includes(q) ||
      (i.payment_method || '').toLowerCase().includes(q) ||
      productsText.includes(q);
  });

  // Back-order block: WHY the order fell short and when it is promised, which
  // is the part a customer actually needs. Only shown when a back order exists
  // — most orders are fulfilled outright, and "no back order" is not news.
  // The status is reported as-is (open / fulfilled / cancelled): an order that
  // has since been fulfilled should not keep claiming it is on back order.
  const renderBackOrder = (backOrder) => {
    if (!backOrder) return null;
    const status = String(backOrder.status || 'open').toLowerCase();
    const open = status === 'open';
    return (
      <View style={[styles.backOrder, open ? styles.backOrderOpen : styles.backOrderDone]}>
        <Text style={[styles.backOrderLabel, open ? styles.backOrderLabelOpen : styles.backOrderLabelDone]}>
          {open ? '⏳ Back order' : status === 'cancelled' ? '✕ Back order cancelled' : '✅ Back order fulfilled'}
        </Text>
        {backOrder.reason ? (
          <Text style={styles.backOrderText}>{backOrder.reason}</Text>
        ) : null}
        {open && backOrder.requested_by_date ? (
          <Text style={styles.backOrderText}>Requested by: {backOrder.requested_by_date}</Text>
        ) : null}
        {backOrder.note ? <Text style={styles.backOrderNote}>{backOrder.note}</Text> : null}
      </View>
    );
  };

  // Status timeline (Shopee-style): Placed -> Approved -> Fulfilled -> Delivered.
  const renderTimeline = (item) => {
    let events = [];
    try {
      const parsed = JSON.parse(item.status_history || '[]');
      if (Array.isArray(parsed)) events = parsed;
    } catch {
      // Fall back to the current status when stored history is malformed.
    }
    if (events.length === 0) {
      events = [{ status: item.status, at: item.created_at }];
    }
    const labels = COMPANY_DEMO
      ? { pending: 'Review', approved: 'Confirmed', preparing: 'Preparing', fulfilled: item.fulfillment_method === 'courier' ? 'Dispatched' : 'Ready for pickup', delivered: 'Delivered', rejected: 'Rejected', cancelled: 'Cancelled' }
      : { pending: 'Placed', approved: 'Approved', fulfilled: 'Fulfilled', delivered: 'Delivered', rejected: 'Rejected' };
    return (
      <View style={styles.timeline}>
        {events.map((e, idx) => (
          <View key={idx} style={styles.timelineStep}>
            <View style={[styles.timelineDot, e.status === item.status && styles.timelineDotActive]} />
            <View style={styles.timelineBody}>
              <Text style={styles.timelineLabel}>{labels[e.status] || e.status}</Text>
              <Text style={styles.timelineDate}>
                {e.at ? new Date(e.at).toLocaleString() : ''}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const parsedRequest = (raw) => {
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  };
  const returnWindowOpen = (item) => {
    const history = parsedRequest(item.status_history);
    const event = Array.isArray(history) ? [...history].reverse().find((row) => row.status === 'delivered') : null;
    const deliveredAt = Date.parse(event?.at || '');
    return Number.isFinite(deliveredAt) && deliveredAt <= Date.now() && Date.now() - deliveredAt <= 24 * 60 * 60 * 1000;
  };

  // Guest state: browsing is free, but order history needs an account. This
  // must render BEFORE the loading spinner — while a guest we skip the fetch
  // entirely, so loading never resolves.
  if (!isLoggedIn) {
    return (
      <View style={styles.center}>
        <Text style={styles.guestGlyph}>✓</Text>
        <Text style={styles.guestTitle}>Log in to see your orders</Text>
        <Text style={styles.guestSub}>
          Your order inquiries will appear here once you have an account.
        </Text>
        <TouchableOpacity style={styles.guestBtnPrimary} onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.guestBtnPrimaryText}>Create Account</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.guestBtnSecondary} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.guestBtnSecondaryText}>Log In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Live search bar */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search orders, products, status..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      {/* Status tabs with counts, Shopee To Pay/To Ship/To Receive style */}
      <View style={styles.tabs}>
        <FlatList
          horizontal
          data={STATUS_TABS}
          keyExtractor={(t) => t.key}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const active = tab === item.key;
            return (
              <TouchableOpacity
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setTab(item.key)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {item.label}
                </Text>
                <View style={[styles.countBadge, active && styles.countBadgeActive]}>
                  <Text style={[styles.countText, active && styles.countTextActive]}>
                    {counts[item.key] || 0}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <FlatList
        data={shown}
        keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.itemTitle}>Order #{item.id}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                <Text style={styles.statusText}>{getStatusLabel(item)}</Text>
              </View>
            </View>
            {item.customer_name ? <Text style={styles.detail}>Customer: {item.customer_name}</Text> : null}

            <Text style={styles.detail}>Email: {item.customer_email}</Text>
            <Text style={styles.detail}>
              Cost: P{Number(item.estimated_cost).toFixed(2)} ·{' '}
              Payment: {(item.payment_method || 'cod').toUpperCase()}
              {item.bulk_discount_amount ? ` · −P${Number(item.bulk_discount_amount).toFixed(2)} bulk discount` : ''}
              {COMPANY_DEMO && item.fulfillment_method === 'courier' ? ` · P${Number(item.delivery_fee || 0).toFixed(2)} delivery` : ''}
              {item.payment_status === 'paid' ? ' · ✅ PAID' : ''}
              {item.payment_status === 'partial' ? ` · Partial: P${Number(item.amount_paid || 0).toFixed(2)} paid` : ''}
              {item.payment_status === 'pending_verification' ? ' · ⌛ Payment submitted for review' : ''}
              {item.payment_status === 'credit_pending' ? ' · ⌛ Existing credit terms awaiting staff approval' : ''}
              {item.payment_status === 'credit_approved' ? ` · ✅ Existing credit terms approved · P${Math.max(0, Number(item.estimated_cost || 0) + Number(item.delivery_fee || 0) - Number(item.amount_paid || 0)).toFixed(2)} on account` : ''}
              {['unpaid', 'partial', 'failed'].includes(item.payment_status) && ['gcash', 'bank_transfer'].includes(item.payment_method) ? ' · ⏳ Payment due' : ''}
              {item.payment_customer_reference ? ` · GCash ref ${item.payment_customer_reference}` : ''}
            </Text>
            {COMPANY_DEMO && item.delivery_schedule ? (
              <Text style={styles.detail}>
                Delivery schedule: {item.delivery_schedule}
              </Text>
            ) : null}
            {COMPANY_DEMO && item.payment_status === 'credit_pending' ? (
              <Text style={styles.detail}>
                Sylver will check that your account has an existing credit arrangement
                before approving this order.
              </Text>
            ) : null}
            {/* Fulfilment preference + where it goes (Part 11). */}
            <Text style={styles.detail}>
              {item.fulfillment_method === 'courier' ? '🚚' : '🏬'}{' '}
              {FULFILLMENT_LABELS[item.fulfillment_method] || FULFILLMENT_LABELS.pickup}
            </Text>
            {item.delivery_address ? (
              <Text style={styles.detail} numberOfLines={2}>
                📍 {item.delivery_address}
              </Text>
            ) : null}
            {/* Why it was rejected / cancelled — never a bare status chip. */}
            {item.status === 'rejected' && item.rejection_reason ? (
              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>Rejected</Text>
                <Text style={styles.reasonText}>{item.rejection_reason}</Text>
              </View>
            ) : null}
            {item.status === 'cancelled' ? (
              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>Cancelled by you</Text>
                <Text style={styles.reasonText}>
                  {item.cancelled_at ? new Date(item.cancelled_at).toLocaleString() : '—'}
                  {item.cancellation_reason ? ` · ${item.cancellation_reason}` : ''}
                </Text>
              </View>
            ) : null}
            <Text style={styles.detail} numberOfLines={2}>
              Products: {renderProducts(item.products)}
            </Text>
            {renderBackOrder(backOrders[item.id])}
            {renderTimeline(item)}
            {COMPANY_DEMO && (
              (['approved', 'preparing'].includes(item.status) && ['gcash', 'bank_transfer'].includes(item.payment_method)) ||
              (['approved', 'preparing'].includes(item.status) && item.payment_method === 'card' && item.payment_provider === 'demo_card')
            ) && item.payment_status !== 'paid' ? (
                <TouchableOpacity
                  style={styles.paymentBtn}
                  onPress={() => navigation.navigate('Payment', {
                    inquiryId: item.id,
                    payment: {
                      payment_method: item.payment_method,
                      payment_reference: item.payment_reference,
                      payment_provider: item.payment_provider,
                      amount_due: amountDueForOrder(item),
                    },
                  })}
                >
                  <Text style={styles.paymentBtnText}>
                    {item.payment_method === 'card' ? 'Complete demo card transaction' : 'Submit payment receipt'}
                    {' · P'}{amountDueForOrder(item).toFixed(2)}
                  </Text>
                </TouchableOpacity>
              ) : null}
            {COMPANY_DEMO && item.payment_method === 'cash' && item.fulfillment_method === 'pickup' && item.status === 'fulfilled' && item.payment_status !== 'paid' ? (
              <Text style={styles.detail}>Cash is due when you collect your order at the store.</Text>
            ) : null}
            {COMPANY_DEMO && ['pending', 'approved', 'preparing'].includes(item.status) ? (
              parsedRequest(item.change_request)?.status === 'pending' ? (
                <Text style={styles.detail}>Change request: waiting for Sylver to review.</Text>
              ) : (
                <TouchableOpacity style={styles.requestBtn} onPress={() => { setRequestError(''); setChangeTarget(item); }}>
                  <Text style={styles.requestBtnText}>Request an order change</Text>
                </TouchableOpacity>
              )
            ) : null}
            {COMPANY_DEMO && item.status === 'delivered' ? (
              parsedRequest(item.return_requests)?.some((request) => request.status === 'pending') ? (
                <Text style={styles.detail}>Return request: waiting for Sylver to review.</Text>
              ) : returnWindowOpen(item) ? (
                <TouchableOpacity style={styles.requestBtn} onPress={() => { setRequestError(''); setReturnReason('damaged'); setReturnTarget(item); }}>
                  <Text style={styles.requestBtnText}>Report an order issue · 24 hours</Text>
                </TouchableOpacity>
              ) : null
            ) : null}
            <View style={styles.cardFooter}>
              <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
              {CANCELLABLE.includes(item.status) || (COMPANY_DEMO && item.status === 'fulfilled' && item.fulfillment_method === 'pickup') ? (
                <TouchableOpacity
                  onPress={() => { setCancelNote(''); setCancelTarget(item); }}
                  style={styles.cancelBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel inquiry ${item.id}`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.cancelBtnText}>Cancel inquiry</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            glyph="📋"
            title={tab === 'all' ? 'No inquiries yet' : `No ${tab} inquiries`}
            sub={
              tab === 'all'
                ? 'Your submitted order inquiries will appear here. Start one from the Order Inquiry tab.'
                : `You have no ${tab} orders right now — try another status or submit a new inquiry.`
            }
          />
        }
      />

      <TouchableOpacity
        style={styles.newInquiry}
        onPress={() => navigation.navigate('OrderInquiry')}
      >
        <Text style={styles.newInquiryText}>+ New Order Inquiry</Text>
      </TouchableOpacity>

      {/* Cancellation confirmation. Cross-platform Dialog (not Alert.alert,
          which is a no-op on RN-web). The reason is optional here because the
          business has not asked for a mandatory one; whatever the customer
          types is stored with the cancellation. */}
      <Dialog
        visible={!!cancelTarget}
        glyph="✕"
        title="Cancel this inquiry?"
        body={
          cancelNote
            ? cancelNote
            : `Inquiry #${cancelTarget ? cancelTarget.id : ''} will be cancelled and the store notified. This cannot be undone — you would need to submit a new inquiry.`
        }
        confirmLabel={cancelBusy ? 'Cancelling…' : 'Yes, cancel it'}
        cancelLabel="Keep it"
        confirmDanger
        onConfirm={() => { if (!cancelBusy) doCancel(''); }}
        onCancel={() => { setCancelTarget(null); setCancelNote(''); }}
      />

      <Modal visible={Boolean(changeTarget)} transparent animationType="fade" onRequestClose={() => setChangeTarget(null)}>
        <View style={styles.formBackdrop}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Request a change</Text>
            <Text style={styles.formHint}>
              Sylver must review and accept the request. Sending it does not change
              the order automatically.
            </Text>
            <TextInput style={styles.formInput} multiline value={changeMessage} onChangeText={setChangeMessage} placeholder="Describe the change you need" maxLength={1000} />
            {requestError ? <Text style={styles.formError}>{requestError}</Text> : null}
            <TouchableOpacity style={styles.paymentBtn} disabled={requestBusy} onPress={sendChangeRequest}>
              <Text style={styles.paymentBtnText}>{requestBusy ? 'Sending…' : 'Send change request'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setChangeTarget(null); setRequestError(''); }}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(returnTarget)} transparent animationType="fade" onRequestClose={() => setReturnTarget(null)}>
        <View style={styles.formBackdrop}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Report a delivered order issue</Text>
            <Text style={styles.formHint}>
              Send within 24 hours of delivery. Staff review the report and any
              refund; this demo does not transfer money.
            </Text>
            <View style={styles.reasonChoices}>
              {['incorrect', 'damaged', 'defective', 'discrepancy'].map((reason) => (
                <TouchableOpacity
                  key={reason}
                  style={[
                    styles.reasonChoice,
                    returnReason === reason && styles.reasonChoiceActive,
                  ]}
                  onPress={() => setReturnReason(reason)}
                >
                  <Text
                    style={[
                      styles.reasonChoiceText,
                      returnReason === reason && styles.reasonChoiceTextActive,
                    ]}
                  >
                    {reason}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.formInput} multiline value={returnMessage} onChangeText={setReturnMessage} placeholder="Describe the issue (optional)" maxLength={1000} />
            <TouchableOpacity style={styles.requestBtn} onPress={chooseReturnPhoto}>
              <Text style={styles.requestBtnText}>{returnProofData ? 'Photo attached ✓' : 'Attach issue photo'}</Text>
            </TouchableOpacity>
            {returnProofData ? <Image source={{ uri: returnProofData }} style={styles.proofPreview} resizeMode="contain" /> : null}
            {requestError ? <Text style={styles.formError}>{requestError}</Text> : null}
            <TouchableOpacity
              style={styles.paymentBtn}
              disabled={requestBusy || !returnProofData}
              onPress={sendReturnRequest}
            >
              <Text style={styles.paymentBtnText}>{requestBusy ? 'Sending…' : 'Send return request'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setReturnTarget(null); setRequestError(''); }}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 12, padding: 14 },
  cardFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  cancelBtn: { borderColor: colors.error, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  cancelBtnText: { color: colors.error, fontSize: 12, fontWeight: '700' },
  paymentBtn: { alignItems: 'center', backgroundColor: colors.brandPrimary, borderRadius: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10 },
  paymentBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  requestBtn: { alignSelf: 'flex-start', borderColor: colors.brandPrimary, borderRadius: 8, borderWidth: 1, marginTop: 8, paddingHorizontal: 10, paddingVertical: 7 },
  requestBtnText: { color: colors.brandPrimary, fontSize: 12, fontWeight: '700' },
  formBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.48)', flex: 1, justifyContent: 'center', padding: 22 },
  formCard: { backgroundColor: colors.surface, borderRadius: 16, maxWidth: 460, padding: 18, width: '100%' },
  formTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  formHint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  formInput: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 10, borderWidth: 1, color: colors.textPrimary, minHeight: 80, padding: 12, textAlignVertical: 'top' },
  formError: { color: colors.error, fontSize: 12, marginTop: 7 },
  modalCancel: { color: colors.textSecondary, fontSize: 13, padding: 8, textAlign: 'center' },
  reasonChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  reasonChoice: {
    borderColor: colors.border,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reasonChoiceActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  reasonChoiceText: { color: colors.textSecondary, fontSize: 12 },
  reasonChoiceTextActive: { color: '#fff', fontWeight: '700' },
  proofPreview: { height: 100, marginTop: 8, width: '100%' },
  reasonBox: {
    backgroundColor: colors.background,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 10,
  },
  reasonLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 2, textTransform: 'uppercase' },
  reasonText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  backOrder: { borderRadius: 10, borderWidth: 1.5, marginTop: 10, padding: 10 },
  backOrderDone: { backgroundColor: 'rgba(46,125,50,0.08)', borderColor: colors.success },
  backOrderLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' },
  backOrderLabelDone: { color: colors.success },
  backOrderLabelOpen: { color: colors.warning },
  backOrderNote: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  backOrderOpen: { backgroundColor: 'rgba(184,134,11,0.10)', borderColor: colors.warning },
  backOrderText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, marginTop: 3 },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  container: { backgroundColor: colors.background, flex: 1 },
  countBadge: { backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 9, marginLeft: 6, paddingHorizontal: 6, paddingVertical: 1 },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  countText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  countTextActive: { color: '#fff' },
  date: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  detail: { color: colors.textSecondary, fontSize: 13, marginBottom: 3 },
  guestBtnPrimary: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    marginBottom: 10,
    paddingHorizontal: 48,
    paddingVertical: 14,
  },
  guestBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guestBtnSecondary: {
    borderColor: colors.brandPrimary,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 48,
    paddingVertical: 14,
  },
  guestBtnSecondaryText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  guestGlyph: { color: colors.brandPrimary, fontSize: 40, fontWeight: '700', marginBottom: 12 },
  guestSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 24, marginTop: 6, paddingHorizontal: 32, textAlign: 'center' },
  guestTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  itemTitle: { color: colors.textPrimary, flex: 1, fontSize: 16, fontWeight: '700' },
  listContent: { padding: 16 },
  newInquiry: { alignItems: 'center', backgroundColor: colors.brandPrimary, borderRadius: 12, marginBottom: 20, marginHorizontal: 16, paddingVertical: 14 },
  newInquiryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  searchInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchWrap: { backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  tab: { alignItems: 'center', backgroundColor: colors.background, borderRadius: 18, flexDirection: 'row', marginHorizontal: 4, paddingHorizontal: 14, paddingVertical: 8 },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabs: { backgroundColor: colors.surface, borderBottomColor: 'rgba(0,0,0,0.06)', borderBottomWidth: 1, paddingVertical: 10 },
  timeline: { borderTopColor: 'rgba(0,0,0,0.05)', borderTopWidth: 1, marginTop: 10, paddingTop: 8 },
  timelineBody: { flex: 1 },
  timelineDate: { color: colors.textSecondary, fontSize: 11 },
  timelineDot: { backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 5, height: 10, marginRight: 8, marginTop: 4, width: 10 },
  timelineDotActive: { backgroundColor: colors.brandPrimary },
  timelineLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  timelineStep: { alignItems: 'flex-start', flexDirection: 'row', marginBottom: 6 },
});
