import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

/**
 * Icon — unified icon component.
 * Maps friendly names to MaterialCommunityIcons (already installed).
 * When lucide-react-native is fully compatible, swap to Lucide here.
 *
 * For now, we keep MaterialCommunityIcons (1000+ icons, Expo-bundled)
 * and use Lucide for NEW components only.
 */
const ICON_MAP = {
  // Home
  'home': 'home',
  'search': 'magnify',
  'cart': 'cart',
  'user': 'account',
  'bell': 'bell',
  'star': 'star',
  'star-outline': 'star-outline',

  // Navigation
  'arrow-left': 'arrow-left',
  'arrow-right': 'chevron-right',
  'chevron-down': 'chevron-down',
  'menu': 'menu',
  'close': 'close',

  // Actions
  'plus': 'plus',
  'minus': 'minus',
  'edit': 'pencil',
  'trash': 'delete',
  'check': 'check',
  'refresh': 'refresh',

  // Status
  'warning': 'alert',
  'error': 'alert-circle',
  'info': 'information',
  'success': 'check-circle',

  // Commerce
  'package': 'package-variant',
  'scanner': 'camera',
  'receipt': 'receipt',
  'tag': 'tag',
  'percent': 'percent',

  // Communication
  'message': 'message-text',
  'mail': 'email',
  'phone': 'phone',

  // Misc
  'clock': 'clock-outline',
  'calendar': 'calendar',
  'filter': 'filter-variant',
  'sort': 'sort',
  'share': 'share-variant',
  'download': 'download',
  'upload': 'upload',
  'settings': 'cog',
  'logout': 'logout',
  'login': 'login',
};

/**
 * Render a named icon.
 * Usage: <Icon name="home" size={24} color="#000" />
 */
export default function Icon({ name, size = 24, color = '#000', style }) {
  const mapped = ICON_MAP[name] || name;

  return (
    <MaterialCommunityIcons
      name={mapped}
      size={size}
      color={color}
      style={style}
    />
  );
}
