import React, { useRef, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, StyleSheet } from 'react-native';
import {
  COLORS,
  ScreenHeader,
  DashboardChip,
  Divider,
  SectionTitle,
  StatCard,
  AlertPill,
  AnchorTabBar,
  ChartPlaceholderCard,
} from '../components/SharedUI';

const TABS = [
  { key: 'overview', label: 'INVENTORY OVERVIEW' },
  { key: 'sales', label: 'SALES & ORDERS' },
  { key: 'activity', label: 'ACTIVITY' },
  { key: 'inventoryAnalytics', label: 'INVENTORY ANALYTICS' },
  { key: 'productSalesVelocity', label: 'PRODUCT SALES VELOCITY' },
  { key: 'salesOrdersAnalytics', label: 'SALES & ORDERS ANALYTICS' },
  { key: 'stockMovementAnalytics', label: 'STOCK MOVEMENT ANALYTICS' },
  
];

export default function DashboardScreen() {
  const scrollRef = useRef(null);
  const offsets = useRef({});
  const [activeTab, setActiveTab] = useState('overview');

  const handleLayout = (key) => (e) => {
    offsets.current[key] = e.nativeEvent.layout.y;
  };

  const scrollToSection = (key) => {
    setActiveTab(key);
    const y = offsets.current[key] ?? 0;
    scrollRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader />

      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        // Keep the active-tab highlight roughly in sync while the user
        // free-scrolls, by checking which section is nearest the top.
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          let current = TABS[0].key;
          TABS.forEach((t) => {
            if (y + 40 >= (offsets.current[t.key] ?? 0)) current = t.key;
          });
          if (current !== activeTab) setActiveTab(current);
        }}
        scrollEventThrottle={32}
      >
        <DashboardChip />
        <Divider />

        <Text style={styles.welcomeText}>
          Welcome back, <Text style={styles.welcomeBold}>admin</Text>. Review the
          latest inventory health and analytics.
        </Text>

        <View style={styles.alertRow}>
          <AlertPill label="-- active alerts" color={COLORS.alertRed} />
          <AlertPill label="--- low-stock locations" color={COLORS.alertOrange} />
        </View>

        <AnchorTabBar tabs={TABS} activeKey={activeTab} onPress={scrollToSection} />
        <Divider />

        {/* ---------------- INVENTORY OVERVIEW ---------------- */}
        <View onLayout={handleLayout('overview')}>
          <SectionTitle>INVENTORY OVERVIEW</SectionTitle>
          <View style={styles.grid}>
            <StatCard title="TOTAL PRODUCTS" borderColor={COLORS.cardGreenBorder} />
            <StatCard title="TOTAL INVENTORY" borderColor={COLORS.cardBlueBorder} />
            <StatCard title="LOW STOCK ITEMS" borderColor={COLORS.cardYellowBorder} />
            <StatCard title="LOCATIONS" borderColor={COLORS.cardLimeBorder} />
          </View>
        </View>

        <Divider />

        {/* ---------------- SALES & ORDERS ---------------- */}
        <View onLayout={handleLayout('sales')}>
          <SectionTitle>SALES & ORDERS</SectionTitle>
          <View style={styles.grid}>
            <StatCard title="SALES THIS MONTH" borderColor={COLORS.cardGreenBorder} />
            <StatCard
              title="TOTAL SALES (ALL-TIME)"
              borderColor={COLORS.cardBlueBorder}
            />
            <StatCard title="CUSTOMERS SERVED" borderColor={COLORS.cardYellowBorder} />
            <StatCard title="ORDER STATUS" borderColor={COLORS.cardLimeBorder} />
          </View>
        </View>

        <Divider />

        {/* ---------------- ACTIVITY ---------------- */}
        <View onLayout={handleLayout('activity')}>
          <SectionTitle>ACTIVITY</SectionTitle>
          <View style={styles.grid}>
            <StatCard
              title="TRANSACTION THIS MONTH"
              borderColor={COLORS.cardGreenBorder}
            />
            <StatCard title="PENDING INQUIRIES" borderColor={COLORS.cardGreenBorder} />
          </View>
        </View>

         {/* ---------------- ACTIVITY ---------------- */}
        <View onLayout={handleLayout('activity')}>
          <SectionTitle>ACTIVITY</SectionTitle>
          <View style={styles.grid}>
            <StatCard
              title="TRANSACTION THIS MONTH"
              borderColor={COLORS.cardGreenBorder}
            />
            <StatCard title="PENDING INQUIRIES" borderColor={COLORS.cardGreenBorder} />
            <StatCard title="STOCK MOVEMENTS" borderColor={COLORS.cardGreenBorder} />
            <StatCard title="ACTIVE ALERTS" borderColor={COLORS.cardGreenBorder} />
          </View>
        </View>

        <Divider />

        {/* ---------------- INVENTORY ANALYTICS ---------------- */}
        <View onLayout={handleLayout('inventoryAnalytics')}>
          <SectionTitle>INVENTORY ANALYTICS</SectionTitle>
          <ChartPlaceholderCard title="Top Products by Stock Value" />
          <ChartPlaceholderCard title="Available Stock per Location" />
        </View>

        <Divider />

        {/* ---------------- PRODUCT SALES VELOCITY ---------------- */}
        <View onLayout={handleLayout('productSalesVelocity')}>
          <SectionTitle>PRODUCT SALES VELOCITY</SectionTitle>
          <ChartPlaceholderCard title="Fast-Moving Products" />
          <ChartPlaceholderCard title="Slow-Moving Products" />
        </View>

        <Divider />

        {/* ---------------- SALES & ORDERS ANALYTICS ---------------- */}
        <View onLayout={handleLayout('salesOrdersAnalytics')}>
          <SectionTitle>SALES & ORDERS ANALYTICS</SectionTitle>
          <ChartPlaceholderCard title="Monthly Sales Value" />
          <ChartPlaceholderCard title="Order Status Summary" />
        </View>

        <Divider />

        {/* ---------------- STOCK MOVEMENT ANALYTICS ---------------- */}
        <View onLayout={handleLayout('stockMovementAnalytics')}>
          <SectionTitle>STOCK MOVEMENT ANALYTICS</SectionTitle>
          <ChartPlaceholderCard title="Stock Movement Distribution" />
          <ChartPlaceholderCard title="Monthly Movement Trends" />
        </View>
        <View style={{ height: 24 }} />

        
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  welcomeText: {
    color: COLORS.textDark,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  welcomeBold: {
    fontWeight: '700',
  },
  alertRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
});