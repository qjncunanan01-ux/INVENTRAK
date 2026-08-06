import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';

export default function LandingScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>I</Text>
        </View>
        <Text style={styles.title}>INVENTRAK</Text>
        <Text style={styles.subtitle}>Customer Portal</Text>
        <Text style={styles.tagline}>
          Browse supplies, get recommendations, and send order
          inquiries. Log in or create an account to get started.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.primary]}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryText}>Log In</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondary]}
          onPress={() => navigation.navigate('Signup')}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryText}>Create Account</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        By continuing, you agree to our terms of service.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 28,
    backgroundColor: colors.background,
  },
  brand: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  logoText: {
    color: '#fff',
    fontSize: 44,
    fontWeight: '800',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.brandPrimary,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 4,
    fontWeight: '600',
  },
  tagline: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 18,
    maxWidth: 300,
  },
  actions: {
    width: '100%',
  },
  button: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primary: {
    backgroundColor: colors.brandPrimary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
  },
  primaryText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryText: {
    color: colors.brandPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  footer: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    opacity: 0.8,
  },
});
