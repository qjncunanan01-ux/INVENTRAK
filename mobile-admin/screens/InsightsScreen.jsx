import React, { useRef, useState } from 'react';
import { SafeAreaView, ScrollView, View, StyleSheet } from 'react-native';
import {
  COLORS,
  ScreenHeader,
  DashboardChip,
  Divider,
  SectionTitle,
  StatCard,
  AnchorTabBar,
  ChartPlaceholderCard,
} from '../components/SharedUI';

const TABS = [
  { key: 'activity', label: 'ACTIVITY' },
  { key: 'inventoryAnalytics', label: 'INVENTORY ANALYTICS' },
  { key: 'productSalesVelocity', label: 'PRODUCT SALES VELOCITY' },
  { key: 'salesOrdersAnalytics', label: 'SALES & ORDERS ANALYTICS' },
  { key: 'stockMovementAnalytics', label: 'STOCK MOVEMENT ANALYTICS' },
  
];

export default function InsightsScreen() {
  const scrollRef = useRef(null);
  const offsets = useRef({});
  const [activeTab, setActiveTab] = useState('activity');

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

        <AnchorTabBar tabs={TABS} activeKey={activeTab} onPress={scrollToSection} />
        <Divider />

       

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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
});