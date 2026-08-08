import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { loadSavedApiUrl } from './api';
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
import { useSessionUsername } from './api';
import { Toaster } from './toast';
import { ThemeProvider, useThemeColors } from './theme-context';

const AuthStack = createNativeStackNavigator();
const MainTabs = createBottomTabNavigator();
const CatalogStack = createNativeStackNavigator();
const OrdersStack = createNativeStackNavigator();

// Icon: simple text glyphs to keep zero extra dependencies.
function tabIcon(glyph, { color, size }) {
  return <Text style={{ color, fontSize: size - 2, fontWeight: '700' }}>{glyph}</Text>;
}

function CatalogNavigator() {
  const { colors } = useThemeColors();
  return (
    <CatalogStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.brandPrimary }, headerTintColor: '#fff' }}>
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
    <OrdersStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.brandPrimary }, headerTintColor: '#fff' }}>
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
        options={{ tabBarLabel: 'Home', tabBarIcon: (p) => tabIcon('⌂', p) }}
        initialParams={{ username }}
      />
      <MainTabs.Screen
        name="CatalogTab"
        component={CatalogNavigator}
        options={{ tabBarLabel: 'Products', tabBarIcon: (p) => tabIcon('☰', p) }}
      />
      <MainTabs.Screen
        name="CartTab"
        component={CartScreen}
        options={{
          tabBarLabel: 'Cart',
          tabBarIcon: (p) => tabIcon('🛒', p),
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
        options={{ tabBarLabel: 'Orders', tabBarIcon: (p) => tabIcon('✓', p) }}
      />
      <MainTabs.Screen
        name="AccountTab"
        component={AccountScreen}
        options={{ tabBarLabel: 'Account', tabBarIcon: (p) => tabIcon('●', p) }}
        initialParams={{ username }}
      />
    </MainTabs.Navigator>
  );
}

function AppShell() {
  // Restore a saved API URL override (set on the Login screen) before any
  // screen makes an API call, so Login, Signup, and the whole app hit the
  // host the user configured.
  const { colors, dark } = useThemeColors();
  useEffect(() => {
    loadSavedApiUrl();
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
