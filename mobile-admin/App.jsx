import React, { useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, StatusBar } from 'react-native';
import { COLORS, BottomNav } from './components/SharedUI';
import DashboardScreen from './screens/DashboardScreen';
import InsightsScreen from './screens/InsightsScreen';
import InventoryScreen from './screens/InventoryScreen';
import CandOsScreen from './screens/CandOsScreen';

const NAV_TABS = [
  { key: 'Home', label: 'Home', icon: '🏠' },
  { key: 'Inventory', label: 'Inventory', icon: '🏢' },
  { key: 'C & Os', label: 'C & Os', icon: '📋' },
  { key: 'Governance', label: 'Governance', icon: '🏛️' },
  { key: 'Insights', label: 'Insights', icon: '🔍' },
];

// Simple stand-in for the tabs that weren't part of this migration batch.
function PlaceholderScreen({ label }) {
  return (
    <SafeAreaView style={placeholderStyles.safeArea}>
      <View style={placeholderStyles.center}>
        <Text style={placeholderStyles.text}>{label} — coming soon</Text>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [activeNav, setActiveNav] = useState('Home');

  const renderScreen = () => {
    switch (activeNav) {
      case 'Home':
        return <DashboardScreen />;
      case 'Insights':
        return <InsightsScreen />;
      case 'Inventory':
        return <InventoryScreen />;
      case 'C & Os':
        return <CandOsScreen />;
      default:
        return <PlaceholderScreen label={activeNav} />;
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.headerGreen} />
      <View style={{ flex: 1 }}>{renderScreen()}</View>
      <BottomNav tabs={NAV_TABS} activeKey={activeNav} onPress={setActiveNav} />
    </View>
  );
}

const placeholderStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});