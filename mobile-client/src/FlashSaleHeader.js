import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { daySeed, msUntilDailyRefresh } from './flash-sale';

// Shopee-style flash-sale banner: a bold title (default "⚡ Flash Sale"; the
// Recommendations screen uses "🔥 24hr Flash Deal"), an optional "View all"
// link, and a live "ENDS IN HH:MM:SS" countdown to local midnight — the
// moment the featured picks rotate to the new day's window.
//
// The countdown ticks inside THIS component (local state), so the rest of
// the screen does not re-render every second. When the day rolls over,
// onRefresh() is fired exactly once so the parent can refetch and rotate to
// the fresh picks.
export default function FlashSaleHeader({
  onRefresh,
  onViewAll,
  title = '⚡ Flash Sale',
  subtitle = 'Daily top-value picks — new deals every midnight',
}) {
  const [now, setNow] = useState(() => Date.now());
  const lastDayRef = useRef(daySeed(now));
  // Only tick while the Home tab is actually visible — the header stays
  // mounted in the tab navigator otherwise, and a 1s interval would keep
  // draining the battery on other tabs. The first tick after refocus still
  // catches a day rollover that happened while blurred.
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isFocused]);

  const ms = msUntilDailyRefresh(now);

  // Fire the day-rollover refresh exactly once, by comparing the current
  // local-day seed to the last one seen. This catches the flip even when a
  // 1s tick lands just PAST midnight (the ms countdown would skip exactly 0
  // and the picks would otherwise stay stale while Home sits open overnight).
  useEffect(() => {
    const d = daySeed(now);
    if (d !== lastDayRef.current) {
      lastDayRef.current = d;
      if (onRefresh) onRefresh();
    }
  }, [now, onRefresh]);

  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);

  return (
    <View style={styles.banner}>
      {/* Decorative diagonal accent (non-interactive so it never blocks the
          View-all link). */}
      <View style={styles.accent} />
      <View style={styles.topRow}>
        <Text style={styles.title}>{title}</Text>
        {onViewAll ? (
          <TouchableOpacity
            onPress={onViewAll}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.8}
          >
            <Text style={styles.viewAll}>View all top picks ▸</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.sub}>{subtitle}</Text>
      <View
        style={styles.timerRow}
        accessible
        accessibilityLabel={`Flash sale ends in ${h} hours ${m} minutes ${s} seconds`}
      >
        <Text style={styles.timerLabel}>ENDS IN</Text>
        <View style={styles.timerBoxes}>
          <Text style={styles.timerBox}>{pad(h)}</Text>
          <Text style={styles.timerSep}>:</Text>
          <Text style={styles.timerBox}>{pad(m)}</Text>
          <Text style={styles.timerSep}>:</Text>
          <Text style={styles.timerBox}>{pad(s)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: '#ff4d2e', // flash-sale orange-red (Shopee pattern)
    padding: 14,
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    top: -50,
    right: -30,
    width: 130,
    height: 320,
    backgroundColor: 'rgba(255,255,255,0.09)',
    transform: [{ rotate: '18deg' }],
    pointerEvents: 'none',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 19, fontWeight: '800', letterSpacing: 0.3 },
  viewAll: { color: '#fff', fontSize: 12, fontWeight: '700', opacity: 0.95 },
  sub: { color: '#fff', opacity: 0.92, fontSize: 12, marginTop: 3 },
  timerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 11 },
  timerLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginRight: 12,
    opacity: 0.95,
  },
  timerBoxes: { flexDirection: 'row', alignItems: 'center' },
  timerBox: {
    backgroundColor: 'rgba(0,0,0,0.30)',
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minWidth: 40,
    textAlign: 'center',
  },
  timerSep: { color: '#fff', fontSize: 16, fontWeight: '800', marginHorizontal: 4 },
});
