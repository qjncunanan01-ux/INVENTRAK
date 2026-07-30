import { useEffect } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { clearToken } from '../api';
import { colors } from '../theme';

export default function HomeScreen({ route, navigation }) {
  const { username } = route.params;

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const handleLogout = () => {
    clearToken();
    navigation.replace('Login');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome, {username}</Text>
        <Text style={styles.subtitle}>Browse supplies, get recommendations, estimate cost, and send inquiries.</Text>
      </View>

      <View style={styles.menuItem}>
        <Text style={styles.menuTitle}>Browse Products</Text>
        <Text style={styles.menuDesc}>View our full product catalog with stock info</Text>
        <Button title="Browse Products" onPress={() => navigation.navigate('Product')} color={colors.brandPrimary} />
      </View>

      <View style={styles.menuItem}>
        <Text style={styles.menuTitle}>Recommendations</Text>
        <Text style={styles.menuDesc}>Get AI-powered product suggestions</Text>
        <Button title="Recommendations" onPress={() => navigation.navigate('Recommendations')} color={colors.brandSecondary} />
      </View>

      <View style={styles.menuItem}>
        <Text style={styles.menuTitle}>Order Inquiry</Text>
        <Text style={styles.menuDesc}>Request pricing and availability</Text>
        <Button title="Order Inquiry" onPress={() => navigation.navigate('OrderInquiry')} color={colors.info} />
      </View>

      <View style={styles.menuItem}>
        <Text style={styles.menuTitle}>Order History</Text>
        <Text style={styles.menuDesc}>Track your past inquiries and orders</Text>
        <Button title="Order History" onPress={() => navigation.navigate('InquiryHistory')} color={colors.success} />
      </View>

      <View style={styles.spacer} />
      <Button title="Logout" color={colors.error} onPress={handleLogout} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: colors.background },
  header: { marginBottom: 24, marginTop: 20 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 8, color: colors.textPrimary },
  subtitle: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  menuItem: { backgroundColor: colors.surface, padding: 16, borderRadius: 14, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  menuTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4, color: colors.textPrimary },
  menuDesc: { fontSize: 13, color: colors.textSecondary, marginBottom: 12 },
  spacer: { height: 20 }
});
