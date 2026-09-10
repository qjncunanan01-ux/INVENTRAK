import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Card,
  CardHeading,
  PillInput,
  FieldRow,
  FieldHalf,
  ActionButton,
  DataTable,
} from '../../components/SharedUI';

export default function StockMovementsView() {
  const [form, setForm] = useState({
    stockIn: '',
    product: '',
    quantity: '',
    destination: '',
    notes: '',
  });
  const [search, setSearch] = useState('');

  const setField = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  return (
    <View>
      <Card>
        <CardHeading
          title="New stock movement"
          subtitle="Record stock in, stock out, transfers, and adjustments with FIFO tracking"
        />

        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Stock in"
              value={form.stockIn}
              onChangeText={setField('stockIn')}
            />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="Product"
              value={form.product}
              onChangeText={setField('product')}
            />
          </FieldHalf>
        </FieldRow>
        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Quantity"
              value={form.quantity}
              onChangeText={setField('quantity')}
              keyboardType="numeric"
            />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="Destination location"
              value={form.destination}
              onChangeText={setField('destination')}
            />
          </FieldHalf>
        </FieldRow>
        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Notes"
              value={form.notes}
              onChangeText={setField('notes')}
            />
          </FieldHalf>
          <FieldHalf>
            <ActionButton label="Record movement" onPress={() => {}} />
          </FieldHalf>
        </FieldRow>
      </Card>

      <Card>
        <FieldRow>
          <FieldHalf>
            <CardHeading title="Recent stock movements" />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="Search products..."
              value={search}
              onChangeText={setSearch}
            />
          </FieldHalf>
        </FieldRow>

        <DataTable
          columns={['Type', 'Product', 'Quantity', 'Source', 'Destination', 'Date']}
          rows={[]}
        />
      </Card>
    </View>
  );
}