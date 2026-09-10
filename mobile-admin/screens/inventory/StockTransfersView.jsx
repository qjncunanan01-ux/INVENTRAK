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

export default function StockTransfersView() {
  const [form, setForm] = useState({
    product: '',
    fromLocation: '',
    quantity: '',
    toLocation: '',
    reason: '',
  });
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const setField = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  return (
    <View>
      <Card>
        <CardHeading
          title="New transfer request"
          subtitle="Move stock between locations. The transfer only happens after an admin approves it."
        />

        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Product"
              value={form.product}
              onChangeText={setField('product')}
            />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="From Location"
              value={form.fromLocation}
              onChangeText={setField('fromLocation')}
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
              placeholder="To Location"
              value={form.toLocation}
              onChangeText={setField('toLocation')}
            />
          </FieldHalf>
        </FieldRow>
        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Reason"
              value={form.reason}
              onChangeText={setField('reason')}
            />
          </FieldHalf>
          <FieldHalf>
            <ActionButton label="Request transfer" onPress={() => {}} />
          </FieldHalf>
        </FieldRow>
      </Card>

      <Card>
        <CardHeading title="Transfer history" />
        <FieldRow>
          <FieldHalf>
            <PillInput placeholder="Status" value={status} onChangeText={setStatus} />
          </FieldHalf>
          <FieldHalf>
            <PillInput placeholder="Search" value={search} onChangeText={setSearch} />
          </FieldHalf>
        </FieldRow>

        <DataTable
          columns={[
            'Product',
            'From',
            'To',
            'Qty',
            'Reason',
            'Status',
            'Decided by',
            'Date',
            'Actions',
          ]}
          rows={[]}
        />
      </Card>
    </View>
  );
}