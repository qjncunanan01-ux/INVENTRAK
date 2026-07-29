import { Alert, Button, Container, Paper, TextField, Typography } from '@mui/material';
import axios from 'axios';
import { useState } from 'react';
import { API_BASE_URL } from '../api';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/login`, { username, password });
      onLogin(response.data.user);
    } catch (err) {
      setError('Login failed. Please use admin as username.');
    }
  };

  return (
    <Container maxWidth="xs" sx={{ pt: 10 }}>
      <Paper sx={{ p: 4 }} elevation={3}>
        <Typography variant="h5" mb={2}>INVENTRAK Admin Login</Typography>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        <TextField fullWidth label="Username" value={username} onChange={e => setUsername(e.target.value)} sx={{ mb: 2 }} />
        <TextField fullWidth label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} sx={{ mb: 3 }} />
        <Button fullWidth variant="contained" onClick={handleSubmit}>Login</Button>
      </Paper>
    </Container>
  );
}
