import React, { useState } from 'react';
import { SafeAreaView, ScrollView, View, StyleSheet } from 'react-native';
import { COLORS, ScreenHeader, PillTabBar, Divider } from '../components/SharedUI';
import ProductsView from './candos/ProductsView';
import ScanBlockView from './candos/ScanBlockView';
import OrderInquiriesView from './candos/OrderInquiriesView';

const TABS = [
  { key: 'products', label: 'Products' },
  { key: 'scanBlock', label: 'Scan & Block' },
  { key: 'orderInquiries', label: 'Order Inquiries' },
];

export default function CandOsScreen() {
  const [activeTab, setActiveTab] = useState('products');

  const renderView = () => {
    switch (activeTab) {
      case 'products':
        return <ProductsView />;
      case 'scanBlock':
        return <ScanBlockView />;
      case 'orderInquiries':
        return <OrderInquiriesView />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <PillTabBar tabs={TABS} activeKey={activeTab} onPress={setActiveTab} />
        <Divider />

        {renderView()}

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
});