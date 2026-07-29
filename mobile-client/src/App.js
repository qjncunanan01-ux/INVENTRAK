import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './screens/HomeScreen';
import InquiryHistoryScreen from './screens/InquiryHistoryScreen';
import LoginScreen from './screens/LoginScreen';
import OrderInquiryScreen from './screens/OrderInquiryScreen';
import ProductScreen from './screens/ProductScreen';
import RecommendationScreen from './screens/RecommendationScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Product" component={ProductScreen} />
        <Stack.Screen name="Recommendations" component={RecommendationScreen} />
        <Stack.Screen name="OrderInquiry" component={OrderInquiryScreen} />
        <Stack.Screen name="InquiryHistory" component={InquiryHistoryScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
