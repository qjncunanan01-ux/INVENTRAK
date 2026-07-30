import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './screens/HomeScreen';
import InquiryHistoryScreen from './screens/InquiryHistoryScreen';
import LoginScreen from './screens/LoginScreen';
import OrderInquiryScreen from './screens/OrderInquiryScreen';
import ProductScreen from './screens/ProductScreen';
import RecommendationScreen from './screens/RecommendationScreen';
import { colors } from './theme';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: 'INVENTRAK',
            headerStyle: { backgroundColor: colors.brandPrimary },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="Product"
          component={ProductScreen}
          options={{
            title: 'Products',
            headerStyle: { backgroundColor: colors.brandPrimary },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="Recommendations"
          component={RecommendationScreen}
          options={{
            title: 'Recommendations',
            headerStyle: { backgroundColor: colors.brandPrimary },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="OrderInquiry"
          component={OrderInquiryScreen}
          options={{
            title: 'Order Inquiry',
            headerStyle: { backgroundColor: colors.brandPrimary },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="InquiryHistory"
          component={InquiryHistoryScreen}
          options={{
            title: 'Order History',
            headerStyle: { backgroundColor: colors.brandPrimary },
            headerTintColor: '#fff',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
