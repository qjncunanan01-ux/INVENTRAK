import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useThemeColors } from '../../theme-context';

const POLICIES = [
  {
    icon: 'package-variant-closed-check',
    title: 'Bulk orders',
    text: 'There is no general minimum order. Quantities are limited by available stock. Syrups and sauces receive 3% off when their combined eligible subtotal reaches PHP 5,000; larger requests must be reviewed by staff.',
  },
  {
    icon: 'file-document-outline',
    title: 'Store-specific terms',
    text: 'Pickup is at 23-B Mohawk Street, Concepcion Uno, Marikina, Monday–Saturday, 8:00 AM–5:00 PM. Delivery covers Marikina, Antipolo/Rizal, Pasig, selected Quezon City areas, and other Metro Manila areas by arrangement. Staff quotes the fee and schedule.',
  },
  {
    icon: 'credit-card-outline',
    title: 'Payment processing',
    text: 'The demo does not move money. GCash and bank-transfer proofs are manually reviewed. Cash is due at pickup; courier orders must be fully paid before dispatch. Deposits and split payments require staff approval; credit requires an approved existing arrangement.',
  },
  {
    icon: 'truck-outline',
    title: 'Courier delivery',
    text: 'Customers request delivery and provide an address. Staff confirms the delivery area, fee, and schedule. The app does not book Lalamove or another courier automatically.',
  },
  {
    icon: 'tag-outline',
    title: 'Order status names',
    text: 'The demo workflow is Review → Confirmed → Preparing → Ready for pickup or Dispatched → Delivered. Courier orders cannot be changed or cancelled after dispatch.',
  },
  {
    icon: 'camera-outline',
    title: 'Returns and refunds',
    text: 'Report incorrect, damaged, defective, or discrepant items within 24 hours, with order details and a photo. Staff review requests; any refund shown in this demo is only a record, not a money transfer.',
  },
  {
    icon: 'bell-outline',
    title: 'Notifications and update timing',
    text: 'Order updates refresh about every 10 seconds while a screen is active. Email and SMS work only when a provider is configured. Facebook, Viber, and Messenger contact remains manual; this demo has no connected channel APIs.',
  },
];

export default function DemoPolicyScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.notice}>
        <MaterialCommunityIcons name="flask-outline" size={22} color={colors.warning} />
        <View style={styles.noticeBody}>
          <Text style={styles.noticeTitle}>Demo only</Text>
          <Text style={styles.noticeText}>
            These are demo rules based on Sylver’s answers. Payment proof review and refund actions are simulated;
            this build is separate from production.
          </Text>
        </View>
      </View>

      <Text style={styles.intro}>
        Company-provided order terms represented in this demo build.
      </Text>

      {POLICIES.map((policy) => (
        <View key={policy.title} style={styles.card}>
          <View style={styles.icon}>
            <MaterialCommunityIcons name={policy.icon} size={21} color={colors.brandPrimary} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.title}>{policy.title}</Text>
            <Text style={styles.description}>{policy.text}</Text>
          </View>
        </View>
      ))}
      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  bottomSpace: { height: 16 },
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.outline || 'rgba(0,0,0,0.08)',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 14,
  },
  cardBody: { flex: 1, minWidth: 0 },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginRight: 12,
    width: 40,
  },
  intro: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  notice: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.warning,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 18,
    padding: 14,
  },
  noticeBody: { flex: 1, marginLeft: 10, minWidth: 0 },
  noticeText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
  noticeTitle: { color: colors.warning, fontSize: 15, fontWeight: '700' },
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { padding: 16 },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
});
