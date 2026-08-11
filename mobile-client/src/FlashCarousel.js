import { useMemo } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { imageUrl } from './api';
import { dealPricing } from './flash-sale';
import { useThemeColors } from './theme-context';
import PressableScale from './PressableScale';

// Flash-sale carousel card width (snap interval = card + margin).
const FEAT_CARD_W = 150;

// Shopee-style horizontal flash-sale carousel: photo cards with a ★ TOP PICK
// ribbon on A-classified items, an honest stock tag from the inventory API,
// and a quick-add (+) button. Shared by Home ("⚡ Flash Sale") and the
// Recommendations screen ("🔥 24hr Flash Deal") so today's picks render
// identically everywhere.
//
// Props:
//   items        — the day's picks (shape from buildFlashPicks)
//   stockMap     — productId -> total quantity (see stockMapFromInventory)
//   onPressItem  — called with the tapped item (navigate to its detail)
//   onAdd        — called with the item when the + button is pressed
//                  (omit to hide quick-add)
export default function FlashCarousel({ items, stockMap = {}, onPressItem, onAdd }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const stockTag = (id) => {
    const total = stockMap[Number(id)];
    if (total === undefined) return null;
    if (total <= 0) return <Text style={styles.stockTagOut}>Out of stock</Text>;
    if (total < 25) return <Text style={styles.stockTagLow}>⚠ Low</Text>;
    return <Text style={styles.stockTagIn}>● In stock</Text>;
  };

  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
      showsHorizontalScrollIndicator={false}
      snapToInterval={FEAT_CARD_W + 12}
      decelerationRate="fast"
      contentContainerStyle={styles.row}
      renderItem={({ item }) => {
        // Deterministic fake sale price for the day (see flash-sale.js).
        // Products without a price get the plain price, no badge.
        const deal = dealPricing(item);
        return (
          /* The WHOLE card (photo, name, category, price, stock tag) is the
             tap target and scales on press — same PressableScale as the Home
             quick actions and chips. The + button lives INSIDE the pressable:
             the responder system gives the innermost touchable the touch, so
             quick-add still fires without triggering the card's navigation. */
          <PressableScale
            style={styles.card}
            pressableStyle={styles.cardPressable}
            onPress={() => onPressItem && onPressItem(item)}
          >
            <View style={styles.imgWrap}>
              {item.image ? (
                <Image source={{ uri: imageUrl(item.image) }} style={styles.img} resizeMode="cover" />
              ) : (
                <View style={[styles.img, styles.imgPlaceholder]} />
              )}
              {item.classification === 'A' ? (
                <View style={styles.ribbon}>
                  <Text style={styles.ribbonText}>★ TOP PICK</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
            <View style={styles.catRow}>
              <Text style={styles.cat} numberOfLines={1}>{item.category}</Text>
              {stockTag(item.id)}
            </View>
            <View style={styles.bottom}>
              {deal ? (
                <View
                  style={styles.priceRow}
                  accessible
                  accessibilityLabel={`Deal price P${deal.deal}, originally P${deal.original}, ${deal.pct} percent off`}
                >
                  <Text style={styles.dealPrice}>P{deal.deal}</Text>
                  <Text style={styles.originalPrice}>P{deal.original}</Text>
                  <Text style={styles.offPct}>-{deal.pct}%</Text>
                </View>
              ) : (
                <Text style={styles.price}>P{item.price}</Text>
              )}
            </View>
            {deal ? (
              <View style={styles.dealChip}>
                <Text style={styles.dealChipText}>🔥 Deal of the day</Text>
              </View>
            ) : null}
            {onAdd ? (
              <TouchableOpacity
                style={styles.add}
                onPress={() => onAdd(item)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.addText}>+</Text>
              </TouchableOpacity>
            ) : null}
          </PressableScale>
        );
      }}
      ListEmptyComponent={
        <Text style={styles.empty}>No flash-sale picks right now — check back in a moment.</Text>
      }
    />
  );
}

const createStyles = (colors) => StyleSheet.create({
  row: { paddingHorizontal: 16, paddingBottom: 4 },
  card: {
    width: FEAT_CARD_W,
    marginRight: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  // Card content is inset via the inner pressable (keeps the absolutely
  // positioned + button at the card's true edge, like before). Stretch keeps
  // name/price text left-aligned instead of PressableScale's default center.
  cardPressable: { padding: 10, alignItems: 'stretch' },
  imgWrap: { position: 'relative' },
  img: { width: '100%', height: 110, borderRadius: 10, backgroundColor: colors.background },
  imgPlaceholder: { backgroundColor: '#e3eeda' },
  ribbon: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: colors.brandPrimary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ribbonText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  name: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginTop: 8, minHeight: 34 },
  catRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  cat: { fontSize: 11, color: colors.textSecondary, flex: 1 },
  empty: { marginHorizontal: 16, fontSize: 13, color: colors.textSecondary },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  price: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  dealPrice: { fontSize: 16, fontWeight: '800', color: '#e23744' }, // Shopee flash red
  // flexShrink lets the struck price and -% breathe when a 4-digit price
  // (e.g. P1250) rotates into the window, instead of overflowing the card.
  originalPrice: { fontSize: 11, color: '#9aa0a6', textDecorationLine: 'line-through', marginLeft: 6, flexShrink: 1 },
  offPct: { fontSize: 10, fontWeight: '800', color: '#e23744', marginLeft: 4, flexShrink: 1 },
  dealChip: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#ffe3dd',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  dealChipText: { fontSize: 9, fontWeight: '800', color: '#e23744', letterSpacing: 0.3 },
  stockTagIn: { fontSize: 10, fontWeight: '700', color: colors.success },
  stockTagLow: { fontSize: 10, fontWeight: '700', color: '#e67e00' },
  stockTagOut: { fontSize: 10, fontWeight: '700', color: colors.error },
  add: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  addText: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 24 },
});
