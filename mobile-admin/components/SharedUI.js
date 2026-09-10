import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet } from 'react-native';

// -----------------------------------------------------------------------
// Shared color palette
// -----------------------------------------------------------------------
export const COLORS = {
  headerGreen: '#3E5B0E',
  darkOlive: '#4A6B12',
  background: '#F5FBE0',
  textDark: '#33440B',
  textMuted: '#5C6B33',
  alertRed: '#C0392B',
  alertOrange: '#D9822B',
  cardGreenBorder: '#3E5B0E',
  cardBlueBorder: '#1F5FBF',
  cardYellowBorder: '#E0B400',
  cardLimeBorder: '#8FCB2E',
  cardBg: '#FFFFFF',
  divider: '#3E5B0E',
  bottomNavGreen: '#4A6B12',
  // Inventory-screen additions
  pillTabBg: '#8FA857',
  pillTabActiveBg: '#3E5B0E',
  pillTabText: '#F5FBE0',
  inputBg: '#E9E9DD',
  inputText: '#6B6B5C',
  buttonGray: '#8B8B78',
  buttonGrayText: '#FFFFFF',
  tableHeaderBg: '#E7F27A',
  tableBorder: '#E3E8CC',
};

// -----------------------------------------------------------------------
// Stat card ("---" placeholder metric card)
// -----------------------------------------------------------------------
export function StatCard({ title, borderColor, onPress, width = '48%' }) {
  return (
    <TouchableOpacity
      style={[styles.statCard, { borderLeftColor: borderColor, width }]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <Text style={styles.statCardTitle}>{title}</Text>
      <Text style={styles.statCardValue}>---</Text>
      <Text style={styles.statCardHint}>Click to inspect</Text>
    </TouchableOpacity>
  );
}

// -----------------------------------------------------------------------
// Alert pill (red / orange rounded banner)
// -----------------------------------------------------------------------
export function AlertPill({ label, color, onPress }) {
  return (
    <TouchableOpacity
      style={[pillStyles.alertPill, { backgroundColor: color }]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <Text style={pillStyles.alertPillText}>{label}</Text>
    </TouchableOpacity>
  );
}

// -----------------------------------------------------------------------
// Horizontally scrollable anchor tab bar
// tabs: [{ key, label }]
// -----------------------------------------------------------------------
export function AnchorTabBar({ tabs, activeKey, onPress }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      bounces={false}
      style={tabStyles.row}
      contentContainerStyle={tabStyles.rowContent}
    >
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={tabStyles.tabWrapper}
          activeOpacity={0.7}
          onPress={() => onPress(tab.key)}
        >
          <Text
            numberOfLines={1}
            style={[
              tabStyles.tabText,
              activeKey === tab.key && tabStyles.tabTextActive,
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// -----------------------------------------------------------------------
// Pill tab bar (dark-green "active" pill) — used for real tab switching,
// e.g. the Inventory screen's Inventory Levels / Stock Movements / etc.
// Distinct from AnchorTabBar, which scrolls to a section on one long page.
// -----------------------------------------------------------------------
export function PillTabBar({ tabs, activeKey, onPress }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      bounces={false}
      style={pillTabStyles.row}
      contentContainerStyle={pillTabStyles.rowContent}
    >
      {tabs.map((tab) => {
        const isActive = activeKey === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[
              pillTabStyles.pill,
              { backgroundColor: isActive ? COLORS.pillTabActiveBg : COLORS.pillTabBg },
            ]}
            activeOpacity={0.8}
            onPress={() => onPress(tab.key)}
          >
            <Text numberOfLines={1} style={pillTabStyles.pillText}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const pillTabStyles = StyleSheet.create({
  row: {
    flexGrow: 0,
    flexShrink: 0,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 24,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    marginRight: 8,
    flexShrink: 0,
  },
  pillText: {
    color: COLORS.pillTabText,
    fontSize: 12,
    fontWeight: '600',
  },
});

// -----------------------------------------------------------------------
// White rounded card container
// -----------------------------------------------------------------------
export function Card({ children, style }) {
  return <View style={[cardStyles.card, style]}>{children}</View>;
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
});

// -----------------------------------------------------------------------
// Card title + subtitle
// -----------------------------------------------------------------------
export function CardHeading({ title, subtitle, action }) {
  return (
    <View style={headingStyles.wrap}>
      <View style={headingStyles.titleRow}>
        <Text style={headingStyles.title}>{title}</Text>
        {action ? <View>{action}</View> : null}
      </View>
      {subtitle ? <Text style={headingStyles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const headingStyles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11.5,
    color: COLORS.textMuted,
    lineHeight: 16,
  },
});

// -----------------------------------------------------------------------
// Pill-shaped text input (grey placeholder field)
// -----------------------------------------------------------------------
export function PillInput({ value, onChangeText, placeholder, style, ...rest }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={COLORS.inputText}
      style={[inputStyles.input, style]}
      {...rest}
    />
  );
}

const inputStyles = StyleSheet.create({
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 12,
    color: COLORS.textDark,
    marginBottom: 10,
  },
});

// -----------------------------------------------------------------------
// Two-column responsive field row (stacks fields evenly)
// -----------------------------------------------------------------------
export function FieldRow({ children }) {
  return <View style={fieldRowStyles.row}>{children}</View>;
}

const fieldRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

export function FieldHalf({ children }) {
  return <View style={{ width: '48%' }}>{children}</View>;
}

// -----------------------------------------------------------------------
// Action button — pill button, gray (secondary/disabled-look) or
// dark green (primary), matching the mockups
// -----------------------------------------------------------------------
export function ActionButton({ label, onPress, variant = 'gray', size = 'normal', style }) {
  const bg = variant === 'primary' ? COLORS.darkOlive : COLORS.buttonGray;
  return (
    <TouchableOpacity
      style={[
        buttonStyles.button,
        size === 'small' && buttonStyles.buttonSmall,
        { backgroundColor: bg },
        style,
      ]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <Text style={buttonStyles.text}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ButtonRow({ children }) {
  return <View style={buttonStyles.row}>{children}</View>;
}

const buttonStyles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 18,
    marginTop: 4,
    marginBottom: 4,
  },
  buttonSmall: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  text: {
    color: COLORS.buttonGrayText,
    fontSize: 12,
    fontWeight: '700',
  },
});

// -----------------------------------------------------------------------
// Data table: horizontally scrollable header row + empty state
// columns: string[]  rows: string[][] (optional)
// -----------------------------------------------------------------------
export function DataTable({ columns, rows = [], columnWidth = 110, emptyLabel = 'No records yet' }) {
  const totalWidth = columns.length * columnWidth;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ width: totalWidth }}>
        <View style={tableStyles.headerRow}>
          {columns.map((col) => (
            <Text key={col} style={[tableStyles.headerCell, { width: columnWidth }]} numberOfLines={1}>
              {col}
            </Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <View style={tableStyles.emptyRow}>
            <Text style={tableStyles.emptyText}>{emptyLabel}</Text>
          </View>
        ) : (
          rows.map((row, i) => (
            <View key={i} style={tableStyles.bodyRow}>
              {row.map((cell, j) => (
                <Text key={j} style={[tableStyles.bodyCell, { width: columnWidth }]} numberOfLines={1}>
                  {cell}
                </Text>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const tableStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.tableHeaderBg,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  headerCell: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textDark,
    paddingHorizontal: 4,
  },
  bodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.tableBorder,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  bodyCell: {
    fontSize: 11,
    color: COLORS.textDark,
    paddingHorizontal: 4,
  },
  emptyRow: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 11,
    color: '#B7BF97',
  },
});


export function ChartPlaceholderCard({ title }) {
  return (
    <View style={chartStyles.card}>
      <Text style={chartStyles.title}>{title}</Text>
      <View style={chartStyles.emptyBox}>
        <Text style={chartStyles.emptyIcon}>📊</Text>
        <Text style={chartStyles.emptyText}>No data yet</Text>
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------
// Section title (small bold caps green label)
// -----------------------------------------------------------------------
export function SectionTitle({ children }) {
  return <Text style={sectionStyles.title}>{children}</Text>;
}

// -----------------------------------------------------------------------
// Divider line
// -----------------------------------------------------------------------
export function Divider() {
  return <View style={sectionStyles.divider} />;
}

// -----------------------------------------------------------------------
// Screen header (logo + profile icon)
// -----------------------------------------------------------------------
export function ScreenHeader() {
  return (
    <View style={headerStyles.header}>
      <View style={headerStyles.logoRow}>
        <View style={headerStyles.logoBadge}>
          <Text style={headerStyles.logoEmoji}>🌿</Text>
        </View>
        <Text style={headerStyles.logoText}>INVENTRAK</Text>
      </View>
      <TouchableOpacity style={headerStyles.profileButton} activeOpacity={0.7}>
        <Text style={headerStyles.profileIcon}>👤</Text>
      </TouchableOpacity>
    </View>
  );
}

// -----------------------------------------------------------------------
// Dashboard chip ("Dashboard" pill under header)
// -----------------------------------------------------------------------
export function DashboardChip() {
  return (
    <View style={chipStyles.chip}>
      <Text style={chipStyles.chipText}>Dashboard</Text>
    </View>
  );
}

// -----------------------------------------------------------------------
// Bottom nav bar
// tabs: [{ key, label, icon }]
// -----------------------------------------------------------------------
export function BottomNav({ tabs, activeKey, onPress }) {
  return (
    <View style={navStyles.bottomNav}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={navStyles.navTab}
          activeOpacity={0.7}
          onPress={() => onPress(tab.key)}
        >
          <Text
            style={[
              navStyles.navIcon,
              activeKey === tab.key && navStyles.navIconActive,
            ]}
          >
            {tab.icon}
          </Text>
          <Text
            style={[
              navStyles.navLabel,
              activeKey === tab.key && navStyles.navLabelActive,
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// -----------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------
const styles = StyleSheet.create({
  statCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 14,
    minHeight: 120,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  statCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.3,
  },
  statCardValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textDark,
    marginVertical: 6,
  },
  statCardHint: {
    fontSize: 10,
    color: '#9AA37A',
  },
});

const pillStyles = StyleSheet.create({
  alertPill: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  alertPillText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});

const tabStyles = StyleSheet.create({
  row: {
    flexGrow: 0,
    flexShrink: 0,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 24, // lets the last tab clear the edge instead of clipping
  },
  tabWrapper: {
    paddingVertical: 4,
    marginRight: 20,
    flexShrink: 0, // stops RN from squeezing tabs to fit the screen
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: COLORS.textMuted,
  },
  tabTextActive: {
    color: COLORS.textDark,
  },
});

const chartStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    minHeight: 130,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 10,
  },
  emptyBox: {
    flex: 1,
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 20,
    marginBottom: 4,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 11,
    color: '#B7BF97',
  },
});

const sectionStyles = StyleSheet.create({
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.divider,
    opacity: 0.4,
    marginVertical: 12,
  },
});

const headerStyles = StyleSheet.create({
  header: {
    backgroundColor: COLORS.headerGreen,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  logoEmoji: {
    fontSize: 16,
  },
  logoText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
  },
  profileButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: {
    fontSize: 14,
  },
});

const chipStyles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.darkOlive,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 12,
  },
  chipText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});

const navStyles = StyleSheet.create({
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: COLORS.bottomNavGreen,
    paddingVertical: 10,
    paddingBottom: 14,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navTab: {
    alignItems: 'center',
    flex: 1,
  },
  navIcon: {
    fontSize: 18,
    marginBottom: 2,
    opacity: 0.75,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    fontSize: 10,
    color: '#E4EBC7',
  },
  navLabelActive: {
    color: '#fff',
    fontWeight: '700',
  },
});