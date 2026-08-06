import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { loadSavedApiUrl } from './api';
import HomeScreen from './screens/HomeScreen';
import InquiryHistoryScreen from './screens/InquiryHistoryScreen';
import LandingScreen from './screens/LandingScreen';
import LoginScreen from './screens/LoginScreen';
import OrderInquiryScreen from './screens/OrderInquiryScreen';
import ProductScreen from './screens/ProductScreen';
import RecommendationScreen from './screens/RecommendationScreen';
import SignupScreen from './screens/SignupScreen';
import AccountScreen from './screens/AccountScreen';
import CategoriesScreen from './screens/CategoriesScreen';
import SearchScreen from './screens/SearchScreen';
import { colors } from './theme';

const AuthStack = createNativeStackNavigator();
const MainTabs = createBottomTabNavigator();
const CatalogStack = createNativeStackNavigator();
const OrdersStack = createNativeStackNavigator();

// Icon: simple text glyphs to keep zero extra dependencies.
function tabIcon(glyph, { color, size }) {
  return <Text style={{ color, fontSize: size - 2, fontWeight: '700' }}>{glyph}</Text>;
}

function CatalogNavigator() {
  return (
    <CatalogStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.brandPrimary }, headerTintColor: '#fff' }}>
      <CatalogStack.Screen name="Products" component={ProductScreen} options={{ title: 'Products' }} />
      <CatalogStack.Screen name="Recommendations" component={RecommendationScreen} options={{ title: 'Recommendations' }} />
      <CatalogStack.Screen name="Categories" component={CategoriesScreen} options={{ title: 'Categories' }} />
      <CatalogStack.Screen name="Search" component={SearchScreen} options={{ title: 'Search', headerShown: false }} />
    </CatalogStack.Navigator>
  );
}

function OrdersNavigator() {
  return (
    <OrdersStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.brandPrimary }, headerTintColor: '#fff' }}>
      <OrdersStack.Screen name="InquiryHistory" component={InquiryHistoryScreen} options={{ title: 'Order History' }} />
      <OrdersStack.Screen name="OrderInquiry" component={OrderInquiryScreen} options={{ title: 'Order Inquiry' }} />
    </OrdersStack.Navigator>
  );
}

function MainTabsNavigator({ route }) {
  const { username } = route.params || {};
  return (
    <MainTabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: 'rgba(0,0,0,0.06)' },
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

export default function App() {
  // Restore a saved API URL override (set on the Login screen) before any
  // screen makes an API call, so Login, Signup, and the whole app hit the
  // host the user configured.
  useEffect(() => {
    loadSavedApiUrl();
  }, []);

  return (
    <NavigationContainer>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <AuthStack.Navigator initialRouteName="Landing">
        <AuthStack.Screen name="Landing" component={LandingScreen} options={{ headerShown: false }} />
        <AuthStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <AuthStack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
        <AuthStack.Screen
          name="Main"
          component={MainTabsNavigator}
          options={{ headerShown: false }}
        />
      </AuthStack.Navigator>
    </NavigationContainer>
  );
}
