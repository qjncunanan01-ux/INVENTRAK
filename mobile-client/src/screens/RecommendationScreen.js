import axios from 'axios';
import { useEffect, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL } from '../api';

export default function RecommendationScreen({ navigation }) {
  const [recommendations, setRecommendations] = useState([]);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/optimization/abc`).then(r => setRecommendations(r.data.slice(0, 6)));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Suggested Supplies</Text>
      <FlatList
        data={recommendations}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.productName}>{item.name}</Text>
            <Text>ABC Class: {item.classification}</Text>
          </View>
        )}
      />
      <Button title="Back to Home" onPress={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f4f6fd' },
  title: { fontSize: 22, marginBottom: 12 },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 10 },
  productName: { fontWeight: '700', marginBottom: 4 }
});
