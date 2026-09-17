import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import LoginScreen from './screens/LoginScreen';
import ScanScreen from './screens/ScanScreen';
import CountScreen from './screens/CountScreen';
import RequestsScreen from './screens/RequestsScreen';
import AccountScreen from './screens/AccountScreen';
import { useSession, useSessionHydrated, wakeBackend } from './api';
import { ThemeProvider, useThemeColors } from './theme-context';

const RootStack = createNativeStackNavigator();
const WorkTabs = createBottomTabNavigator();

// Tab-bar icons (work-tool glyphs, amber-tinted by the active tint color).
function tabIcon(name, { color, size }) {
  return <MaterialCommunityIcons name={name} size={size - 2} color={color} />;
}

// The four work surfaces. No Home, no cart, no catalog, no orders.
function WorkTabsNavigator() {
  const { colors } = useThemeColors();
  const { username, role } = useSession();
  return (
    <WorkTabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.workAccent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: 'rgba(0,0,0,0.06)' },
      }}
    >
      <WorkTabs.Screen
        name="ScanTab"
        component={ScanScreen}
        options={{
          tabBarLabel: 'Scan',
          tabBarIcon: (p) => tabIcon('barcode-scan', p),
          // Shift badge: who is on duty and at what clearance — the first
          // thing a supervisor glances at when picking up the device.
          tabBarBadge: username ? String(username).slice(0, 8) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.workAccent, color: '#fff', fontSize: 10 },
        }}
      />
      <WorkTabs.Screen
        name="CountTab"
        component={CountScreen}
        options={{ tabBarLabel: 'Count', tabBarIcon: (p) => tabIcon('clipboard-list-outline', p) }}
      />
      <WorkTabs.Screen
        name="RequestsTab"
        component={RequestsScreen}
        options={{ tabBarLabel: 'My Requests', tabBarIcon: (p) => tabIcon('clock-check-outline', p) }}
      />
      <WorkTabs.Screen
        name="AccountTab"
        component={AccountScreen}
        options={{ tabBarLabel: 'Account', tabBarIcon: (p) => tabIcon('account-circle-outline', p) }}
      />
    </WorkTabs.Navigator>
  );
}

function AppShell() {
  const { colors, dark } = useThemeColors();
  // Session restore (AsyncStorage) must finish before the gate renders,
  // otherwise a slow read flashes the Login screen over a valid session.
  const hydrated = useSessionHydrated();
  const { isLoggedIn, role } = useSession();

  // Warm the Render instance at launch (fire-and-forget) so the first real
  // request of a shift doesn't die to a 30-60s cold start.
  useEffect(() => {
    wakeBackend();
  }, []);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style={dark ? 'light' : 'dark'} backgroundColor={colors.background} />
      <RootStack.Navigator>
        {!isLoggedIn ? (
          // Auth-first: a staff tool has no guest mode. The gate REFUSES
          // customer accounts outright (staff tier only) — enforced again by
          // the server on every request.
          <RootStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <RootStack.Screen
            name="Work"
            component={WorkTabsNavigator}
            options={{ headerShown: false }}
          />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
