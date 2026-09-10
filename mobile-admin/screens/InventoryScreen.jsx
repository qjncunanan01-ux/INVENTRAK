import React, { useState } from 'react';
import { SafeAreaView, ScrollView, View, StyleSheet } from 'react-native';
import { COLORS, ScreenHeader, PillTabBar, Divider } from '../components/SharedUI';
import InventoryLevelsView from './inventory/InventoryLevelsView';
import StockMovementsView from './inventory/StockMovementsView';
import StockAdjustmentView from './inventory/StockAdjustmentView';
import StockTransfersView from './inventory/StockTransfersView';
import BranchLocationsView from './inventory/BranchLocationsView';

// Note: "Stock Transfers" appears twice in the source design. Both entries
// are wired to the same StockTransfersView below since no distinct layout
// was provided for the second one — swap 'transfers2' to a different view
// if that tab was meant to show something else.
const TABS = [
  { key: 'levels', label: 'Inventory Levels' },
  { key: 'movements', label: 'Stock Movements' },
  { key: 'adjustment', label: 'Stock Adjustment' },
  { key: 'transfers', label: 'Stock Transfers' },
  { key: 'locations', label: 'Branch Locations' },
];

export default function InventoryScreen() {
  const [activeTab, setActiveTab] = useState('levels');

  const renderView = () => {
    switch (activeTab) {
      case 'levels':
        return <InventoryLevelsView />;
      case 'movements':
        return <StockMovementsView />;
      case 'adjustment':
        return <StockAdjustmentView />;
      case 'transfers':
      case 'transfers2':
        return <StockTransfersView />;
      case 'locations':
        return <BranchLocationsView />;
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