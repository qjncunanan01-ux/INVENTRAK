import { useEffect } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import HomeScreen from './screens/HomeScreen';
import InquiryHistoryScreen from './screens/InquiryHistoryScreen';
import LoginScreen from './screens/LoginScreen';
import OrderInquiryScreen from './screens/OrderInquiryScreen';
import ProductScreen from './screens/ProductScreen';
import RecommendationScreen from './screens/RecommendationScreen';
import SignupScreen from './screens/SignupScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import VerifyEmailScreen from './screens/VerifyEmailScreen';
import AccountScreen from './screens/AccountScreen';
import CategoriesScreen from './screens/CategoriesScreen';
import SearchScreen from './screens/SearchScreen';
import OcrScreen from './screens/OcrScreen';
import StockAvailabilityScreen from './screens/StockAvailabilityScreen';
import PaymentScreen from './screens/PaymentScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import CartScreen from './screens/CartScreen';
import { CartProvider, useCart } from './cart-context';
import { setSessionDetails, setSessionUsername, setToken, useSessionUsername, wakeBackend } from './api';
import { Toaster } from './toast';
import { ThemeProvider, useThemeColors } from './theme-context';

const AuthStack = createNativeStackNavigator();
const MainTabs = createBottomTabNavigator();
const CatalogStack = createNativeStackNavigator();
const OrdersStack = createNativeStackNavigator();

// Tab-bar icons (Shopee/Lazada-style): real vector glyphs from
// @expo/vector-icons (bundled with Expo Go) instead of text characters.
function tabIcon(name, { color, size }) {
  return <MaterialCommunityIcons name={name} size={size - 2} color={color} />;
}

function CatalogNavigator() {
  const { colors } = useThemeColors();
  return (
    <CatalogStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandPrimary },
        headerTintColor: '#fff',
        // Arrow-only back button: a long previous-screen label (e.g. "Scan a
        // Product") would overlap the centered title on narrow phones.
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <CatalogStack.Screen name="Products" component={ProductScreen} options={{ title: 'Products' }} />
      <CatalogStack.Screen name="Recommendations" component={RecommendationScreen} options={{ title: 'Recommendations' }} />
      <CatalogStack.Screen name="Categories" component={CategoriesScreen} options={{ title: 'Categories' }} />
      <CatalogStack.Screen name="Search" component={SearchScreen} options={{ title: 'Search', headerShown: false }} />
      <CatalogStack.Screen name="OCR" component={OcrScreen} options={{ title: 'Scan a Product' }} />
      <CatalogStack.Screen name="StockAvailability" component={StockAvailabilityScreen} options={{ title: 'Stock Availability' }} />
    </CatalogStack.Navigator>
  );
}

function OrdersNavigator() {
  const { colors } = useThemeColors();
  return (
    <OrdersStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandPrimary },
        headerTintColor: '#fff',
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <OrdersStack.Screen name="InquiryHistory" component={InquiryHistoryScreen} options={{ title: 'Order History' }} />
      <OrdersStack.Screen name="OrderInquiry" component={OrderInquiryScreen} options={{ title: 'Order Inquiry' }} />
      <OrdersStack.Screen name="Payment" component={PaymentScreen} options={{ title: 'Payment' }} />
      <OrdersStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
    </OrdersStack.Navigator>
  );
}

