import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Card,
  CardHeading,
  PillInput,
  FieldRow,
  FieldHalf,
  ActionButton,
  DataTable,
  COLORS,
} from '../../components/SharedUI';

export default function InventoryLevelsView() {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');

  return (
    <View>
      {/* Top filter row (outside the card, per the mockup) */}
      <FieldRow>
        <FieldHalf>
          <PillInput
            placeholder="Search products..."
            value={search}
            onChangeText={setSearch}
          />
        </FieldHalf>
        <FieldHalf>
          <PillInput placeholder="Location" value={location} onChangeText={setLocation} />
        </FieldHalf>
      </FieldRow>

      <Card>
        <CardHeading
          title="Inventory Levels"
          subtitle="Track stock distribution across locations"
        />
        <ActionButton label="Scan & Stock" variant="primary" onPress={() => {}} />

        <View style={styles.filterChipRow}>
          <PillInput
            placeholder="Stock level"
            editable={false}
            style={styles.chip}
          />
          <Text style={styles.chipLabel}>3 locations</Text>
        </View>

        <DataTable
          columns={['Products', 'Showroom', 'Stock 1', 'Stock 2', 'Total']}
          rows={[]}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  filterChipRow: {
    marginTop: 4,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    width: 110,
    marginBottom: 0,
  },
  chipLabel: {
    marginLeft: 12,
    fontSize: 11,
    color: COLORS.textMuted,
  },
});