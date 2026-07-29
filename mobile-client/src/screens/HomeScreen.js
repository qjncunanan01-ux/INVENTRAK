import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen({ route, navigation }) {
  const { username } = route.params;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Welcome, {username}</Text>
      <Text style={styles.subtitle}>Browse supplies, get recommendations, estimate cost, and send inquiries.</Text>
      <Button title="Browse Products" onPress={() => navigation.navigate('Product')} />
      <View style={styles.spacer} />
      <Button title="Recommendations" onPress={() => navigation.navigate('Recommendations')} />
      <View style={styles.spacer} />
      <Button title="Order Inquiry" onPress={() => navigation.navigate('OrderInquiry')} />
      <View style={styles.spacer} />
      <Button title="Order History" onPress={() => navigation.navigate('InquiryHistory')} />
      <View style={styles.spacer} />
      <Button title="Logout" color="#d32f2f" onPress={() => navigation.replace('Login')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f4f6fd' },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 12 },
  subtitle: { fontSize: 16, marginBottom: 24 },
  spacer: { height: 16 }
});
