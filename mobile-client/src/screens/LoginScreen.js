import axios from 'axios';
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_BASE_URL } from '../api';

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState('customer');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/login`, { username, password });
      navigation.replace('Home', { username: response.data.user.username });
    } catch (err) {
      setError('Login failed. Use any username and password for demo access.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>INVENTRAK Customer Login</Text>
      <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Username" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
      <Button title="Login" onPress={handleLogin} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f4f6fd' },
  title: { fontSize: 24, marginBottom: 24, textAlign: 'center' },
  input: { backgroundColor: '#fff', padding: 12, marginBottom: 16, borderRadius: 8 }
});