function MainTabsNavigator({ route }) {
  const { username } = route.params || {};
  const { count } = useCart();
  const { colors } = useThemeColors();
  // The Cart tab is visible to everyone (Shopee/Lazada-style) but is
  // member-only: guests who tap it see the "create an account / log in"
  // lock screen in CartScreen, and the badge never shows for them (count is
  // 0 because every add-to-cart path is login-gated). useSessionUsername is
  // still called here to keep the session reactive across renders.
  useSessionUsername(username || null);
  return (
    <MainTabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: 'rgba(0,0,0,0.06)' },
      }}
    >
      <MainTabs.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ tabBarLabel: 'Home', tabBarIcon: (p) => tabIcon('home-variant-outline', p) }}
        initialParams={{ username }}
      />
      <MainTabs.Screen
        name="CatalogTab"
        component={CatalogNavigator}
        options={{ tabBarLabel: 'Products', tabBarIcon: (p) => tabIcon('shopping-outline', p) }}
      />
      <MainTabs.Screen
        name="CartTab"
        component={CartScreen}
        options={{
          tabBarLabel: 'Cart',
          tabBarIcon: (p) => tabIcon('cart-outline', p),
          // Shopee-style badge: total units in the basket; hidden when empty
          // (guests always see it empty), capped at "99+" so a huge order
          // never overflows the tab bar.
          tabBarBadge: count > 0 ? (count > 99 ? '99+' : count) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.error, color: '#fff', fontSize: 11, minWidth: 18 },
        }}
      />
      <MainTabs.Screen
        name="OrdersTab"
        component={OrdersNavigator}
        options={{ tabBarLabel: 'Orders', tabBarIcon: (p) => tabIcon('clipboard-text-outline', p) }}
      />
      <MainTabs.Screen
        name="AccountTab"
        component={AccountScreen}
        options={{ tabBarLabel: 'Account', tabBarIcon: (p) => tabIcon('account-circle-outline', p) }}
        initialParams={{ username }}
      />
    </MainTabs.Navigator>
  );
}

function AppShell() {
  const { colors, dark } = useThemeColors();

  // Warm the backend immediately at launch (fire-and-forget). The deployed
  // Render free instance sleeps after ~15 min idle and can take 30-60s to
  // boot; pinging it now means the first real request (signup, login, order)
  // lands on an awake instance instead of timing out.
  useEffect(() => {
    wakeBackend();
  }, []);

  // Web only: the Google OAuth relay returns with the session token in the
  // URL — `/#/google-auth?token=…` (hash form, always used by this app) or
  // `/google-auth?token=…` (path form, in case a server-side SPA fallback
  // ever serves it). The whole page reloads during the flow, so apply the
  // session right here at boot, then scrub the URL so a refresh can't
  // re-login or re-alert.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const hash = window.location.hash;
    const isHash = hash.startsWith('#/google-auth');
    const isPath = window.location.pathname.endsWith('/google-auth');
    if (!isHash && !isPath) return;
    const raw = isHash ? hash : `${window.location.pathname}${window.location.search}`;
    const q = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1) : '';
    const params = {};
    for (const pair of q.split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      // URLSearchParams encodes spaces as '+' (e.g. "Jerico Cunanan" →
      // "Jerico+Cunanan"); decodeURIComponent alone leaves '+' as-is, so
      // normalize it to a space first (standard form-encoding semantics).
      const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
      const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
      if (k) params[k] = v;
    }
    if (params.token) {
      setToken(params.token);
      setSessionUsername(params.username || 'customer');
      setSessionDetails({
        email: params.email || params.username || 'customer',
        verified: params.email_verified !== '0',
      });
    }
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return (
    // CartProvider wraps the whole tree so the Cart tab badge and every
    // screen (product cards, PDP, checkout) share one persistent basket.
    <CartProvider>
      <NavigationContainer>
        <StatusBar style={dark ? 'light' : 'dark'} backgroundColor={colors.background} />
        {/* Guest-first: the app boots straight into the catalog tabs. Login /
            Signup live in this stack and are only pushed when the customer
            needs an account (placing an order or viewing order history), or
            taps Log In / Create Account in the Account tab. */}
        <AuthStack.Navigator initialRouteName="Main">
          <AuthStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <AuthStack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
          <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: false }} />
          <AuthStack.Screen name="VerifyEmail" component={VerifyEmailScreen} options={{ headerShown: false }} />
          <AuthStack.Screen
            name="Main"
            component={MainTabsNavigator}
            options={{ headerShown: false }}
          />
        </AuthStack.Navigator>
      </NavigationContainer>
      {/* Global toast (added-to-cart feedback etc.) — floats above the tab bar. */}
      <Toaster />
    </CartProvider>
  );
}

export default function App() {
  // ThemeProvider owns the persisted light/dark choice and hands the active
  // palette to every screen through useThemeColors().
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
